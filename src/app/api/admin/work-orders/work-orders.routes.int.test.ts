import { describe, expect, it } from 'vitest';
import { AuditLog, WorkOrder } from '@/models';
import { GET as getRoute, PATCH as patchRoute } from '@/app/api/admin/work-orders/[id]/route';
import { POST as statusRoute } from '@/app/api/admin/work-orders/[id]/status/route';
import { GET as listRoute, POST as createRoute } from '@/app/api/admin/work-orders/route';
import { createPayout } from '@/services/third-party-payout.service';
import { setupTestDb } from '@/test/db';
import { call, cookieFor, makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { makeClient, makeProject, makeTask } from '@/test/domain-factories';
import { makeOrder, makeParty } from '@/test/third-party-factories';

setupTestDb();

const id = (d: { _id: unknown }) => String(d._id);
const asSuper = async () => makeSuperadmin();
const asRecorder = async () => makeAdmin({ grants: ['payout:view', 'payout:record'] });
const asReader = async () => makeAdmin({ grants: ['payout:view'] });

async function world() {
  const client = await makeClient();
  const project = await makeProject(client);
  const task = await makeTask(project);
  const party = await makeParty();
  return { client, project, task, party, body: { thirdPartyId: id(party), projectId: id(project), title: 'Build the checkout', amountMinor: 1_000_000, currency: 'INR' } };
}

describe('every work-order route needs a signed-in admin with the right capability', () => {
  it('answers 401 without a session, and 403 for an admin without payout access (reads) or payout:record (writes)', async () => {
    const w = await world();
    const order = await makeOrder(w.party, w.project);
    const p = { id: id(order) };
    const anon = await Promise.all([
      call(listRoute, '/api/admin/work-orders'),
      call(createRoute, '/api/admin/work-orders', { body: w.body }),
      call(getRoute, `/api/admin/work-orders/${p.id}`, {}, p),
      call(patchRoute, `/api/admin/work-orders/${p.id}`, { method: 'PATCH', body: { title: 'Nope' } }, p),
      call(statusRoute, `/api/admin/work-orders/${p.id}/status`, { body: { status: 'delivered' } }, p),
    ]);
    expect(anon.map((a) => a.status)).toEqual(Array(5).fill(401));

    const plain = await cookieFor(await makeAdmin());
    const reader = await cookieFor(await asReader());
    const forbidden = await Promise.all([
      call(listRoute, '/api/admin/work-orders', { cookie: plain }),
      call(getRoute, `/api/admin/work-orders/${p.id}`, { cookie: plain }, p),
      call(createRoute, '/api/admin/work-orders', { body: w.body, cookie: reader }),
      call(patchRoute, `/api/admin/work-orders/${p.id}`, { method: 'PATCH', body: { title: 'Nope' }, cookie: reader }, p),
      call(statusRoute, `/api/admin/work-orders/${p.id}/status`, { body: { status: 'delivered' }, cookie: reader }, p),
    ]);
    expect(forbidden.map((r) => [r.status, r.body.error.code])).toEqual(Array(5).fill([403, 'FORBIDDEN']));
    expect((await call(listRoute, '/api/admin/work-orders', { cookie: reader })).status).toBe(200);
    expect(await WorkOrder.countDocuments({})).toBe(1);
    expect(await AuditLog.countDocuments({})).toBe(0);
  });
});

describe('create, read, update, status', () => {
  it('creates (201) with the client derived, lists and reads it back', async () => {
    const w = await world();
    const cookie = await cookieFor(await asRecorder());
    const res = await call(createRoute, '/api/admin/work-orders', { body: { ...w.body, taskId: id(w.task), scope: 'Cart and payment', dueOn: '2026-12-01' }, cookie });
    expect(res.status).toBe(201);
    expect(res.body.data.workOrder).toMatchObject({ ref: 'WO-0001', status: 'open', clientId: id(w.client), projectId: id(w.project), taskId: id(w.task), agreed: { amountMinor: 1_000_000, currency: 'INR' }, dueOn: '2026-12-01', paidMinor: 0, dueMinor: 0 });
    const wid = res.body.data.workOrder.id as string;
    expect((await call(listRoute, '/api/admin/work-orders?status=current&q=checkout', { cookie })).body.data.meta.total).toBe(1);
    expect((await call(listRoute, `/api/admin/work-orders?thirdParty=${id(w.party)}&project=${id(w.project)}&sort=dueOn&dir=asc`, { cookie })).body.data.items).toHaveLength(1);
    const read = await call(getRoute, `/api/admin/work-orders/${wid}`, { cookie }, { id: wid });
    expect(read.body.data.workOrder.id).toBe(wid);
    expect(JSON.stringify(read.body)).not.toMatch(/"_id"|"__v"/);
    expect((await call(getRoute, '/api/admin/work-orders/nope', { cookie }, { id: 'nope' })).status).toBe(404);
  });

  it('rejects bad input with 422, LINK_MISMATCH for another client or project\'s task, and the cache is not writable', async () => {
    const w = await world();
    const cookie = await cookieFor(await asRecorder());
    const post = (body: unknown) => call(createRoute, '/api/admin/work-orders', { body, cookie });
    expect((await post({ ...w.body, title: '' })).body.error.fields.title).toBeDefined();
    expect((await post({ ...w.body, amountMinor: 0 })).body.error.fields.amountMinor).toBeDefined();
    expect((await post({ ...w.body, amountMinor: 1.5 })).status).toBe(422);
    expect((await post({ ...w.body, currency: 'XXX' })).body.error.fields.currency).toBeDefined();
    expect((await post({ ...w.body, dueOn: '2026-02-30' })).body.error.fields.dueOn).toBeDefined();
    expect((await post({ ...w.body, paidMinor: 5 })).status).toBe(422);
    expect((await post({ ...w.body, status: 'closed' })).status).toBe(422);
    const mismatch = await post({ ...w.body, clientId: id(await makeClient()) });
    expect([mismatch.status, mismatch.body.error.code]).toEqual([422, 'LINK_MISMATCH']);
    const taskMismatch = await post({ ...w.body, taskId: id(await makeTask(await makeProject(w.client))) });
    expect(taskMismatch.body.error.code).toBe('LINK_MISMATCH');
    expect(await WorkOrder.countDocuments({})).toBe(0);
  });

  it('PATCH edits and answers warnings; the status route follows the rules and answers 409 when payouts block a cancel', async () => {
    const w = await world();
    const sa = await asSuper();
    const cookie = await cookieFor(sa);
    const order = await makeOrder(w.party, w.project, { agreedMinor: 1_000_000 });
    const p = { id: id(order) };
    const patch = (body: unknown) => call(patchRoute, `/api/admin/work-orders/${p.id}`, { method: 'PATCH', body, cookie }, p);
    expect((await patch({ title: 'Checkout v2' })).body.data).toMatchObject({ workOrder: { title: 'Checkout v2' }, warnings: [] });
    expect((await patch({})).status).toBe(422);
    expect((await patch({ thirdPartyId: id(w.party) })).status).toBe(422);
    await createPayout(await sessionFor(sa), { workOrderId: p.id, amountMinor: 600_000 });
    const low = await patch({ amountMinor: 500_000 });
    expect(low.status).toBe(200);
    expect(low.body.data.warnings).toHaveLength(1);

    const move = (body: unknown) => call(statusRoute, `/api/admin/work-orders/${p.id}/status`, { body, cookie }, p);
    expect((await move({ status: 'flying' })).status).toBe(422);
    expect((await move({ status: 'cancelled' })).body.error.fields.note).toBeDefined();
    const blocked = await move({ status: 'cancelled', note: 'Changed our mind' });
    expect([blocked.status, blocked.body.error.code]).toEqual([409, 'CONFLICT']);
    expect((await move({ status: 'delivered' })).body.data.workOrder.status).toBe('delivered');
  });
});
