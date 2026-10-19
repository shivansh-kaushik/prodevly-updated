import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Task, WorkLog } from '@/models';
import { DELETE as deleteRoute, PATCH as patchRoute } from '@/app/api/admin/work-logs/[id]/route';
import { GET as dayTotalRoute } from '@/app/api/admin/work-logs/day-total/route';
import { GET as listRoute, POST as createRoute } from '@/app/api/admin/work-logs/route';
import { setupTestDb } from '@/test/db';
import { call, cookieFor, makeAdmin } from '@/test/factories';
import { makeClient, makeProject, makeTask } from '@/test/domain-factories';
import { backdateLog, dayOffset, makeTeamPayout, makeWorkLog, makeWorkspace, ymd } from '@/test/task-factories';

setupTestDb();

const id = (d: { _id: Types.ObjectId }) => String(d._id);
const today = () => ymd(dayOffset(0));
const body = (taskId: string, o: Record<string, unknown> = {}) => ({ taskId, workedOn: today(), minutes: 60, note: 'Built the form', ...o });

describe('authentication', () => {
  it('answers 401 without a session on every route', async () => {
    const w = await makeWorkspace();
    const log = await makeWorkLog(w.admin, w.task);
    const lid = id(log);
    const answers = await Promise.all([
      call(listRoute, '/api/admin/work-logs'),
      call(createRoute, '/api/admin/work-logs', { body: body(id(w.task)) }),
      call(patchRoute, `/api/admin/work-logs/${lid}`, { method: 'PATCH', body: { minutes: 30 } }, { id: lid }),
      call(deleteRoute, `/api/admin/work-logs/${lid}`, { method: 'DELETE' }, { id: lid }),
      call(dayTotalRoute, `/api/admin/work-logs/day-total?date=${today()}`),
    ]);
    expect(answers.map((a) => a.status)).toEqual([401, 401, 401, 401, 401]);
    expect(await WorkLog.countDocuments({})).toBe(1);
  });
});

