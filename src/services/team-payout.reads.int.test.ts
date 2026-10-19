import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { getPayoutTotals, getTeamPayout, listPersonPayouts, listTeamPayouts, markTeamPayoutPaid, searchTeamPayouts, voidTeamPayout } from '@/services/team-payout.service';
import { makeMember } from '@/test/team-factories';
import {
  day,
  holding,
  logTime,
  makeAdmin,
  makePayoutWorld,
  NOW,
  payoutBody,
  recordPayout,
  rejects,
  sessionFor,
  setupTestDb,
  usdRate,
} from '@/test/team-payout-factories';

setupTestDb();

const PAID = { paidOn: '2026-05-10', mode: 'bank_transfer', transactionRef: 'UTR-001' };
const RANGE = { from: day('2026-04-01'), to: day('2027-03-31') };

/** A payout carrying everything a plain admin must never see. */
async function sensitivePayout() {
  const w = await makePayoutWorld();
  await logTime(w, 0, '2026-04-10', 60);
  const p = await recordPayout(w, {
    note: 'DEDUCT-FOR-LEAVE-NOTE',
    allocations: [{ projectId: String(w.projects[0]!._id), amountMinor: 1_000_000 }],
  });
  return { w, p };
}

describe('who may read a payout', () => {
  it('the person gets the plain version of their own payout: amounts, dates, mode and reference, and nothing internal', async () => {
    const { w, p } = await sensitivePayout();
    await markTeamPayoutPaid(w.sa, p.id, { ...PAID, note: 'DEDUCT-FOR-LEAVE-NOTE' }, {}, NOW);
    const own = await getTeamPayout(w.personSession, p.id, NOW);
    expect(own).toMatchObject({ ref: p.ref, status: 'paid', paidOn: '2026-05-10', mode: 'bank_transfer', transactionRef: 'UTR-001', amount: { amountMinor: 5_000_000, inrMinor: 5_000_000 }, detail: null });
    const text = JSON.stringify(own);
    for (const secret of ['DEDUCT-FOR-LEAVE-NOTE', w.projects[0]!.name, w.projects[0]!.ref, w.superadmin.name, 'allocations', 'suggestion', 'recordedBy']) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('a superadmin gets everything, and a person never sees the void reason of their own void payout', async () => {
    const { w, p } = await sensitivePayout();
    const full = await getTeamPayout(w.sa, p.id, NOW);
    expect(full.detail).toMatchObject({ note: 'DEDUCT-FOR-LEAVE-NOTE', recordedBy: w.superadmin.name });
    expect(full.detail?.allocations[0]).toMatchObject({ projectName: w.projects[0]!.name, amountMinor: 1_000_000 });
    await voidTeamPayout(w.sa, p.id, { reason: 'INTERNAL-VOID-REASON' }, {}, NOW);
    const own = await getTeamPayout(w.personSession, p.id, NOW);
    expect(own.status).toBe('void');
    expect(JSON.stringify(own)).not.toContain('INTERNAL-VOID-REASON');
    expect((await getTeamPayout(w.sa, p.id, NOW)).detail?.voidReason).toBe('INTERNAL-VOID-REASON');
  });

  it('refuses a colleague, and anyone without team:payView who is not the person, whatever the id spelling', async () => {
    const { w, p } = await sensitivePayout();
    const colleague = await sessionFor(await makeAdmin());
    expect((await rejects(getTeamPayout(colleague, p.id, NOW))).code).toBe('FORBIDDEN');
    expect((await rejects(getTeamPayout(holding(colleague, 'team:view', 'teamPayout:record', 'money:approve', 'money:void', 'audit:viewAll'), p.id, NOW))).code).toBe('FORBIDDEN');
    // the person with their capabilities taken away is still the person: reading their own is not a capability
    expect((await getTeamPayout(holding(w.personSession), p.id.toUpperCase(), NOW)).detail).toBeNull();
    // and a holder of team:payView who is not the person gets the full version
    expect((await getTeamPayout(holding(colleague, 'team:payView'), p.id, NOW)).detail?.note).toBe('DEDUCT-FOR-LEAVE-NOTE');
  });

  it('404s an unknown or malformed id', async () => {
    const w = await makePayoutWorld();
    expect((await rejects(getTeamPayout(w.sa, String(new Types.ObjectId()), NOW))).code).toBe('NOT_FOUND');
    expect((await rejects(getTeamPayout(w.sa, 'nope', NOW))).code).toBe('NOT_FOUND');
  });

  it('warns on a single read of a due payout that overlaps another, so the pay dialog can say so first', async () => {
    const w = await makePayoutWorld();
    const a = await recordPayout(w);
    const b = await recordPayout(w, { periodFrom: '2026-04-20', periodTo: '2026-05-05' });
    expect((await getTeamPayout(w.sa, b.id, NOW)).detail?.warnings.join(' ')).toContain(a.ref);
    expect((await getTeamPayout(w.sa, a.id, NOW)).detail?.warnings.join(' ')).toContain(b.ref);
  });
});

describe('listing payouts', () => {
  it('a superadmin sees everyone\'s; a plain admin sees only their own, and is refused (not narrowed) when asking for someone else\'s', async () => {
    const w = await makePayoutWorld();
    const other = await makePayoutWorld();
    await recordPayout(w);
    await recordPayout(other);
    expect((await searchTeamPayouts(w.sa)).items).toHaveLength(2);
    const own = await searchTeamPayouts(w.personSession);
    expect(own.items.map((i) => i.adminId)).toEqual([String(w.person._id)]);
    expect(own.items[0]?.detail).toBeNull();
    expect((await searchTeamPayouts(w.personSession, { adminId: String(w.person._id) })).items).toHaveLength(1);
    expect((await rejects(searchTeamPayouts(w.personSession, { adminId: String(other.person._id) }))).code).toBe('FORBIDDEN');
    // a plain admin with no payouts sees an empty list, not an error
    expect((await searchTeamPayouts(await sessionFor(await makeAdmin()))).items).toEqual([]);
  });

  it('filters by person, status and search, and matches search text literally', async () => {
    const w = await makePayoutWorld();
    const dotted = await makeMember({ name: 'A.B Chen' });
    const plain = await makeMember({ name: 'AxB Chen' });
    const a = await recordPayout(w);
    const b = await recordPayout({ ...w, person: dotted }, {});
    await recordPayout({ ...w, person: plain }, {});
    await markTeamPayoutPaid(w.sa, a.id, PAID, {}, NOW);

    expect((await searchTeamPayouts(w.sa, { adminId: String(w.person._id) })).items.map((i) => i.id)).toEqual([a.id]);
    expect((await searchTeamPayouts(w.sa, { status: 'paid' })).items.map((i) => i.id)).toEqual([a.id]);
    expect((await searchTeamPayouts(w.sa, { status: 'due' })).items).toHaveLength(2);
    expect((await searchTeamPayouts(w.sa, { status: 'void' })).items).toHaveLength(0);
    expect((await searchTeamPayouts(w.sa, { q: 'A.B' })).items.map((i) => i.id)).toEqual([b.id]); // the dot is a dot, not "any character"
    expect((await searchTeamPayouts(w.sa, { q: '.*' })).items).toHaveLength(0);
    expect((await searchTeamPayouts(w.sa, { q: a.ref.toLowerCase() })).items.map((i) => i.id)).toEqual([a.id]);
    expect((await searchTeamPayouts(w.sa, { q: 'a.b chen', status: 'due', adminId: String(dotted._id) })).items.map((i) => i.id)).toEqual([b.id]);
  });

  it('puts a payout in a period by the day it was paid, or by its due date until then', async () => {
    const w = await makePayoutWorld();
    const paid = await recordPayout(w, { dueOn: '2026-04-28' });
    await markTeamPayoutPaid(w.sa, paid.id, { ...PAID, paidOn: '2026-05-10' }, {}, NOW); // due in April, paid in May
    const dueJune = await recordPayout(w, { dueOn: '2026-06-05', periodFrom: '2026-05-01', periodTo: '2026-05-31' });
    const ids = async (from: string, to: string) => (await searchTeamPayouts(w.sa, { from: day(from), to: day(to) })).items.map((i) => i.id).sort();
    expect(await ids('2026-05-01', '2026-05-31')).toEqual([paid.id]);
    expect(await ids('2026-04-01', '2026-04-30')).toEqual([]); // its due date is in April, but it was paid in May
    expect(await ids('2026-06-01', '2026-06-30')).toEqual([dueJune.id]);
    expect(await ids('2026-05-10', '2026-05-10')).toEqual([paid.id]); // both ends inclusive
    expect((await searchTeamPayouts(w.sa, { to: day('2026-05-31') })).items).toHaveLength(1); // open-ended on one side
  });

  it('sorts, pages and reports the totals', async () => {
    const w = await makePayoutWorld();
    for (const [i, amountMinor] of [300_000, 100_000, 200_000, 400_000, 500_000].entries()) {
      await recordPayout(w, { amountMinor, dueOn: `2026-05-0${i + 1}` });
    }
    const byAmount = await searchTeamPayouts(w.sa, { sort: 'amount', dir: 'asc', pageSize: 2 });
    expect(byAmount.items.map((i) => i.amount.amountMinor)).toEqual([100_000, 200_000]);
    expect(byAmount.meta).toMatchObject({ total: 5, pages: 3, page: 1, from: 1, to: 2 });
    const page3 = await searchTeamPayouts(w.sa, { sort: 'amount', dir: 'asc', pageSize: 2, page: 3 });
    expect(page3.items.map((i) => i.amount.amountMinor)).toEqual([500_000]);
    expect((await searchTeamPayouts(w.sa, { sort: 'dueOn', dir: 'desc', pageSize: 1 })).items[0]?.dueOn).toBe('2026-05-05');
    expect((await searchTeamPayouts(w.sa, { page: 99, pageSize: 2 })).meta.page).toBe(3); // clamped, never an empty page past the end
  });

  it('the route entry parses the query text and refuses a bad one', async () => {
    const w = await makePayoutWorld();
    await recordPayout(w);
    expect((await listTeamPayouts(w.sa, { status: 'due', from: '2026-05-01', to: '2026-05-31', page: '1', sort: 'dueOn', dir: 'asc' })).items).toHaveLength(1);
    expect((await rejects(listTeamPayouts(w.sa, { status: 'pending' }))).fields?.status).toBeTruthy();
    expect((await rejects(listTeamPayouts(w.sa, { from: '2026-13-01' }))).fields?.from).toBeTruthy();
    expect((await rejects(listTeamPayouts(w.sa, { adminId: 'nope' }))).fields?.adminId).toBeTruthy();
    expect((await rejects(listTeamPayouts(w.sa, { sort: 'password' }))).fields?.sort).toBeTruthy();
    expect((await rejects(listTeamPayouts(w.sa, { colour: 'red' }))).code).toBe('VALIDATION_FAILED');
  });

  it('a person\'s own latest payouts: the person themself or team:payView, nobody else', async () => {
    const w = await makePayoutWorld();
    for (let i = 1; i <= 4; i++) await recordPayout(w, { dueOn: `2026-05-0${i}` });
    expect(await listPersonPayouts(w.personSession, String(w.person._id), 3)).toHaveLength(3);
    expect((await listPersonPayouts(w.personSession, String(w.person._id)))[0]?.detail).toBeNull();
    expect((await listPersonPayouts(w.sa, String(w.person._id)))[0]?.detail).not.toBeNull();
    expect((await rejects(listPersonPayouts(await sessionFor(await makeAdmin()), String(w.person._id)))).code).toBe('FORBIDDEN');
    expect((await rejects(listPersonPayouts(w.sa, 'nope'))).code).toBe('NOT_FOUND');
    expect(await listPersonPayouts(w.sa, String(new Types.ObjectId()))).toEqual([]);
  });
});

describe('the totals band', () => {
  it('is zero on an empty database, never NaN', async () => {
    const w = await makePayoutWorld();
    expect(await getPayoutTotals(w.sa, RANGE, {}, NOW)).toEqual({
      paid: { inrMinor: 0, count: 0, native: [], unallocatedInrMinor: 0 },
      due: { inrMinor: 0, count: 0, overdueCount: 0, native: [] },
      owed: { inrMinor: 0, count: 0 },
    });
  });

  it('sums INR only, by paid date and due date, leaves void out, and lists foreign currency as a second line', async () => {
    const w = await makePayoutWorld();
    await usdRate(80, '2026-05-04');
    await usdRate(80, '2026-05-08');
    const ids = w.projects.map((p) => String(p._id));
    // paid in INR, with 1,000,000 of 5,000,000 charged to a project (4,000,000 overhead)
    const a = await recordPayout(w, { allocations: [{ projectId: ids[0]!, amountMinor: 1_000_000 }] });
    await markTeamPayoutPaid(w.sa, a.id, PAID, {}, NOW);
    // paid in USD at 80
    const b = await recordPayout(w, { currency: 'USD', amountMinor: 10_000, basis: 'bonus' });
    await markTeamPayoutPaid(w.sa, b.id, PAID, {}, NOW);
    // paid in another financial year: not in this period
    const old = await recordPayout(w, { dueOn: '2026-03-10', periodFrom: '2026-02-01', periodTo: '2026-02-28' });
    await markTeamPayoutPaid(w.sa, old.id, { ...PAID, paidOn: '2026-03-11' }, {}, NOW);
    // due: one overdue (due last month), one not yet
    await recordPayout(w, { dueOn: '2026-09-05', periodFrom: '2026-08-01', periodTo: '2026-08-31', amountMinor: 700_000 });
    await recordPayout(w, { dueOn: '2026-11-05', periodFrom: '2026-10-01', periodTo: '2026-10-31', amountMinor: 900_000 });
    // void: counted nowhere
    const gone = await recordPayout(w, { dueOn: '2026-09-06', periodFrom: '2026-07-01', periodTo: '2026-07-31', amountMinor: 123_456 });
    await voidTeamPayout(w.sa, gone.id, { reason: 'Entered by mistake' }, {}, NOW);

    const t = await getPayoutTotals(w.sa, RANGE, {}, NOW);
    expect(t.paid).toEqual({ inrMinor: 5_000_000 + 800_000, count: 2, native: [{ currency: 'USD', amountMinor: 10_000, inrMinor: 800_000 }], unallocatedInrMinor: 4_000_000 + 800_000 });
    expect(t.due).toEqual({ inrMinor: 1_600_000, count: 2, overdueCount: 1, native: [] });
    expect(t.owed).toEqual({ inrMinor: 1_600_000, count: 2 });
    // another financial year
    expect((await getPayoutTotals(w.sa, { from: day('2025-04-01'), to: day('2026-03-31') }, {}, NOW)).paid.inrMinor).toBe(5_000_000);
  });

  it('follows the person filter, and "owed" ignores the period', async () => {
    const w = await makePayoutWorld();
    const other = await makePayoutWorld();
    await recordPayout(w, { dueOn: '2025-01-05', periodFrom: '2024-12-01', periodTo: '2024-12-31', amountMinor: 111_100 });
    await recordPayout(other, { amountMinor: 222_200 });
    const mine = await getPayoutTotals(w.sa, RANGE, { adminId: String(w.person._id) }, NOW);
    expect(mine.owed).toEqual({ inrMinor: 111_100, count: 1 }); // due long ago, still owed
    expect(mine.due.count).toBe(0); // its due date is outside this financial year
    expect((await getPayoutTotals(w.sa, RANGE, {}, NOW)).owed.inrMinor).toBe(333_300);
    expect((await rejects(getPayoutTotals(w.sa, RANGE, { adminId: 'nope' }, NOW))).code).toBe('NOT_FOUND');
  });

  it('is for team:payView only', async () => {
    const w = await makePayoutWorld();
    expect((await rejects(getPayoutTotals(w.personSession, RANGE, {}, NOW))).code).toBe('FORBIDDEN');
    expect((await rejects(getPayoutTotals(await sessionFor(await makeAdmin()), RANGE, {}, NOW))).code).toBe('FORBIDDEN');
  });
});

describe('what the payout does to the dashboards that read it', () => {
  it('the person dashboard\'s pay section moves from due to paid with the same payout', async () => {
    const { getPersonDashboard } = await import('@/services/dashboards/person');
    const { resolvePeriod } = await import('@/lib/dates/ranges');
    const w = await makePayoutWorld();
    const period = resolvePeriod({}, NOW);
    const p = await recordPayout(w);
    expect((await getPersonDashboard(w.personSession, String(w.person._id), period, NOW)).pay).toMatchObject({ dueCount: 1, dueInrMinor: 5_000_000, paidInPeriodInrMinor: 0 });
    await markTeamPayoutPaid(w.sa, p.id, PAID, {}, NOW);
    expect((await getPersonDashboard(w.personSession, String(w.person._id), period, NOW)).pay).toMatchObject({ dueCount: 0, paidInPeriodInrMinor: 5_000_000, paidInPeriodCount: 1 });
  });

  it('payoutBody is what a form would send (sanity for the fixtures)', async () => {
    const w = await makePayoutWorld();
    expect(payoutBody(w)).toMatchObject({ basis: 'salary', currency: 'INR', amountMinor: 5_000_000 });
  });
});
