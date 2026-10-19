import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { POST as createRoute } from '@/app/api/admin/projects/route';
import { PATCH as updateRoute } from '@/app/api/admin/projects/[id]/route';
import { POST as statusRoute } from '@/app/api/admin/projects/[id]/status/route';
import { POST as addMilestoneRoute } from '@/app/api/admin/projects/[id]/milestones/route';
import { DELETE as removeMilestoneRoute, PATCH as updateMilestoneRoute } from '@/app/api/admin/projects/[id]/milestones/[milestoneId]/route';
import { POST as archiveRoute } from '@/app/api/admin/projects/[id]/archive/route';
import { POST as restoreRoute } from '@/app/api/admin/projects/[id]/restore/route';
import { AuditLog, Project } from '@/models';
import { setupTestDb } from '@/test/db';
import { makeClient, makeProject } from '@/test/domain-factories';
import { call, cookieFor, makeAdmin, makeSuperadmin } from '@/test/factories';

setupTestDb();

const FIXED = { pricingModel: 'fixed', amountMinor: 1_000_000, currency: 'INR' };
const post = (body: unknown, cookie?: string, headers?: Record<string, string>) => ({ method: 'POST', body, cookie, headers });
const patch = (body: unknown, cookie?: string) => ({ method: 'PATCH', body, cookie });

async function actors() {
  const sa = await makeSuperadmin();
  const plain = await makeAdmin();
  const payer = await makeAdmin({ grants: ['payment:record', 'payment:view'] });
  const archiver = await makeAdmin({ grants: ['project:archive'] });
  return {
    sa: await cookieFor(sa),
    plain: await cookieFor(plain),
    payer: await cookieFor(payer),
    archiver: await cookieFor(archiver),
  };
}

const create = async (cookie: string, clientId: unknown, extra: Record<string, unknown> = {}) =>
  call(createRoute, '/api/admin/projects', post({ clientId: String(clientId), name: 'Website rebuild', type: 'website', ...extra }, cookie));

describe('every route needs a signed-in admin', () => {
  it('answers 401 without a session and changes nothing', async () => {
    const client = await makeClient();
    const project = await makeProject(client);
    const id = String(project._id);
    const mid = String(new Types.ObjectId());
    const results = await Promise.all([
      call(createRoute, '/api/admin/projects', post({ clientId: String(client._id), name: 'Nope', type: 'website' })),
      call(updateRoute, `/api/admin/projects/${id}`, patch({ name: 'Nope' }), { id }),
      call(statusRoute, `/api/admin/projects/${id}/status`, post({ to: 'cancelled', note: 'x' }), { id }),
      call(addMilestoneRoute, `/api/admin/projects/${id}/milestones`, post({ title: 'Nope', amountMinor: 1 }), { id }),
      call(updateMilestoneRoute, `/api/admin/projects/${id}/milestones/${mid}`, patch({ title: 'Nope' }), { id, milestoneId: mid }),
      call(removeMilestoneRoute, `/api/admin/projects/${id}/milestones/${mid}`, { method: 'DELETE' }, { id, milestoneId: mid }),
      call(archiveRoute, `/api/admin/projects/${id}/archive`, post({}), { id }),
      call(restoreRoute, `/api/admin/projects/${id}/restore`, post({}), { id }),
    ]);
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(401));
    expect(await Project.countDocuments({})).toBe(1);
    expect(await AuditLog.countDocuments({ action: /^project\./ })).toBe(0);
  });
});

