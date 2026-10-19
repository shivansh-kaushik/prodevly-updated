import { describe, expect, it } from 'vitest';
import {
  getCompanyTotals,
  getProjectMargins,
  ledgerUnionPipeline,
  resolveInternalClientId,
  runLedger,
  type LedgerRow,
} from '@/services/dashboards/ledger';
import { setupTestDb } from '@/test/db';
import { makeClient, makeProject } from '@/test/domain-factories';
import {
  D,
  makeExpense,
  makeInternalClient,
  makePayment,
  makeTeamPayout,
  makeThirdPartyPayout,
} from '@/test/project-factories';

setupTestDb();

/** Two external clients, an internal one, and a project each (client A has two). */
async function world() {
  const a = await makeClient({ name: 'Client A' });
  const b = await makeClient({ name: 'Client B' });
  const internal = await makeInternalClient();
  const pA1 = await makeProject(a, { name: 'A one' });
  const pA2 = await makeProject(a, { name: 'A two' });
  const pB = await makeProject(b, { name: 'B one' });
  const pI = await makeProject(internal, { name: 'Our own product' });
  return { a, b, internal, pA1, pA2, pB, pI };
}

/** Every kind of entry, settled and not, so each counting rule has something to exclude. */
async function seedLedger() {
  const w = await world();

  // client payments on A one: two receipts (one in USD), a refund, a voided receipt
  await makePayment(w.pA1, { amountMinor: 1_000_000, receivedOn: '2026-06-10' });
  await makePayment(w.pA1, { amountMinor: 100_000, currency: 'USD', rate: 83.42, receivedOn: '2026-07-05' }); // INR 83,420.00
  await makePayment(w.pA1, { type: 'refund', amountMinor: 200_000, receivedOn: '2026-07-20' });
  await makePayment(w.pA1, { status: 'void', amountMinor: 5_000_000, receivedOn: '2026-06-11' });
  // a receipt booked against the internal project: not revenue
  await makePayment(w.pI, { amountMinor: 700_000, receivedOn: '2026-06-12' });

  // third-party payouts: only paid counts, dated by paidOn (not dueOn)
  await makeThirdPartyPayout(w.pA1, { amountMinor: 300_000, status: 'paid', paidOn: '2026-06-15', dueOn: '2026-07-10' });
  await makeThirdPartyPayout(w.pA1, { amountMinor: 900_000, status: 'due', dueOn: '2026-06-20' });
  await makeThirdPartyPayout(w.pA1, { amountMinor: 400_000, status: 'void' });

  // expenses: approved and paid count; submitted, rejected and void do not; company overhead has no project
  await makeExpense({ project: w.pA1, amountMinor: 100_000, status: 'approved', spentOn: '2026-06-12' });
  await makeExpense({ project: w.pA1, amountMinor: 50_000, status: 'paid', spentOn: '2026-06-13' });
  await makeExpense({ project: w.pA1, amountMinor: 77_000, status: 'submitted', spentOn: '2026-06-14' });
  await makeExpense({ project: w.pA1, amountMinor: 88_000, status: 'rejected', spentOn: '2026-06-14' });
  await makeExpense({ project: w.pA1, amountMinor: 99_000, status: 'void', spentOn: '2026-06-14' });
  await makeExpense({ amountMinor: 40_000, status: 'paid', spentOn: '2026-06-20' });
  await makeExpense({ project: w.pI, amountMinor: 30_000, status: 'paid', spentOn: '2026-06-21' });

  // team payouts: paid counts. One payout split across two projects, the rest is overhead
  await makeTeamPayout({
    amountMinor: 1_000_000,
    status: 'paid',
    paidOn: '2026-06-30',
    allocations: [
      { project: w.pA1, amountMinor: 400_000 },
      { project: w.pA2, amountMinor: 300_000 },
    ],
  });
  await makeTeamPayout({ amountMinor: 500_000, status: 'due', allocations: [{ project: w.pA1, amountMinor: 500_000 }] });
  await makeTeamPayout({ amountMinor: 250_000, status: 'void', allocations: [{ project: w.pA1, amountMinor: 250_000 }] });
  return w;
}

const key = (r: LedgerRow) => `${r.kind}:${r.inrMinor}`;

