import { describe, expect, it } from 'vitest';
import { AuditLog, ThirdPartyPayout, WorkOrder } from '@/models';
import { GET as getRoute, PATCH as patchRoute } from '@/app/api/admin/third-party-payouts/[id]/route';
import { POST as markPaidRoute } from '@/app/api/admin/third-party-payouts/[id]/mark-paid/route';
import { POST as voidRoute } from '@/app/api/admin/third-party-payouts/[id]/void/route';
import { GET as listRoute, POST as createRoute } from '@/app/api/admin/third-party-payouts/route';
import { setupTestDb } from '@/test/db';
import { call, cookieFor, makeAdmin, makeSuperadmin } from '@/test/factories';
import { makeClient, makeProject, makeTask } from '@/test/domain-factories';
import { dayStr, makeMedia, makeOrder, makeParty, makePayout, setRate } from '@/test/third-party-factories';

setupTestDb();

const id = (d: { _id: unknown }) => String(d._id);

async function world() {
  const client = await makeClient();
  const project = await makeProject(client);
  const task = await makeTask(project);
  const party = await makeParty();
  const order = await makeOrder(party, project, { agreedMinor: 1_000_000 });
  const sa = await makeSuperadmin();
  const recorder = await makeAdmin({ grants: ['payout:view', 'payout:record'] });
  const reader = await makeAdmin({ grants: ['payout:view'] });
  return {
    client, project, task, party, order, sa, recorder, reader,
    cookies: { sa: await cookieFor(sa), recorder: await cookieFor(recorder), reader: await cookieFor(reader), plain: await cookieFor(await makeAdmin()) },
  };
}
const PAY = { mode: 'bank_transfer', transactionRef: 'UTR-001' };

describe('every payout route needs a signed-in admin with the right capability', () => {
  it('answers 401 without a session', async () => {
    const w = await world();
    const payout = await makePayout(w.party, w.project);
    const p = { id: id(payout) };
    const answers = await Promise.all([
      call(listRoute, '/api/admin/third-party-payouts'),
      call(createRoute, '/api/admin/third-party-payouts', { body: { workOrderId: id(w.order), amountMinor: 100 } }),
      call(getRoute, `/api/admin/third-party-payouts/${p.id}`, {}, p),
      call(patchRoute, `/api/admin/third-party-payouts/${p.id}`, { method: 'PATCH', body: { note: 'x' } }, p),
      call(markPaidRoute, `/api/admin/third-party-payouts/${p.id}/mark-paid`, { body: { paidOn: dayStr(0), ...PAY } }, p),
      call(voidRoute, `/api/admin/third-party-payouts/${p.id}/void`, { body: { reason: 'Nope' } }, p),
    ]);
    expect(answers.map((a) => a.status)).toEqual(Array(6).fill(401));
    expect((await ThirdPartyPayout.findById(payout._id).lean())?.status).toBe('due');
  });

  it('403: reading needs payout:view, writing payout:record, mark paid money:approve, void money:void', async () => {
    const w = await world();
    const payout = await makePayout(w.party, w.project, { order: w.order });
    const p = { id: id(payout) };
    const matrix = await Promise.all([
      call(listRoute, '/api/admin/third-party-payouts', { cookie: w.cookies.plain }),
      call(getRoute, `/api/admin/third-party-payouts/${p.id}`, { cookie: w.cookies.plain }, p),
      call(createRoute, '/api/admin/third-party-payouts', { body: { workOrderId: id(w.order), amountMinor: 100 }, cookie: w.cookies.reader }),
      call(patchRoute, `/api/admin/third-party-payouts/${p.id}`, { method: 'PATCH', body: { note: 'x' }, cookie: w.cookies.reader }, p),
      // a payout recorder is not an approver and not a voider
      call(markPaidRoute, `/api/admin/third-party-payouts/${p.id}/mark-paid`, { body: { paidOn: dayStr(0), ...PAY }, cookie: w.cookies.recorder }, p),
      call(voidRoute, `/api/admin/third-party-payouts/${p.id}/void`, { body: { reason: 'Nope' }, cookie: w.cookies.recorder }, p),
    ]);
    expect(matrix.map((r) => [r.status, r.body.error.code])).toEqual(Array(6).fill([403, 'FORBIDDEN']));
    expect((await call(listRoute, '/api/admin/third-party-payouts', { cookie: w.cookies.reader })).status).toBe(200);
    expect((await ThirdPartyPayout.findById(payout._id).lean())?.status).toBe('due');
    expect(await AuditLog.countDocuments({})).toBe(0);
  });
});