describe('capabilities at the route', () => {
  it('lets a plain admin create and edit projects, but not set money, add milestones or archive', async () => {
    const { plain } = await actors();
    const client = await makeClient();

    const made = await create(plain, client._id);
    expect(made.status).toBe(201);
    expect(made.body.data.project).toMatchObject({ ref: 'PRJ-0001', clientName: client.name, status: 'proposal', money: null });
    const id = made.body.data.project.id as string;

    expect((await call(updateRoute, `/api/admin/projects/${id}`, patch({ name: 'Renamed' }, plain), { id })).status).toBe(200);
    expect((await call(updateRoute, `/api/admin/projects/${id}`, patch({ contract: { amountMinor: 5 } }, plain), { id })).status).toBe(403);
    expect((await call(updateRoute, `/api/admin/projects/${id}`, patch({ costBudgetInrMinor: 5 }, plain), { id })).status).toBe(403);
    expect((await create(plain, client._id, { contract: FIXED })).status).toBe(403);
    expect((await call(addMilestoneRoute, `/api/admin/projects/${id}/milestones`, post({ title: 'First', amountMinor: 100 }, plain), { id })).status).toBe(403);
    expect((await call(archiveRoute, `/api/admin/projects/${id}/archive`, post({}, plain), { id })).status).toBe(403);
    expect((await call(statusRoute, `/api/admin/projects/${id}/status`, post({ to: 'active' }, plain), { id })).status).toBe(200);

    const doc = await Project.findById(id).lean();
    expect(doc).toMatchObject({ name: 'Renamed', status: 'active' });
    expect(doc?.contract.amountMinor).toBe(0);
    expect(doc?.milestones).toHaveLength(0);
    expect(doc?.archivedAt).toBeUndefined();
  });

  it('lets payment access set a contract and manage milestones, and returns the money to them', async () => {
    const { payer } = await actors();
    const client = await makeClient();
    const made = await create(payer, client._id, { contract: FIXED, costBudgetInrMinor: 400_000 });
    expect(made.status).toBe(201);
    expect(made.body.data.project.money).toMatchObject({ contract: { amountMinor: 1_000_000 }, costBudgetInrMinor: 400_000 });
    const id = made.body.data.project.id as string;

    const added = await call(addMilestoneRoute, `/api/admin/projects/${id}/milestones`, post({ title: 'Design', amountMinor: 250_000, dueOn: '2026-09-15' }, payer), { id });
    expect(added.status).toBe(201);
    const mid = added.body.data.project.money.milestones[0].id as string;

    const updated = await call(updateMilestoneRoute, `/api/admin/projects/${id}/milestones/${mid}`, patch({ status: 'invoiced' }, payer), { id, milestoneId: mid });
    expect(updated.status).toBe(200);
    expect(updated.body.data.project.money.milestones[0].status).toBe('invoiced');

    const blocked = await call(removeMilestoneRoute, `/api/admin/projects/${id}/milestones/${mid}`, { method: 'DELETE', cookie: payer }, { id, milestoneId: mid });
    expect(blocked.status).toBe(409);
    await call(updateMilestoneRoute, `/api/admin/projects/${id}/milestones/${mid}`, patch({ status: 'pending' }, payer), { id, milestoneId: mid });
    const removed = await call(removeMilestoneRoute, `/api/admin/projects/${id}/milestones/${mid}`, { method: 'DELETE', cookie: payer }, { id, milestoneId: mid });
    expect(removed.status).toBe(200);
    expect(removed.body.data.project.money.milestones).toEqual([]);
  });

  it('lets project:archive archive and restore', async () => {
    const { archiver } = await actors();
    const client = await makeClient();
    const project = await makeProject(client);
    const id = String(project._id);
    const archived = await call(archiveRoute, `/api/admin/projects/${id}/archive`, post({ reason: 'Finished' }, archiver), { id });
    expect(archived.status).toBe(200);
    expect(archived.body.data.project.archivedAt).not.toBeNull();
    expect((await call(archiveRoute, `/api/admin/projects/${id}/archive`, post({}, archiver), { id })).status).toBe(409);
    expect((await call(restoreRoute, `/api/admin/projects/${id}/restore`, post({}, archiver), { id })).body.data.project.archivedAt).toBeNull();
  });
});

