import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { AuditLog, Task } from '@/models';
import { DELETE as deleteRoute, GET as getRoute, PATCH as patchRoute } from '@/app/api/admin/tasks/[id]/route';
import { POST as archiveRoute } from '@/app/api/admin/tasks/[id]/archive/route';
import { PUT as assigneesRoute } from '@/app/api/admin/tasks/[id]/assignees/route';
import { POST as restoreRoute } from '@/app/api/admin/tasks/[id]/restore/route';
import { POST as statusRoute } from '@/app/api/admin/tasks/[id]/status/route';
import { POST as reorderRoute } from '@/app/api/admin/tasks/reorder/route';
import { GET as listRoute, POST as createRoute } from '@/app/api/admin/tasks/route';
import { setupTestDb } from '@/test/db';
import { call, cookieFor, makeAdmin } from '@/test/factories';
import { makeClient, makeProject, makeTask } from '@/test/domain-factories';
import { makeWorkLog, makeWorkspace } from '@/test/task-factories';

setupTestDb();

const id = (d: { _id: Types.ObjectId }) => String(d._id);

describe('every task route needs a signed-in admin', () => {
  it('answers 401 without a session, whatever the method', async () => {
    const w = await makeWorkspace();
    const tid = id(w.task);
    const p = { id: tid };
    const answers = await Promise.all([
      call(listRoute, '/api/admin/tasks'),
      call(createRoute, '/api/admin/tasks', { body: { projectId: id(w.project), title: 'Nope' } }),
      call(getRoute, `/api/admin/tasks/${tid}`, {}, p),
      call(patchRoute, `/api/admin/tasks/${tid}`, { method: 'PATCH', body: { title: 'Nope' } }, p),
      call(deleteRoute, `/api/admin/tasks/${tid}`, { method: 'DELETE' }, p),
      call(statusRoute, `/api/admin/tasks/${tid}/status`, { body: { status: 'done' } }, p),
      call(assigneesRoute, `/api/admin/tasks/${tid}/assignees`, { method: 'PUT', body: { assignees: [] } }, p),
      call(archiveRoute, `/api/admin/tasks/${tid}/archive`, { method: 'POST', body: {} }, p),
      call(restoreRoute, `/api/admin/tasks/${tid}/restore`, { method: 'POST', body: {} }, p),
      call(reorderRoute, '/api/admin/tasks/reorder', { body: { projectId: id(w.project), status: 'todo', orderedIds: [tid] } }),
    ]);
    expect(answers.map((a) => a.status)).toEqual(Array(10).fill(401));
    expect((await Task.findById(w.task._id).lean())?.title).toBe(w.task.title);
  });

  it('refuses a cross-site write and an account that still has to change its password', async () => {
    const w = await makeWorkspace();
    const cookie = await cookieFor(w.admin);
    const crossSite = await call(createRoute, '/api/admin/tasks', { body: { projectId: id(w.project), title: 'Cross site' }, cookie, headers: { 'sec-fetch-site': 'cross-site' } });
    expect(crossSite.status).toBe(403);
    const fresh = await makeAdmin({ mustChangePassword: true });
    const pending = await call(createRoute, '/api/admin/tasks', { body: { projectId: id(w.project), title: 'Blocked' }, cookie: await cookieFor(fresh) });
    expect(pending.status).toBe(403);
    expect(pending.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(await Task.countDocuments({})).toBe(1);
  });
});

describe('create and read', () => {
  it('creates a task (201) with the client derived from the project, and reads it back', async () => {
    const w = await makeWorkspace();
    const cookie = await cookieFor(w.admin);
    const res = await call(createRoute, '/api/admin/tasks', { body: { projectId: id(w.project), title: 'Build the form', priority: 'high', dueOn: '2026-12-01' }, cookie });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, data: { task: { title: 'Build the form', priority: 'high', dueOn: '2026-12-01', project: { clientId: id(w.client) } } } });
    const tid = res.body.data.task.id as string;
    const read = await call(getRoute, `/api/admin/tasks/${tid}`, { cookie }, { id: tid });
    expect(read.status).toBe(200);
    expect(read.body.data.task.id).toBe(tid);
    expect(JSON.stringify(read.body)).not.toMatch(/"_id"|"__v"/);
  });

  it('rejects bad input with 422 and field messages', async () => {
    const w = await makeWorkspace();
    const cookie = await cookieFor(w.admin);
    const bad = async (body: unknown) => call(createRoute, '/api/admin/tasks', { body, cookie });
    expect((await bad({ projectId: id(w.project) })).body.error.fields.title).toBeDefined();
    expect((await bad({ projectId: id(w.project), title: 'x' })).status).toBe(422);
    expect((await bad({ projectId: 'nope', title: 'Valid title' })).body.error.fields.projectId).toBeDefined();
    expect((await bad({ projectId: id(w.project), title: 'Valid title', dueOn: '2026-02-30' })).body.error.fields.dueOn).toBeDefined();
    expect((await bad({ projectId: id(w.project), title: 'Valid title', estimateMinutes: 12.5 })).status).toBe(422);
    expect((await bad({ projectId: id(w.project), title: 'Valid title', status: 'done' })).status).toBe(422); // a new task starts open
    expect((await bad({ projectId: id(w.project), title: 'Valid title', loggedMinutes: 99 })).status).toBe(422); // the cache is not writable
    expect((await bad({ projectId: id(w.project), title: 'Valid title', assignees: [{ kind: 'admin', id: id(w.admin), name: 'Spoofed' }] })).status).toBe(422); // names are never accepted
    const garbage = await call(createRoute, '/api/admin/tasks', { rawBody: '{nope', cookie, headers: { 'content-type': 'application/json' } });
    expect(garbage.status).toBe(400);
    expect(await Task.countDocuments({})).toBe(1);
  });

  it('answers LINK_MISMATCH (422) when the client does not own the project, and writes nothing', async () => {
    const w = await makeWorkspace();
    const other = await makeClient();
    const res = await call(createRoute, '/api/admin/tasks', { body: { projectId: id(w.project), clientId: id(other), title: 'Mismatch' }, cookie: await cookieFor(w.admin) });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('LINK_MISMATCH');
    expect(await Task.countDocuments({})).toBe(1);
  });

  it('lists with filters and paging, and answers 404 for a malformed or unknown id', async () => {
    const w = await makeWorkspace({ task: { title: 'Alpha task' } });
    await makeTask(w.project, { title: 'Beta task', status: 'done' });
    await makeTask(w.project, { title: 'Gamma task', priority: 'urgent' });
    const cookie = await cookieFor(w.admin);
    const all = await call(listRoute, '/api/admin/tasks', { cookie });
    expect(all.body.data).toMatchObject({ total: 3, page: 1 });
    expect((await call(listRoute, '/api/admin/tasks?status=open', { cookie })).body.data.total).toBe(2);
    expect((await call(listRoute, '/api/admin/tasks?priority=urgent', { cookie })).body.data.items[0].title).toBe('Gamma task');
    expect((await call(listRoute, '/api/admin/tasks?q=beta', { cookie })).body.data.total).toBe(1);
    expect((await call(listRoute, '/api/admin/tasks?pageSize=2&page=2&sort=title&dir=asc', { cookie })).body.data.items).toHaveLength(1);
    expect((await call(listRoute, '/api/admin/tasks?status=bogus&projectId=zzz', { cookie })).body.data.total).toBe(3); // bad filters are ignored
    expect((await call(getRoute, '/api/admin/tasks/nope', { cookie }, { id: 'nope' })).status).toBe(404);
    const missing = String(new Types.ObjectId());
    expect((await call(getRoute, `/api/admin/tasks/${missing}`, { cookie }, { id: missing })).status).toBe(404);
  });
});

