import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { GET as suggestionGet } from '@/app/api/admin/team-payouts/suggestion/route';
import { GET as listGet, POST as createPost } from '@/app/api/admin/team-payouts/route';
import { GET as oneGet, PATCH as onePatch } from '@/app/api/admin/team-payouts/[id]/route';
import { POST as markPaidPost } from '@/app/api/admin/team-payouts/[id]/mark-paid/route';
import { POST as voidPost } from '@/app/api/admin/team-payouts/[id]/void/route';
import { AuditLog, TeamPayout, WorkLog } from '@/models';
import { call, cookieFor } from '@/test/factories';
import { logTime, makeAdmin, makePayoutWorld, payoutBody, recordPayout, setupTestDb } from '@/test/team-payout-factories';

setupTestDb();

const BASE = '/api/admin/team-payouts';
const PAID = { paidOn: '2026-05-10', mode: 'bank_transfer', transactionRef: 'UTR-77' };

async function world() {
  const w = await makePayoutWorld();
  return {
    w,
    sa: { cookie: await cookieFor(w.superadmin) },
    person: { cookie: await cookieFor(w.person) },
    colleague: { cookie: await cookieFor(await makeAdmin()) },
  };
}

describe('GET /api/admin/team-payouts', () => {
  it('needs a session, then answers by scope: superadmin everyone, a person their own, nobody else\'s', async () => {
    const { w, sa, person, colleague } = await world();
    await recordPayout(w);
    expect((await call(listGet, BASE)).status).toBe(401);

    const all = await call(listGet, BASE, sa);
    expect(all.status).toBe(200);
    expect(all.body.data.payouts).toHaveLength(1);
    expect(all.body.data.payouts[0].detail).not.toBeNull();

    const own = await call(listGet, BASE, person);
    expect(own.status).toBe(200);
    expect(own.body.data.payouts[0].detail).toBeNull();

    expect((await call(listGet, `${BASE}?adminId=${w.person._id}`, colleague)).status).toBe(403);
    const none = await call(listGet, BASE, colleague);
    expect(none.status).toBe(200);
    expect(none.body.data.payouts).toEqual([]);
  });

  it('filters from the query string and answers 422 for a malformed one', async () => {
    const { w, sa } = await world();
    await recordPayout(w);
    expect((await call(listGet, `${BASE}?status=due&from=2026-05-01&to=2026-05-31&sort=amount&dir=asc`, sa)).body.data.payouts).toHaveLength(1);
    expect((await call(listGet, `${BASE}?status=paid`, sa)).body.data.payouts).toHaveLength(0);
    const bad = await call(listGet, `${BASE}?status=pending&from=2026-13-01`, sa);
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    expect(bad.body.error.fields.status).toBeTruthy();
    expect((await call(listGet, `${BASE}?status=`, sa)).status).toBe(200); // an empty value is "not set"
  });
});