describe('logging time', () => {
  it('creates an entry (201): project and client from the task, the task total updated', async () => {
    const w = await makeWorkspace();
    const res = await call(createRoute, '/api/admin/work-logs', { body: body(id(w.task), { minutes: 90 }), cookie: await cookieFor(w.admin) });
    expect(res.status).toBe(201);
    expect(res.body.data.workLog).toMatchObject({ minutes: 90, adminName: w.admin.name, clientId: id(w.client), project: { id: id(w.project) }, canEdit: true });
    expect((await Task.findById(w.task._id).lean())?.loggedMinutes).toBe(90);
    expect(JSON.stringify(res.body)).not.toMatch(/"_id"|lockedByPayoutId/);
  });

  it('rejects bad input with 422 and field messages, and writes nothing', async () => {
    const w = await makeWorkspace();
    const cookie = await cookieFor(w.admin);
    const post = (b: unknown) => call(createRoute, '/api/admin/work-logs', { body: b, cookie });
    expect((await post(body(id(w.task), { minutes: 4 }))).body.error.fields.minutes).toBeDefined();
    expect((await post(body(id(w.task), { minutes: 721 }))).status).toBe(422);
    expect((await post(body(id(w.task), { minutes: 90.5 }))).status).toBe(422);
    expect((await post(body(id(w.task), { note: 'ab' }))).body.error.fields.note).toBeDefined();
    expect((await post(body(id(w.task), { workedOn: ymd(dayOffset(1)) }))).body.error.fields.workedOn).toMatch(/future/);
    expect((await post(body(id(w.task), { workedOn: '12/10/2026' }))).body.error.fields.workedOn).toBeDefined();
    expect((await post(body('nope'))).status).toBe(422);
    expect((await post(body(id(w.task), { adminId: id(w.superadmin) }))).status).toBe(422); // you log your own time only
    expect((await post(body(id(w.task), { lockedByPayoutId: id(w.task) }))).status).toBe(422);
    expect((await post(body(String(new Types.ObjectId())))).body.error.fields.taskId).toBeDefined();
    expect(await WorkLog.countDocuments({})).toBe(0);
  });

  it('answers LINK_MISMATCH for a project that does not own the task, and 409 for a cancelled task', async () => {
    const w = await makeWorkspace();
    const cookie = await cookieFor(w.admin);
    const otherProject = await makeProject(await makeClient());
    const mismatch = await call(createRoute, '/api/admin/work-logs', { body: body(id(w.task), { projectId: id(otherProject) }), cookie });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe('LINK_MISMATCH');
    const cancelled = await makeTask(w.project, { status: 'cancelled' });
    expect((await call(createRoute, '/api/admin/work-logs', { body: body(id(cancelled)), cookie })).status).toBe(409);
  });

  it('answers 422 when the day would pass 16 hours, and reports the day total for the form', async () => {
    const w = await makeWorkspace();
    const cookie = await cookieFor(w.admin);
    expect((await call(createRoute, '/api/admin/work-logs', { body: body(id(w.task), { minutes: 720 }), cookie })).status).toBe(201);
    expect((await call(createRoute, '/api/admin/work-logs', { body: body(id(w.task), { minutes: 240 }), cookie })).status).toBe(201);
    const over = await call(createRoute, '/api/admin/work-logs', { body: body(id(w.task), { minutes: 5 }), cookie });
    expect(over.status).toBe(422);
    expect(over.body.error.fields.minutes).toMatch(/16 hours/);
    const total = await call(dayTotalRoute, `/api/admin/work-logs/day-total?date=${today()}`, { cookie });
    expect(total.body.data).toEqual({ date: today(), minutes: 960 });
    expect((await call(dayTotalRoute, '/api/admin/work-logs/day-total?date=soon', { cookie })).status).toBe(422);
    expect((await call(dayTotalRoute, '/api/admin/work-logs/day-total', { cookie })).status).toBe(422);
  });
});