describe('status route', () => {
  it('moves along the table, refuses what the table does not allow, and wants a note where it must', async () => {
    const { plain, sa } = await actors();
    const client = await makeClient();
    const project = await makeProject(client, { status: 'active' });
    const id = String(project._id);
    const move = (to: string, note: string | undefined, cookie: string) =>
      call(statusRoute, `/api/admin/projects/${id}/status`, post({ to, ...(note ? { note } : {}) }, cookie), { id });

    expect((await move('delivered', undefined, plain)).status).toBe(409); // active cannot go straight to delivered
    const noNote = await move('on_hold', undefined, plain);
    expect(noNote.status).toBe(422);
    expect(noNote.body.error.fields.note).toBeDefined();
    const held = await move('on_hold', 'Waiting for content', plain);
    expect(held.status).toBe(200);
    expect(held.body.data.project.statusHistory.at(-1)).toMatchObject({ from: 'active', to: 'on_hold', note: 'Waiting for content' });

    expect((await move('cancelled', 'Client left', plain)).status).toBe(200);
    expect((await move('active', 'Changed their mind', plain)).status).toBe(403); // reopening is for superadmins
    expect((await move('active', 'Changed their mind', sa)).status).toBe(200);
  });

  it('rejects an unknown status', async () => {
    const { sa } = await actors();
    const project = await makeProject(await makeClient());
    const id = String(project._id);
    const res = await call(statusRoute, `/api/admin/projects/${id}/status`, post({ to: 'finished' }, sa), { id });
    expect(res.status).toBe(422);
    expect(res.body.error.fields.to).toBeDefined();
  });
});

describe('validation', () => {
  it('answers 422 with field messages for a bad create', async () => {
    const { sa } = await actors();
    const client = await makeClient();
    const bad = async (extra: Record<string, unknown>, field: string) => {
      const res = await create(sa, client._id, extra);
      expect(res.status, JSON.stringify(extra)).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.fields[field], `${field} for ${JSON.stringify(extra)}`).toBeDefined();
    };
    await bad({ name: 'x' }, 'name');
    await bad({ type: 'blog' }, 'type');
    await bad({ clientId: 'not-an-id' }, 'clientId');
    await bad({ startOn: '2026-13-45' }, 'startOn');
    await bad({ startOn: '2026-08-10', deadlineOn: '2026-08-01' }, 'deadlineOn');
    await bad({ contract: { ...FIXED, amountMinor: -5 } }, 'contract.amountMinor');
    await bad({ contract: { ...FIXED, amountMinor: 10.5 } }, 'contract.amountMinor');
    await bad({ contract: { ...FIXED, currency: 'XXX' } }, 'contract.currency');
    await bad({ contract: { ...FIXED, pricingModel: 'barter' } }, 'contract.pricingModel');
    await bad({ links: { live: 'javascript:alert(1)' } }, 'links.live');
    await bad({ links: { repo: 'ftp://example.com/x' } }, 'links.repo');
    await bad({ status: 'delivered' }, 'status'); // a project starts as a proposal or active, nothing else
    await bad({ memberIds: ['nope'] }, 'memberIds.0');
    expect(await Project.countDocuments({})).toBe(0);
  });

  it('rejects fields a caller must not set: strict schemas stop mass assignment', async () => {
    const { sa } = await actors();
    const client = await makeClient();
    for (const extra of [{ ref: 'PRJ-9999' }, { clientName: 'Forged Name' }, { agreed: { amountMinor: 1, currency: 'INR' } }, { statusHistory: [] }, { archivedAt: '2026-01-01' }, { createdBy: { name: 'Forged' } }]) {
      const res = await create(sa, client._id, extra);
      expect(res.status, JSON.stringify(extra)).toBe(422);
    }
    const project = await makeProject(client);
    const id = String(project._id);
    for (const body of [{ status: 'closed' }, { ref: 'PRJ-9999' }, { agreed: { amountMinor: 1 } }, { archivedAt: null }, { deliveredOn: '2026-01-01' }, { milestones: [] }, { updatedBy: { name: 'x' } }]) {
      const res = await call(updateRoute, `/api/admin/projects/${id}`, patch(body, sa), { id });
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    expect((await Project.findById(id).lean())?.status).toBe('active');
  });

  it('rejects an empty update and an unreadable body', async () => {
    const { sa } = await actors();
    const project = await makeProject(await makeClient());
    const id = String(project._id);
    expect((await call(updateRoute, `/api/admin/projects/${id}`, patch({}, sa), { id })).status).toBe(422);
    const raw = await call(updateRoute, `/api/admin/projects/${id}`, { method: 'PATCH', rawBody: '{nope', cookie: sa, headers: { 'content-type': 'application/json' } }, { id });
    expect(raw.status).toBe(400);
  });

  it('validates milestones: a title, a positive whole amount, a real date', async () => {
    const { sa } = await actors();
    const project = await makeProject(await makeClient(), { contract: { pricingModel: 'fixed', amountMinor: 1_000_000, currency: 'INR' } });
    const id = String(project._id);
    const add = (body: unknown) => call(addMilestoneRoute, `/api/admin/projects/${id}/milestones`, post(body, sa), { id });
    expect((await add({ title: 'x', amountMinor: 100 })).body.error.fields.title).toBeDefined();
    expect((await add({ title: 'Design', amountMinor: 0 })).body.error.fields.amountMinor).toBeDefined();
    expect((await add({ title: 'Design', amountMinor: 1.5 })).body.error.fields.amountMinor).toBeDefined();
    expect((await add({ title: 'Design', amountMinor: 100, dueOn: 'tomorrow' })).body.error.fields.dueOn).toBeDefined();
    expect((await add({ title: 'Design', amountMinor: 100, status: 'paid' })).status).toBe(422); // a new milestone is pending
    expect((await add({ title: 'Design', amountMinor: 2_000_000 })).body.error.fields.amountMinor).toMatch(/more than the contract/);
    expect((await Project.findById(id).lean())?.milestones).toHaveLength(0);
  });

  it('answers 404 for a malformed or unknown id', async () => {
    const { sa } = await actors();
    expect((await call(updateRoute, '/api/admin/projects/not-an-id', patch({ name: 'Whatever' }, sa), { id: 'not-an-id' })).status).toBe(404);
    const missing = String(new Types.ObjectId());
    expect((await call(updateRoute, `/api/admin/projects/${missing}`, patch({ name: 'Whatever' }, sa), { id: missing })).status).toBe(404);
    expect((await call(statusRoute, `/api/admin/projects/${missing}/status`, post({ to: 'active' }, sa), { id: missing })).status).toBe(404);
    expect((await call(archiveRoute, '/api/admin/projects/zzz/archive', post({}, sa), { id: 'zzz' })).status).toBe(404);
  });

  it('accepts an uppercase id and finds the same project', async () => {
    const { sa } = await actors();
    let project;
    for (let i = 0; i < 40; i++) {
      project = await makeProject(await makeClient());
      if (/[a-f]/.test(String(project._id))) break;
    }
    const id = String(project!._id).toUpperCase();
    const res = await call(updateRoute, `/api/admin/projects/${id}`, patch({ name: 'Found anyway' }, sa), { id });
    expect(res.status).toBe(200);
    expect(res.body.data.project.id).toBe(String(project!._id));
  });
});