describe('POST /api/admin/team-payouts', () => {
  it('needs teamPayout:record: a person, a colleague and an admin with every grant get 403 and nothing is written', async () => {
    const { w, person, colleague } = await world();
    const granted = { cookie: await cookieFor(await makeAdmin({ grants: ['payment:record', 'payout:record', 'expense:record'] })) };
    for (const who of [person, colleague, granted]) {
      const res = await call(createPost, BASE, { method: 'POST', body: payoutBody(w), ...who });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect(await TeamPayout.countDocuments()).toBe(0);
    expect((await call(createPost, BASE, { method: 'POST', body: payoutBody(w) })).status).toBe(401);
  });

  it('records a due payout for a superadmin (201), with the warnings next to it', async () => {
    const { w, sa } = await world();
    const first = await call(createPost, BASE, { method: 'POST', body: payoutBody(w), ...sa });
    expect(first.status).toBe(201);
    expect(first.body.data.payout).toMatchObject({ ref: 'TMP-FY27-0001', status: 'due', amount: { inrMinor: 5_000_000 } });
    expect(first.body.data.warnings).toEqual([]);
    const second = await call(createPost, BASE, { method: 'POST', body: payoutBody(w, { periodFrom: '2026-04-15' }), ...sa });
    expect(second.status).toBe(201);
    expect(second.body.data.warnings[0]).toContain('TMP-FY27-0001');
    expect(await AuditLog.countDocuments({ action: 'teamPayout.create' })).toBe(2);
  });

  it('answers 422 with the field for a body that fails the schema, and ignores an INR value sent by the client', async () => {
    const { w, sa } = await world();
    const post = (body: unknown) => call(createPost, BASE, { method: 'POST', body, ...sa });
    const text = await post({ ...payoutBody(w), amountMinor: '5000' });
    expect(text.status).toBe(422);
    expect(text.body.error.fields.amountMinor).toBeTruthy();
    expect((await post({ ...payoutBody(w), inrMinor: 1 })).status).toBe(422);
    expect((await post({ ...payoutBody(w), allocations: [{ projectId: String(w.projects[0]!._id), amountMinor: 1, inrMinor: 1 }] })).status).toBe(422);
    expect((await post({ ...payoutBody(w), allocations: [{ projectId: String(w.projects[0]!._id), amountMinor: 6_000_000 }] })).body.error.fields.allocations).toMatch(/more than the payout/);
    expect((await call(createPost, BASE, { method: 'POST', rawBody: '{nope', headers: { 'content-type': 'application/json' }, ...sa })).status).toBeGreaterThanOrEqual(400);
    expect(await TeamPayout.countDocuments()).toBe(0);
  });

  it('answers FX_RATE_MISSING (422) for a foreign amount with no rate', async () => {
    const { w, sa } = await world();
    const res = await call(createPost, BASE, { method: 'POST', body: payoutBody(w, { currency: 'USD', amountMinor: 100_000 }), ...sa });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'FX_RATE_MISSING', fields: { fxRate: expect.any(String) } });
  });
});

describe('GET /api/admin/team-payouts/suggestion', () => {
  it('is for superadmins; a person or colleague gets 403, a missing query 422', async () => {
    const { w, sa, person, colleague } = await world();
    await logTime(w, 0, '2026-04-10', 90);
    const url = `${BASE}/suggestion?adminId=${w.person._id}&from=2026-04-01&to=2026-04-30`;
    const ok = await call(suggestionGet, url, sa);
    expect(ok.status).toBe(200);
    expect(ok.body.data.suggestion).toMatchObject({ computedMinor: 5_000_000, payoutBasis: 'salary', minutes: 90 });
    expect((await call(suggestionGet, url, person)).status).toBe(403);
    expect((await call(suggestionGet, url, colleague)).status).toBe(403);
    expect((await call(suggestionGet, url)).status).toBe(401);
    const bad = await call(suggestionGet, `${BASE}/suggestion`, sa);
    expect(bad.status).toBe(422);
    expect(bad.body.error.fields.adminId).toBeTruthy();
  });
});

describe('GET and PATCH /api/admin/team-payouts/[id]', () => {
  it('reads: the person gets the plain version, a colleague 403, a superadmin everything, a bad id 404', async () => {
    const { w, sa, person, colleague } = await world();
    const p = await recordPayout(w, { note: 'INTERNAL-NOTE' });
    const path = `${BASE}/${p.id}`;
    const own = await call(oneGet, path, person, { id: p.id });
    expect(own.status).toBe(200);
    expect(own.body.data.payout.detail).toBeNull();
    expect(JSON.stringify(own.body)).not.toContain('INTERNAL-NOTE');
    expect((await call(oneGet, path, colleague, { id: p.id })).status).toBe(403);
    expect((await call(oneGet, path, sa, { id: p.id })).body.data.payout.detail.note).toBe('INTERNAL-NOTE');
    expect((await call(oneGet, `${BASE}/nope`, sa, { id: 'nope' })).status).toBe(404);
    expect((await call(oneGet, `${BASE}/${new Types.ObjectId()}`, sa, { id: String(new Types.ObjectId()) })).status).toBe(404);
  });

  it('edits a due payout for a superadmin only, and a paid one answers 409 ENTRY_LOCKED', async () => {
    const { w, sa, person } = await world();
    const p = await recordPayout(w);
    const path = `${BASE}/${p.id}`;
    expect((await call(onePatch, path, { method: 'PATCH', body: { note: 'x' }, ...person }, { id: p.id })).status).toBe(403);
    const edited = await call(onePatch, path, { method: 'PATCH', body: { amountMinor: 4_000_000 }, ...sa }, { id: p.id });
    expect(edited.status).toBe(200);
    expect(edited.body.data.payout.amount.amountMinor).toBe(4_000_000);
    expect((await call(onePatch, path, { method: 'PATCH', body: {}, ...sa }, { id: p.id })).status).toBe(422);
    expect((await call(onePatch, path, { method: 'PATCH', body: { adminId: String(new Types.ObjectId()) }, ...sa }, { id: p.id })).status).toBe(422); // the person cannot change

    await call(markPaidPost, `${path}/mark-paid`, { method: 'POST', body: PAID, ...sa }, { id: p.id });
    const late = await call(onePatch, path, { method: 'PATCH', body: { note: 'late' }, ...sa }, { id: p.id });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('ENTRY_LOCKED');
  });
});