describe('changing an entry', () => {
  it('lets the owner edit and delete within the window, and answers 403 after it, while a superadmin still can', async () => {
    const w = await makeWorkspace();
    const log = await makeWorkLog(w.admin, w.task);
    const lid = id(log);
    const own = await cookieFor(w.admin);
    const edit = await call(patchRoute, `/api/admin/work-logs/${lid}`, { method: 'PATCH', body: { minutes: 90, note: 'Corrected note' }, cookie: own }, { id: lid });
    expect(edit.status).toBe(200);
    expect(edit.body.data.workLog).toMatchObject({ minutes: 90, note: 'Corrected note' });
    expect((await Task.findById(w.task._id).lean())?.loggedMinutes).toBe(90);

    await backdateLog(log._id, 9);
    expect((await call(patchRoute, `/api/admin/work-logs/${lid}`, { method: 'PATCH', body: { minutes: 30 }, cookie: own }, { id: lid })).status).toBe(403);
    expect((await call(deleteRoute, `/api/admin/work-logs/${lid}`, { method: 'DELETE', cookie: own }, { id: lid })).status).toBe(403);
    expect(await WorkLog.countDocuments({ _id: log._id })).toBe(1);

    const sa = await cookieFor(w.superadmin);
    expect((await call(patchRoute, `/api/admin/work-logs/${lid}`, { method: 'PATCH', body: { minutes: 30 }, cookie: sa }, { id: lid })).status).toBe(200);
    expect((await call(deleteRoute, `/api/admin/work-logs/${lid}`, { method: 'DELETE', cookie: sa }, { id: lid })).status).toBe(200);
    expect((await Task.findById(w.task._id).lean())?.loggedMinutes).toBe(0);
  });

  it('never lets another admin change it (403), and nobody change a locked one (409 ENTRY_LOCKED)', async () => {
    const w = await makeWorkspace();
    const log = await makeWorkLog(w.admin, w.task);
    const lid = id(log);
    const peer = await cookieFor(await makeAdmin());
    expect((await call(patchRoute, `/api/admin/work-logs/${lid}`, { method: 'PATCH', body: { minutes: 30 }, cookie: peer }, { id: lid })).status).toBe(403);
    expect((await call(deleteRoute, `/api/admin/work-logs/${lid}`, { method: 'DELETE', cookie: peer }, { id: lid })).status).toBe(403);

    const payout = await makeTeamPayout(w.admin);
    const locked = await makeWorkLog(w.admin, w.task, { lockedByPayoutId: payout._id });
    const kid = id(locked);
    for (const cookie of [await cookieFor(w.admin), await cookieFor(w.superadmin)]) {
      const res = await call(patchRoute, `/api/admin/work-logs/${kid}`, { method: 'PATCH', body: { minutes: 30 }, cookie }, { id: kid });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ENTRY_LOCKED');
      expect((await call(deleteRoute, `/api/admin/work-logs/${kid}`, { method: 'DELETE', cookie }, { id: kid })).body.error.code).toBe('ENTRY_LOCKED');
    }
    expect((await WorkLog.findById(locked._id).lean())?.minutes).toBe(60);
  });

  it('validates the patch (task and owner cannot change) and 404s a malformed or unknown id', async () => {
    const w = await makeWorkspace();
    const log = await makeWorkLog(w.admin, w.task);
    const lid = id(log);
    const cookie = await cookieFor(w.admin);
    const patch = (b: unknown, p = lid) => call(patchRoute, `/api/admin/work-logs/${p}`, { method: 'PATCH', body: b, cookie }, { id: p });
    expect((await patch({})).status).toBe(422);
    expect((await patch({ taskId: id(w.task) })).status).toBe(422);
    expect((await patch({ adminId: id(w.superadmin) })).status).toBe(422);
    expect((await patch({ minutes: 3 })).body.error.fields.minutes).toBeDefined();
    expect((await patch({ workedOn: ymd(dayOffset(2)) })).body.error.fields.workedOn).toMatch(/future/);
    expect((await patch({ minutes: 30 }, 'nope')).status).toBe(404);
    expect((await patch({ minutes: 30 }, String(new Types.ObjectId()))).status).toBe(404);
  });
});

describe('listing', () => {
  it('shows a plain admin only their own entries, and a superadmin everyone\'s with filters and totals', async () => {
    const w = await makeWorkspace();
    const peer = await makeAdmin({ name: 'Peer Person' });
    await makeWorkLog(w.admin, w.task, { minutes: 30 });
    await makeWorkLog(peer, w.task, { minutes: 50, billable: true });
    const own = await call(listRoute, `/api/admin/work-logs?adminId=${id(peer)}`, { cookie: await cookieFor(w.admin) });
    expect(own.status).toBe(200);
    expect(own.body.data.items.map((l: { adminName: string }) => l.adminName)).toEqual([w.admin.name]);
    expect(JSON.stringify(own.body)).not.toContain('Peer Person');

    const sa = await cookieFor(w.superadmin);
    const all = await call(listRoute, '/api/admin/work-logs', { cookie: sa });
    expect(all.body.data).toMatchObject({ total: 2, totals: { minutes: 80, billableMinutes: 50, people: 2 } });
    expect((await call(listRoute, `/api/admin/work-logs?adminId=${id(peer)}`, { cookie: sa })).body.data.total).toBe(1);
    expect((await call(listRoute, '/api/admin/work-logs?billable=yes', { cookie: sa })).body.data.total).toBe(1);
    expect((await call(listRoute, `/api/admin/work-logs?from=${today()}&to=${today()}`, { cookie: sa })).body.data.total).toBe(2);
    expect((await call(listRoute, '/api/admin/work-logs?from=not-a-date', { cookie: sa })).status).toBe(422);
  });
});