describe('create', () => {
  it('records a due payout against a work order (201) with links copied, and warns above the balance', async () => {
    const w = await world();
    const res = await call(createRoute, '/api/admin/third-party-payouts', { body: { workOrderId: id(w.order), amountMinor: 1_200_000, note: 'Final' }, cookie: w.cookies.recorder });
    expect(res.status).toBe(201);
    expect(res.body.data.payout).toMatchObject({ status: 'due', workOrderId: id(w.order), clientId: id(w.client), projectId: id(w.project), amount: { currency: 'INR', amountMinor: 1_200_000, inrMinor: 1_200_000 } });
    expect(res.body.data.warnings).toHaveLength(1);
    expect((await WorkOrder.findById(w.order._id).lean())?.dueMinor).toBe(1_200_000);
    expect(JSON.stringify(res.body)).not.toMatch(/"_id"|"__v"/);
  });

  it('answers the typed money errors: LINK_MISMATCH, CURRENCY_MISMATCH and FX_RATE_MISSING (all 422), and 422 for forged or bad fields', async () => {
    const w = await world();
    const post = (body: unknown) => call(createRoute, '/api/admin/third-party-payouts', { body, cookie: w.cookies.recorder });
    const base = { workOrderId: id(w.order), amountMinor: 1000 };
    const link = await post({ ...base, clientId: id(await makeClient()) });
    expect([link.status, link.body.error.code]).toEqual([422, 'LINK_MISMATCH']);
    const currency = await post({ ...base, currency: 'USD' });
    expect([currency.status, currency.body.error.code]).toEqual([422, 'CURRENCY_MISMATCH']);
    const fx = await post({ thirdPartyId: id(w.party), projectId: id(w.project), amountMinor: 1000, currency: 'USD', dueOn: dayStr(0) });
    expect([fx.status, fx.body.error.code]).toEqual([422, 'FX_RATE_MISSING']);
    for (const bad of [{ inrMinor: 1 }, { status: 'paid' }, { amountMinor: 0 }, { amountMinor: 1.5 }, { dueOn: '2026-02-30' }, { tdsMinor: -1 }, { manualRate: 84, settledInrMinor: 100 }, { attachmentMediaIds: ['nope'] }]) {
      expect((await post({ ...base, ...bad })).status, JSON.stringify(bad)).toBe(422);
    }
    expect((await post({ amountMinor: 1000, currency: 'INR' })).body.error.fields.thirdPartyId).toBeDefined();
    expect(await ThirdPartyPayout.countDocuments({})).toBe(0);
  });

  it('takes private payout attachments only', async () => {
    const w = await world();
    const good = await makeMedia({ id: id(w.recorder), name: w.recorder.name }, { purpose: 'payout' });
    const bad = await makeMedia({ id: id(w.recorder), name: w.recorder.name }, { purpose: 'expense' });
    const post = (ids: string[]) => call(createRoute, '/api/admin/third-party-payouts', { body: { workOrderId: id(w.order), amountMinor: 1000, attachmentMediaIds: ids }, cookie: w.cookies.recorder });
    expect((await post([id(bad)])).body.error.fields.attachmentMediaIds).toBeDefined();
    const ok = await post([id(good)]);
    expect(ok.status).toBe(201);
    expect(ok.body.data.payout.attachments.map((a: { id: string }) => a.id)).toEqual([id(good)]);
  });
});