describe('POST /api/admin/team-payouts/[id]/mark-paid and /void', () => {
  it('mark-paid needs money:approve (403 otherwise), validates (422), locks the logs, and only works once (409)', async () => {
    const { w, sa, person, colleague } = await world();
    const log = await logTime(w, 0, '2026-04-10', 60);
    const p = await recordPayout(w);
    const path = `${BASE}/${p.id}/mark-paid`;
    for (const who of [person, colleague]) expect((await call(markPaidPost, path, { method: 'POST', body: PAID, ...who }, { id: p.id })).status).toBe(403);
    expect((await call(markPaidPost, path, { method: 'POST', body: { ...PAID, transactionRef: '' }, ...sa }, { id: p.id })).status).toBe(422);
    expect((await call(markPaidPost, path, { method: 'POST', body: { ...PAID, mode: 'barter' }, ...sa }, { id: p.id })).body.error.fields.mode).toBeTruthy();
    expect((await WorkLog.findById(log._id).lean())?.lockedByPayoutId).toBeUndefined();

    const paid = await call(markPaidPost, path, { method: 'POST', body: PAID, ...sa }, { id: p.id });
    expect(paid.status).toBe(200);
    expect(paid.body.data.payout).toMatchObject({ status: 'paid', paidOn: '2026-05-10', transactionRef: 'UTR-77' });
    expect((await WorkLog.findById(log._id).lean())?.lockedByPayoutId?.toString()).toBe(p.id);
    expect((await call(markPaidPost, path, { method: 'POST', body: PAID, ...sa }, { id: p.id })).status).toBe(409);
    expect((await call(markPaidPost, `${BASE}/nope/mark-paid`, { method: 'POST', body: PAID, ...sa }, { id: 'nope' })).status).toBe(404);
    expect((await call(markPaidPost, path, { method: 'POST', body: PAID })).status).toBe(401);
  });

  it('void needs money:void and a reason, releases the locks, and only works once', async () => {
    const { w, sa, person } = await world();
    const log = await logTime(w, 0, '2026-04-10', 60);
    const p = await recordPayout(w);
    await call(markPaidPost, `${BASE}/${p.id}/mark-paid`, { method: 'POST', body: PAID, ...sa }, { id: p.id });
    const path = `${BASE}/${p.id}/void`;
    expect((await call(voidPost, path, { method: 'POST', body: { reason: 'Wrong person' }, ...person }, { id: p.id })).status).toBe(403);
    expect((await call(voidPost, path, { method: 'POST', body: { reason: '' }, ...sa }, { id: p.id })).status).toBe(422);
    expect((await call(voidPost, path, { method: 'POST', body: {}, ...sa }, { id: p.id })).status).toBe(422);
    const voided = await call(voidPost, path, { method: 'POST', body: { reason: 'Wrong person' }, ...sa }, { id: p.id });
    expect(voided.status).toBe(200);
    expect(voided.body.data.payout).toMatchObject({ status: 'void' });
    expect((await WorkLog.findById(log._id).lean())?.lockedByPayoutId).toBeUndefined();
    expect((await call(voidPost, path, { method: 'POST', body: { reason: 'Again' }, ...sa }, { id: p.id })).status).toBe(409);
  });
});
