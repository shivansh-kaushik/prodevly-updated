import { describe, expect, it } from 'vitest';
import { getCompanyTotals } from '@/services/dashboards/ledger';
import { getThirdPartiesDashboard } from '@/services/dashboards/third-parties';
import { setupTestDb } from '@/test/db';
import { makeClient, makeProject } from '@/test/domain-factories';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { D, makeOrder, makeParty, makePayout, rejects, setRate, viewerHolding } from '@/test/third-party-factories';

setupTestDb();

const FY27 = { from: D('2026-04-01'), to: D('2027-03-31') };
const NOW = new Date('2026-10-12T10:00:00Z'); // 12 October 2026 in India as well
const superadmin = async () => sessionFor(await makeSuperadmin());

/** Third parties, projects, paid, due and void payouts, and work orders in two currencies, with every edge the figures must get right. */
async function seed() {
  const a = await makeParty({ name: 'Alpha Freelancer', type: 'freelancer' });
  const b = await makeParty({ name: 'Beta Agency', type: 'agency' });
  await makeParty({ name: 'Gamma Vendor', type: 'vendor', status: 'inactive' });
  await makeParty({ name: 'Delta Archived', type: 'vendor', archivedAt: new Date() });
  const p1 = await makeProject(await makeClient({ name: 'Client One' }), { name: 'Checkout redesign' });
  const p2 = await makeProject(await makeClient({ name: 'Client Two' }), { name: 'Mobile app' });

  await makePayout(a, p1, { status: 'paid', amountMinor: 200_000, paidOn: D('2026-06-10') });
  await makePayout(a, p2, { status: 'paid', amountMinor: 100_000, currency: 'USD', rate: 83.42, paidOn: D('2026-07-05') });
  await makePayout(b, p1, { status: 'paid', amountMinor: 50_000, paidOn: D('2026-07-20') });
  await makePayout(a, p1, { status: 'paid', amountMinor: 999_000, paidOn: D('2025-12-01') }); // last financial year
  await makePayout(b, p1, { status: 'void', amountMinor: 700_000 });
  await makePayout(a, p1, { status: 'due', amountMinor: 70_000, dueOn: D('2026-10-01') }); // overdue on 12 Oct
  await makePayout(a, p1, { status: 'due', amountMinor: 30_000, dueOn: D('2026-11-01') });

  await setRate('USD', 85, '2026-10-01');
  await makeOrder(a, p1, { agreedMinor: 1_000_000, paidMinor: 200_000, dueMinor: 70_000, title: 'INR job', dueOn: D('2026-10-05') }); // balance 730,000
  await makeOrder(b, p2, { agreedMinor: 500_000, currency: 'USD', dueMinor: 100_000, status: 'delivered', title: 'USD job' }); // balance USD 4,000.00
  await makeOrder(b, p2, { agreedMinor: 300_000, currency: 'EUR', title: 'EUR job' }); // no EUR rate
  await makeOrder(a, p1, { agreedMinor: 9_000_000, status: 'closed', title: 'Closed job' });
  await makeOrder(a, p1, { agreedMinor: 8_000_000, status: 'cancelled', title: 'Cancelled job' });
  return { a, b, p1, p2 };
}

describe('capabilities', () => {
  it('needs thirdParty:view, and leaves payout figures out entirely without payout:view', async () => {
    await seed();
    const sa = await superadmin();
    expect((await rejects(getThirdPartiesDashboard(viewerHolding(sa, 'dashboard:view'), FY27, { now: NOW }))).code).toBe('FORBIDDEN');
    const plain = await sessionFor(await makeAdmin()); // reads the directory, nothing about money
    const view = await getThirdPartiesDashboard(plain, FY27, { now: NOW });
    expect(view.money).toBeNull(); // omitted, never zero
    expect(view.activeThirdParties).toBe(2);
    expect(view.typeCounts).toEqual([{ type: 'agency', count: 1 }, { type: 'freelancer', count: 1 }]);
    const granted = await getThirdPartiesDashboard(await sessionFor(await makeAdmin({ grants: ['payout:view'] })), FY27, { now: NOW });
    expect(granted.money).not.toBeNull();
  });
});