describe('request safety', () => {
  it('refuses cross-site writes even with a valid session, and changes nothing', async () => {
    const { sa } = await actors();
    const client = await makeClient();
    const project = await makeProject(client);
    const id = String(project._id);
    const cross = { 'sec-fetch-site': 'cross-site' };
    expect((await call(createRoute, '/api/admin/projects', post({ clientId: String(client._id), name: 'Forged', type: 'website' }, sa, cross))).status).toBe(403);
    expect((await call(statusRoute, `/api/admin/projects/${id}/status`, post({ to: 'cancelled', note: 'forged' }, sa, cross), { id })).status).toBe(403);
    expect((await call(archiveRoute, `/api/admin/projects/${id}/archive`, post({}, sa, cross), { id })).status).toBe(403);
    expect(await Project.countDocuments({})).toBe(1);
    expect((await Project.findById(id).lean())?.status).toBe('active');
  });

  it('never leaks internals in a response: no hashes, no snapshots of other people\'s data', async () => {
    const { sa } = await actors();
    const made = await create(sa, (await makeClient())._id, { contract: FIXED });
    const text = JSON.stringify(made.body);
    expect(text).not.toMatch(/passwordHash|ipHash|\$2[aby]\$|__v/);
    expect(made.body.data.project.id).toMatch(/^[a-f\d]{24}$/);
    expect(typeof made.body.data.project.createdAt).toBe('string');
  });
});