describe('ledgerUnionPipeline', () => {
  it('starts from client payments and unions the other three collections', () => {
    const stages = ledgerUnionPipeline();
    expect(stages[0]).toHaveProperty('$match');
    const unions = stages.filter((s) => '$unionWith' in s).map((s) => (s as { $unionWith: { coll: string } }).$unionWith.coll);
    expect(unions).toEqual(['thirdpartypayouts', 'expenses', 'teampayouts']);
  });

  it('builds filters from parsed primitives only and refuses anything else', () => {
    expect(() => ledgerUnionPipeline({ projectId: 'not-an-id' })).toThrow(/24-character hex/);
    expect(() => ledgerUnionPipeline({ clientId: '{"$ne":null}' })).toThrow(/24-character hex/);
    expect(() => ledgerUnionPipeline({ projectIds: ['5f3a9c0b1d2e4f6a8b7c9d0e', 'x'] })).toThrow(/24-character hex/);
    const id = '5f3a9c0b1d2e4f6a8b7c9d0e';
    expect(() => ledgerUnionPipeline({ projectId: id, projectIds: [id] })).toThrow(/not both/);
    expect(() => ledgerUnionPipeline({ range: { from: D('2026-07-02'), to: D('2026-07-01') } })).toThrow(/range/);
  });
});

describe('what counts', () => {
  it('counts only settled money, one common row per entry', async () => {
    await seedLedger();
    const rows = await runLedger({ scope: 'company' });
    // 4 receipts (3 on A one + the internal one), 1 paid payout, 4 expenses, 1 team payout (whole)
    expect(rows).toHaveLength(10);
    const kinds = rows.map((r) => r.kind).sort();
    expect(kinds).toEqual(['expense', 'expense', 'expense', 'expense', 'receipt', 'receipt', 'receipt', 'refund', 'teamPayout', 'thirdPartyPayout']);
    expect(rows.every((r) => r.inrMinor !== 0 && r.currency && r.fxSource && r.date instanceof Date)).toBe(true);
  });

  it('never includes void or rejected entries, due payouts or submitted expenses', async () => {
    await seedLedger();
    const inr = (await runLedger({ scope: 'company' })).map((r) => r.inrMinor);
    for (const excluded of [5_000_000, 900_000, 400_000, 77_000, 88_000, 99_000, 500_000, 250_000]) {
      expect(inr).not.toContain(excluded);
    }
  });

  it('signs refunds negative in both INR and native amounts', async () => {
    await seedLedger();
    const refund = (await runLedger({ scope: 'company' })).find((r) => r.kind === 'refund');
    expect(refund).toMatchObject({ inrMinor: -200_000, nativeMinor: -200_000, currency: 'INR', fxSource: 'identity' });
  });

  it('keeps a foreign-currency entry as INR for totals and as its own amount for the secondary line', async () => {
    await seedLedger();
    const usd = (await runLedger({ scope: 'company' })).find((r) => r.currency === 'USD');
    expect(usd).toMatchObject({ kind: 'receipt', inrMinor: 8_342_000, nativeMinor: 100_000, fxSource: 'table' });
  });

  it('uses the settlement date of each collection, not the due date', async () => {
    await seedLedger();
    const july = await runLedger({ scope: 'company', range: { from: D('2026-07-01'), to: D('2026-07-31') } });
    // the paid payout was DUE in July but PAID in June, so it is not a July row
    expect(july.map(key).sort()).toEqual(['receipt:8342000', 'refund:-200000']);
    const june = await runLedger({ scope: 'company', range: { from: D('2026-06-01'), to: D('2026-06-30') } });
    expect(june.map((r) => r.kind)).toContain('thirdPartyPayout');
    expect(june.map((r) => r.kind)).toContain('teamPayout');
  });

  it('includes both ends of the range', async () => {
    await seedLedger();
    const day = await runLedger({ range: { from: D('2026-06-10'), to: D('2026-06-10') } });
    expect(day.map(key)).toEqual(['receipt:1000000']);
    expect(await runLedger({ range: { from: D('2026-06-01'), to: D('2026-06-09') } })).toEqual([]);
    expect(await runLedger({ range: { from: D('2026-06-11'), to: D('2026-06-11') } })).toEqual([]); // the voided receipt
  });

  it('is empty on an empty database', async () => {
    expect(await runLedger({})).toEqual([]);
    expect(await getCompanyTotals()).toEqual({ receivedInr: 0, thirdPartyInr: 0, expenseInr: 0, teamInr: 0, netInr: 0 });
    expect(await getProjectMargins()).toEqual([]);
  });
});