describe('the figures', () => {
  it('sums paid payouts by paid date in INR and leaves out void, due and other periods', async () => {
    await seed();
    const { money, activeThirdParties } = await getThirdPartiesDashboard(await superadmin(), FY27, { now: NOW });
    expect(activeThirdParties).toBe(2); // inactive and archived are not active
    expect(money?.paid).toEqual({
      inr: 200_000 + 8_342_000 + 50_000,
      count: 3,
      byCurrency: [
        { currency: 'INR', nativeMinor: 250_000, inrMinor: 250_000 },
        { currency: 'USD', nativeMinor: 100_000, inrMinor: 8_342_000 },
      ],
    });
  });

  it('counts what is due now regardless of the period, with the overdue part on its own', async () => {
    await seed();
    const sa = await superadmin();
    const july = await getThirdPartiesDashboard(sa, { from: D('2026-07-01'), to: D('2026-07-31') }, { now: NOW });
    expect(july.money?.due).toEqual({ inr: 100_000, count: 2, overdueInr: 70_000, overdueCount: 1 });
    expect(july.money?.paid.inr).toBe(8_342_000 + 50_000); // the period only narrows what was paid
    // the due date itself is not overdue: a payout due today waits until tomorrow
    const onTheDay = await getThirdPartiesDashboard(sa, FY27, { now: new Date('2026-10-01T10:00:00Z') });
    expect(onTheDay.money?.due).toMatchObject({ overdueInr: 0, overdueCount: 0 });
  });

  it('includes both ends of the period and fills every month, oldest first', async () => {
    const { a, p1 } = await seed();
    await makePayout(a, p1, { status: 'paid', amountMinor: 11_100, paidOn: D('2026-04-01') });
    await makePayout(a, p1, { status: 'paid', amountMinor: 22_200, paidOn: D('2027-03-31') });
    await makePayout(a, p1, { status: 'paid', amountMinor: 33_300, paidOn: D('2027-04-01') }); // the day after
    const { money } = await getThirdPartiesDashboard(await superadmin(), FY27, { now: NOW });
    expect(money?.perMonth).toHaveLength(12);
    expect(money?.perMonth[0]).toEqual({ month: '2026-04', label: 'Apr 26', paidInr: 11_100 });
    expect(money?.perMonth.at(-1)).toEqual({ month: '2027-03', label: 'Mar 27', paidInr: 22_200 });
    expect(money?.perMonth.find((m) => m.month === '2026-06')?.paidInr).toBe(200_000);
    expect(money?.perMonth.find((m) => m.month === '2026-07')?.paidInr).toBe(8_342_000 + 50_000);
    expect(money?.perMonth.find((m) => m.month === '2026-05')?.paidInr).toBe(0);
    expect(money?.paid.inr).toBe(200_000 + 8_342_000 + 50_000 + 11_100 + 22_200);
  });

  it('ranks the top third parties, projects and types by paid INR', async () => {
    const { a, b, p1, p2 } = await seed();
    const { money } = await getThirdPartiesDashboard(await superadmin(), FY27, { now: NOW });
    expect(money?.byThirdParty).toEqual([
      { id: String(a._id), name: 'Alpha Freelancer', paidInr: 8_542_000 },
      { id: String(b._id), name: 'Beta Agency', paidInr: 50_000 },
    ]);
    expect(money?.byProject).toEqual([
      { id: String(p2._id), ref: p2.ref, name: 'Mobile app', paidInr: 8_342_000 },
      { id: String(p1._id), ref: p1.ref, name: 'Checkout redesign', paidInr: 250_000 },
    ]);
    expect(money?.byType).toEqual([{ type: 'freelancer', paidInr: 8_542_000 }, { type: 'agency', paidInr: 50_000 }]);
  });

  it('caps the rankings at ten', async () => {
    const p = await makeProject(await makeClient());
    for (let i = 1; i <= 12; i++) {
      const party = await makeParty({ name: `Party ${String(i).padStart(2, '0')}` });
      const project = i <= 11 ? await makeProject(await makeClient()) : p;
      await makePayout(party, project, { status: 'paid', amountMinor: i * 1000, paidOn: D('2026-06-01') });
    }
    const { money } = await getThirdPartiesDashboard(await superadmin(), FY27, { now: NOW });
    expect(money?.byThirdParty).toHaveLength(10);
    expect(money?.byThirdParty[0]?.name).toBe('Party 12');
    expect(money?.byProject).toHaveLength(10);
    expect(money?.paid.count).toBe(12);
  });

  it('lists the open work orders with agreed, paid, due and balance, biggest first, and converts at the latest rate', async () => {
    await seed();
    const { money } = await getThirdPartiesDashboard(await superadmin(), FY27, { now: NOW });
    const open = money?.openWorkOrders;
    expect(open?.count).toBe(3); // open and delivered; closed and cancelled are not open
    expect(open?.byCurrency).toEqual([
      { currency: 'EUR', balanceMinor: 300_000, balanceInr: null },
      { currency: 'INR', balanceMinor: 730_000, balanceInr: 730_000 },
      { currency: 'USD', balanceMinor: 400_000, balanceInr: 34_000_000 },
    ]);
    expect(open?.balanceInr).toBe(730_000 + 34_000_000); // the EUR balance has no rate, so it is not in the total ...
    expect(open?.missingRates).toEqual(['EUR']); // ... and the screen says so
    expect(open?.rows.map((r) => r.title)).toEqual(['USD job', 'INR job', 'EUR job']);
    expect(open?.rows[0]).toMatchObject({ agreed: { amountMinor: 500_000, currency: 'USD' }, paidMinor: 0, dueMinor: 100_000, balanceMinor: 400_000, balanceInr: 34_000_000, status: 'delivered', projectName: 'Mobile app' });
    expect(open?.rows[1]).toMatchObject({ paidMinor: 200_000, dueMinor: 70_000, balanceMinor: 730_000, overdue: true, dueOn: '2026-10-05' });
    expect(open?.rows[2]?.balanceInr).toBeNull();
  });

  it('an overrun work order adds nothing to the balance and says so on its row', async () => {
    const { a, p1 } = await seed();
    await makeOrder(a, p1, { agreedMinor: 100_000, paidMinor: 80_000, dueMinor: 50_000, title: 'Overrun job' });
    const { money } = await getThirdPartiesDashboard(await superadmin(), FY27, { now: NOW });
    expect(money?.openWorkOrders.byCurrency.find((c) => c.currency === 'INR')?.balanceMinor).toBe(730_000); // unchanged
    const row = money?.openWorkOrders.rows.find((r) => r.title === 'Overrun job');
    expect(row).toMatchObject({ balanceMinor: -30_000, balanceInr: 0 });
  });

  it('agrees with the ledger on what was paid in the period', async () => {
    await seed();
    const { money } = await getThirdPartiesDashboard(await superadmin(), FY27, { now: NOW });
    expect((await getCompanyTotals(FY27)).thirdPartyInr).toBe(money?.paid.inr);
  });
});

describe('an empty database', () => {
  it('renders zeros and empty lists, never an error or a made-up figure', async () => {
    const dash = await getThirdPartiesDashboard(await superadmin(), FY27, { now: NOW });
    expect(dash.activeThirdParties).toBe(0);
    expect(dash.typeCounts).toEqual([]);
    expect(dash.money).toMatchObject({
      paid: { inr: 0, count: 0, byCurrency: [] },
      due: { inr: 0, count: 0, overdueInr: 0, overdueCount: 0 },
      byThirdParty: [],
      byProject: [],
      byType: [],
      openWorkOrders: { count: 0, balanceInr: 0, byCurrency: [], missingRates: [], rows: [] },
    });
    expect(dash.money?.perMonth).toHaveLength(12);
    expect(dash.money?.perMonth.every((m) => m.paidInr === 0)).toBe(true);
  });

  it('with only third parties and no payouts shows them and zero money', async () => {
    await makeParty({ name: 'Solo', type: 'agency' });
    const dash = await getThirdPartiesDashboard(await superadmin(), FY27, { now: NOW });
    expect(dash.activeThirdParties).toBe(1);
    expect(dash.money?.paid.inr).toBe(0);
  });
});