describe('edit, mark paid and void', () => {
  it('edits while due (200, with warnings) and answers ENTRY_LOCKED (409) once paid', async () => {
    const w = await world();
    const created = await call(createRoute, '/api/admin/third-party-payouts', { body: { workOrderId: id(w.order), amountMinor: 400_000 }, cookie: w.cookies.recorder });
    const pid = created.body.data.payout.id as string;
    const p = { id: pid };
    const patch = (cookie: string, body: unknown) => call(patchRoute, `/api/admin/third-party-payouts/${pid}`, { method: 'PATCH', body, cookie }, p);
    const edited = await patch(w.cookies.recorder, { amountMinor: 450_000, note: 'Revised' });
    expect(edited.status).toBe(200);
    expect(edited.body.data.payout).toMatchObject({ amount: { amountMinor: 450_000 }, note: 'Revised' });
    expect((await patch(w.cookies.recorder, { projectId: id(w.project) })).status).toBe(422); // links are not editable
    expect((await patch(w.cookies.recorder, {})).status).toBe(422);
    expect((await patch(w.cookies.recorder, { currency: 'USD' })).body.error.code).toBe('CURRENCY_MISMATCH');

    const paid = await call(markPaidRoute, `/api/admin/third-party-payouts/${pid}/mark-paid`, { body: { paidOn: dayStr(-1), ...PAY }, cookie: w.cookies.sa }, p);
    expect(paid.status).toBe(200);
    expect(paid.body.data.payout).toMatchObject({ status: 'paid', paidOn: dayStr(-1), mode: 'bank_transfer', transactionRef: 'UTR-001', paidBy: w.sa.name });
    const locked = await patch(w.cookies.recorder, { note: 'Too late' });
    expect([locked.status, locked.body.error.code]).toEqual([409, 'ENTRY_LOCKED']);
    expect((await WorkOrder.findById(w.order._id).lean())).toMatchObject({ paidMinor: 450_000, dueMinor: 0 });
  });

  it('mark paid re-captures the rate for the paid date and validates its fields', async () => {
    const w = await world();
    await setRate('USD', 83, dayStr(-3));
    await setRate('USD', 85, dayStr(-1));
    const created = await call(createRoute, '/api/admin/third-party-payouts', { body: { thirdPartyId: id(w.party), projectId: id(w.project), amountMinor: 100_000, currency: 'USD', dueOn: dayStr(-3) }, cookie: w.cookies.recorder });
    const p = { id: created.body.data.payout.id as string };
    const pay = (body: unknown) => call(markPaidRoute, `/api/admin/third-party-payouts/${p.id}/mark-paid`, { body, cookie: w.cookies.sa }, p);
    expect((await pay({ paidOn: dayStr(1), ...PAY })).body.error.fields.paidOn).toBeDefined();
    expect((await pay({ paidOn: dayStr(-1), mode: 'barter', transactionRef: 'x1' })).body.error.fields.mode).toBeDefined();
    expect((await pay({ paidOn: dayStr(-1), mode: 'upi' })).body.error.fields.transactionRef).toBeDefined();
    expect((await pay({ paidOn: dayStr(-1), ...PAY, inrMinor: 5 })).status).toBe(422);
    const done = await pay({ paidOn: dayStr(-1), ...PAY });
    expect(done.body.data.payout.amount).toMatchObject({ fxRate: 85, inrMinor: 8_500_000, fxDate: dayStr(-1) });
    expect((await pay({ paidOn: dayStr(-1), ...PAY })).body.error.code).toBe('CONFLICT');
  });

  it('void needs a reason, works once, and keeps the record', async () => {
    const w = await world();
    const payout = await makePayout(w.party, w.project, { order: w.order, status: 'due' });
    await WorkOrder.updateOne({ _id: w.order._id }, { $set: { dueMinor: 100_000 } });
    const p = { id: id(payout) };
    const post = (body: unknown, cookie = w.cookies.sa) => call(voidRoute, `/api/admin/third-party-payouts/${p.id}/void`, { body, cookie }, p);
    expect((await post({})).body.error.fields.reason).toBeDefined();
    expect((await post({ reason: 'x' })).status).toBe(422);
    const voided = await post({ reason: 'Entered against the wrong work order' });
    expect(voided.status).toBe(200);
    expect(voided.body.data.payout).toMatchObject({ status: 'void', voidReason: 'Entered against the wrong work order', voidedBy: w.sa.name });
    expect((await post({ reason: 'Again' })).body.error.code).toBe('CONFLICT');
    expect(await ThirdPartyPayout.countDocuments({})).toBe(1); // never deleted
    expect((await WorkOrder.findById(w.order._id).lean())?.dueMinor).toBe(0);
    expect((await call(getRoute, `/api/admin/third-party-payouts/${p.id}`, { cookie: w.cookies.reader }, p)).body.data.payout.status).toBe('void');
    expect((await call(getRoute, '/api/admin/third-party-payouts/nope', { cookie: w.cookies.reader }, { id: 'nope' })).status).toBe(404);
  });

  it('lists with filters and paging', async () => {
    const w = await world();
    await makePayout(w.party, w.project, { status: 'paid' });
    await makePayout(w.party, w.project, { status: 'due' });
    await makePayout(w.party, w.project, { status: 'void' });
    const get = async (q: string) => (await call(listRoute, `/api/admin/third-party-payouts${q}`, { cookie: w.cookies.reader })).body.data;
    expect((await get('')).meta.total).toBe(3);
    expect((await get('?status=due')).items).toHaveLength(1);
    expect((await get('?status=bogus&thirdParty=zzz')).meta.total).toBe(3); // bad filters are ignored
    expect((await get(`?thirdParty=${id(w.party)}&project=${id(w.project)}&pageSize=2&page=2`)).items).toHaveLength(1);
    expect((await get('?sort=dueOn&dir=asc')).items).toHaveLength(3);
  });
});