describe('team payouts', () => {
  it('stay whole in company views', async () => {
    await seedLedger();
    const team = (await runLedger({ scope: 'company' })).filter((r) => r.kind === 'teamPayout');
    expect(team).toHaveLength(1);
    expect(team[0]).toMatchObject({ inrMinor: 1_000_000, clientId: null, projectId: null });
  });

  it('are unwound by allocation in project views, and the overhead remainder is nobody\'s project cost', async () => {
    const w = await seedLedger();
    const team = (await runLedger({ scope: 'project' })).filter((r) => r.kind === 'teamPayout');
    expect(team.map((r) => [String(r.projectId), r.inrMinor]).sort()).toEqual(
      [[String(w.pA1._id), 400_000], [String(w.pA2._id), 300_000]].sort(),
    );
    expect(team.reduce((s, r) => s + r.inrMinor, 0)).toBe(700_000); // 300,000 of the payout is overhead
  });

  it('carry the payout currency on an allocation of a foreign-currency payout', async () => {
    const w = await world();
    await makeTeamPayout({ amountMinor: 100_000, currency: 'USD', rate: 83.42, allocations: [{ project: w.pA1, amountMinor: 40_000 }] });
    const [row] = await runLedger({ scope: 'project' });
    expect(row).toMatchObject({ kind: 'teamPayout', currency: 'USD', nativeMinor: 40_000, inrMinor: 3_336_800 });
    const [whole] = await runLedger({ scope: 'company' });
    expect(whole).toMatchObject({ nativeMinor: 100_000, inrMinor: 8_342_000 });
  });

  it('only the allocations of the asked-for project come out of a payout shared by two', async () => {
    const w = await seedLedger();
    const rows = await runLedger({ projectId: String(w.pA2._id) });
    expect(rows.map(key)).toEqual(['teamPayout:300000']);
  });
});

describe('filters', () => {
  it('a client filter implies project scope: company overhead and whole payouts drop out', async () => {
    const w = await seedLedger();
    const rows = await runLedger({ clientId: String(w.a._id) });
    expect(rows.every((r) => String(r.clientId) === String(w.a._id))).toBe(true);
    expect(rows.some((r) => r.projectId === null)).toBe(false);
    expect(rows.filter((r) => r.kind === 'teamPayout').map((r) => r.inrMinor).sort()).toEqual([300_000, 400_000]);
    // nothing of the internal client's, and the company-level expense (no client) is not Client A's cost
    expect(rows.some((r) => r.inrMinor === 700_000 || r.inrMinor === 30_000 || r.inrMinor === 40_000)).toBe(false);
  });

  it('a project filter returns that project only, across all four sources', async () => {
    const w = await seedLedger();
    const rows = await runLedger({ projectId: String(w.pA1._id) });
    expect(rows.map(key).sort()).toEqual(
      ['expense:100000', 'expense:50000', 'receipt:1000000', 'receipt:8342000', 'refund:-200000', 'teamPayout:400000', 'thirdPartyPayout:300000'].sort(),
    );
  });

  it('projectIds narrows to a set', async () => {
    const w = await seedLedger();
    const rows = await runLedger({ projectIds: [String(w.pA2._id), String(w.pI._id)] });
    expect(rows.map(key).sort()).toEqual(['expense:30000', 'receipt:700000', 'teamPayout:300000'].sort());
    expect(await runLedger({ projectIds: [] })).toEqual([]);
  });

  it('accepts ids in either letter case', async () => {
    const w = await seedLedger();
    const rows = await runLedger({ projectId: String(w.pA2._id).toUpperCase() });
    expect(rows).toHaveLength(1);
  });
});

describe('the internal client', () => {
  it('resolves to the one internal client, or nothing on a fresh database', async () => {
    expect(await resolveInternalClientId()).toBeUndefined();
    const internal = await makeInternalClient();
    expect(await resolveInternalClientId()).toBe(String(internal._id));
  });

  it('drops its receipts from revenue but keeps its costs', async () => {
    const w = await seedLedger();
    const withRevenue = await runLedger({ scope: 'project' });
    expect(withRevenue.some((r) => r.kind === 'receipt' && r.inrMinor === 700_000)).toBe(true);

    const rows = await runLedger({ scope: 'project', excludeInternalRevenue: true });
    expect(rows.some((r) => r.inrMinor === 700_000)).toBe(false);
    expect(rows.some((r) => r.kind === 'expense' && String(r.projectId) === String(w.pI._id))).toBe(true);
  });
});