describe('update, status and assignees', () => {
  it('PATCH edits fields but never status, history or the logged-minutes cache', async () => {
    const w = await makeWorkspace();
    const cookie = await cookieFor(w.admin);
    const tid = id(w.task);
    const ok = await call(patchRoute, `/api/admin/tasks/${tid}`, { method: 'PATCH', body: { title: 'Renamed task', dueOn: null }, cookie }, { id: tid });
    expect(ok.status).toBe(200);
    expect(ok.body.data.task.title).toBe('Renamed task');
    for (const body of [{ status: 'done' }, { statusHistory: [] }, { loggedMinutes: 0 }, { clientId: id(w.client) }, {}]) {
      expect((await call(patchRoute, `/api/admin/tasks/${tid}`, { method: 'PATCH', body, cookie }, { id: tid })).status, JSON.stringify(body)).toBe(422);
    }
  });

  it('POST status enforces the note rules and records history', async () => {
    const w = await makeWorkspace();
    const cookie = await cookieFor(w.admin);
    const tid = id(w.task);
    const post = (body: unknown) => call(statusRoute, `/api/admin/tasks/${tid}/status`, { body, cookie }, { id: tid });
    expect((await post({ status: 'flying' })).status).toBe(422);
    expect((await post({ status: 'cancelled' })).body.error.fields.note).toBeDefined();
    expect((await post({ status: 'done' })).body.data.task.completedAt).not.toBeNull();
    expect((await post({ status: 'todo' })).body.error.fields.note).toMatch(/reopening/);
    const reopened = await post({ status: 'todo', note: 'Client found a bug' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.data.task.statusHistory.map((h: { to: string }) => h.to)).toEqual(['done', 'todo']);
  });

  it('PUT assignees validates people against active records and ignores any name sent', async () => {
    const w = await makeWorkspace();
    const cookie = await cookieFor(w.admin);
    const tid = id(w.task);
    const put = (body: unknown) => call(assigneesRoute, `/api/admin/tasks/${tid}/assignees`, { method: 'PUT', body, cookie }, { id: tid });
    const gone = await makeAdmin({ status: 'deactivated' });
    expect((await put({ assignees: [{ kind: 'admin', id: id(gone) }] })).status).toBe(422);
    expect((await put({ assignees: [{ kind: 'dragon', id: id(w.admin) }] })).status).toBe(422);
    const dev = await makeAdmin({ name: 'Riya Sen' });
    const res = await put({ assignees: [{ kind: 'admin', id: id(dev) }] });
    expect(res.status).toBe(200);
    expect(res.body.data.task.assignees.map((a: { name: string }) => a.name)).toEqual(['Riya Sen']);
    expect(await AuditLog.countDocuments({ action: 'task.assign' })).toBe(1);
  });

  it('POST reorder sets a column order and refuses ids from elsewhere (422)', async () => {
    const w = await makeWorkspace({ task: { title: 'First task', order: 1 } });
    const second = await makeTask(w.project, { title: 'Second task', order: 2 });
    const stranger = await makeTask(await makeProject(w.client));
    const cookie = await cookieFor(w.admin);
    const post = (orderedIds: string[]) => call(reorderRoute, '/api/admin/tasks/reorder', { body: { projectId: id(w.project), status: 'todo', orderedIds }, cookie });
    expect((await post([id(second), id(w.task)])).body.data.orderedIds).toEqual([id(second), id(w.task)]);
    const refused = await post([id(stranger)]);
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('LINK_MISMATCH');
    expect((await post([])).status).toBe(422);
  });
});

describe('archive, restore and delete', () => {
  it('archives and restores through task:edit, and permanent delete is superadmin-only', async () => {
    const w = await makeWorkspace();
    const adminCookie = await cookieFor(w.admin);
    const tid = id(w.task);
    const p = { id: tid };
    expect((await call(archiveRoute, `/api/admin/tasks/${tid}/archive`, { method: 'POST', body: {}, cookie: adminCookie }, p)).body.data.task.archived).toBe(true);
    expect((await call(restoreRoute, `/api/admin/tasks/${tid}/restore`, { method: 'POST', body: {}, cookie: adminCookie }, p)).body.data.task.archived).toBe(false);

    const refused = await call(deleteRoute, `/api/admin/tasks/${tid}`, { method: 'DELETE', cookie: adminCookie }, p);
    expect(refused.status).toBe(403);
    expect(await Task.countDocuments({ _id: w.task._id })).toBe(1);

    const superCookie = await cookieFor(w.superadmin);
    await makeWorkLog(w.admin, w.task);
    const linked = await call(deleteRoute, `/api/admin/tasks/${tid}`, { method: 'DELETE', cookie: superCookie }, p);
    expect(linked.status).toBe(409);
    expect(linked.body.error.code).toBe('HAS_LINKED_RECORDS');
    expect(await Task.countDocuments({ _id: w.task._id })).toBe(1);

    const free = await makeTask(w.project);
    const gone = await call(deleteRoute, `/api/admin/tasks/${id(free)}`, { method: 'DELETE', cookie: superCookie }, { id: id(free) });
    expect(gone.status).toBe(200);
    expect(await Task.countDocuments({ _id: free._id })).toBe(0);
  });
});