describe('getCompanyTotals', () => {
  it('is external received minus paid third-party, expenses (company and project) and whole team payouts', async () => {
    await seedLedger();
    const t = await getCompanyTotals();
    expect(t.receivedInr).toBe(1_000_000 + 8_342_000 - 200_000); // the internal receipt and the void one are out
    expect(t.thirdPartyInr).toBe(300_000);
    expect(t.expenseInr).toBe(100_000 + 50_000 + 40_000 + 30_000); // company overhead and internal project costs count
    expect(t.teamInr).toBe(1_000_000); // the whole payout, not just the allocated 700,000
    expect(t.netInr).toBe(t.receivedInr - t.thirdPartyInr - t.expenseInr - t.teamInr);
    expect(t.netInr).toBe(9_142_000 - 300_000 - 220_000 - 1_000_000);
  });

  it('respects the period', async () => {
    await seedLedger();
    const july = await getCompanyTotals({ from: D('2026-07-01'), to: D('2026-07-31') });
    expect(july).toEqual({ receivedInr: 8_142_000, thirdPartyInr: 0, expenseInr: 0, teamInr: 0, netInr: 8_142_000 });
  });
});

describe('getProjectMargins', () => {
  it('computes received, costs, margin and margin percent per project', async () => {
    const w = await seedLedger();
    const margins = await getProjectMargins();
    const by = new Map(margins.map((m) => [m.projectId, m]));

    expect(by.get(String(w.pA1._id))).toMatchObject({
      receivedInr: 9_142_000,
      thirdPartyInr: 300_000,
      expenseInr: 150_000,
      teamInr: 400_000,
      marginInr: 8_292_000,
      marginPct: 90.7,
    });
    // team cost without revenue: a loss, and no percentage
    expect(by.get(String(w.pA2._id))).toMatchObject({ receivedInr: 0, teamInr: 300_000, marginInr: -300_000, marginPct: null });
    // the internal project shows its costs and no revenue
    expect(by.get(String(w.pI._id))).toMatchObject({ receivedInr: 0, expenseInr: 30_000, marginInr: -30_000, marginPct: null });
    // a project with nothing settled is absent unless asked for
    expect(by.has(String(w.pB._id))).toBe(false);
  });

  it('does not count company overhead in any project', async () => {
    await seedLedger();
    const total = (await getProjectMargins()).reduce((s, m) => s + m.expenseInr, 0);
    expect(total).toBe(150_000 + 30_000);
  });

  it('returns zeros for requested projects with nothing settled', async () => {
    const w = await seedLedger();
    const margins = await getProjectMargins(undefined, [String(w.pB._id), String(w.pA2._id)]);
    expect(margins.map((m) => m.projectId).sort()).toEqual([String(w.pA2._id), String(w.pB._id)].sort());
    expect(margins.find((m) => m.projectId === String(w.pB._id))).toMatchObject({ receivedInr: 0, costInr: 0, marginInr: 0, marginPct: null });
    expect(await getProjectMargins(undefined, [])).toEqual([]);
  });

  it('limits to a period and to a client', async () => {
    const w = await seedLedger();
    const july = await getProjectMargins({ from: D('2026-07-01'), to: D('2026-07-31') });
    expect(july).toHaveLength(1);
    expect(july[0]).toMatchObject({ projectId: String(w.pA1._id), receivedInr: 8_142_000, costInr: 0, marginInr: 8_142_000, marginPct: 100 });

    const clientB = await getProjectMargins(undefined, undefined, { clientId: String(w.b._id) });
    expect(clientB).toEqual([]);
    const clientA = await getProjectMargins(undefined, undefined, { clientId: String(w.a._id) });
    expect(clientA.map((m) => m.projectId).sort()).toEqual([String(w.pA1._id), String(w.pA2._id)].sort());
  });

  it('sorts by received, largest first', async () => {
    const w = await world();
    await makePayment(w.pA1, { amountMinor: 100_000 });
    await makePayment(w.pB, { amountMinor: 900_000 });
    expect((await getProjectMargins()).map((m) => m.receivedInr)).toEqual([900_000, 100_000]);
  });
});
