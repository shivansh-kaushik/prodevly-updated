import { describe, expect, it } from 'vitest';
import { Project } from '@/models';
import { getPaymentsDashboard } from '@/services/dashboards/payments';
import { setupTestDb } from '@/test/db';
import { makeClient, makeProject } from '@/test/domain-factories';
import { D, NOW, makeBillableProject, makeFxRate, makeInternalClient, makeLedgerPayment, paymentActors, rejects } from '@/test/payment-factories';

setupTestDb();

const FY27 = { from: D('2026-04-01'), to: D('2027-03-31') };
const dash = async (options: Parameters<typeof getPaymentsDashboard>[2] = {}, range = FY27) => {
  const { viewer } = await paymentActors();
  return getPaymentsDashboard(viewer, range, { now: NOW, ...options });
};

describe('who sees the dashboard', () => {
  it('needs payment:view: everything on it is money, so there is no screen of zeros for someone without it', async () => {
    const { plain, viewer } = await paymentActors();
    expect((await rejects(getPaymentsDashboard(plain, FY27, { now: NOW }))).code).toBe('FORBIDDEN');
    expect((await getPaymentsDashboard(viewer, FY27, { now: NOW })).hasRecords).toBe(false);
  });
});

describe('an empty database', () => {
  it('renders zeros, empty lists and a month for every month of the period', async () => {
    const d = await dash();
    expect(d).toMatchObject({
      hasRecords: false,
      receivedInr: 0,
      receiptsInr: 0,
      receipts: 0,
      refundsInr: 0,
      refunds: 0,
      tdsInr: 0,
      dueSoon: { count: 0, remaining: [] },
      overdue: { count: 0, remaining: [] },
      byCurrency: [],
      byMode: [],
      upcoming: [],
      outstanding: { rows: [], projects: 0, totalInr: null, missingRates: [] },
    });
    expect(d.byMonth).toHaveLength(12);
    expect(d.byMonth[0]).toEqual({ month: '2026-04', label: 'Apr 26', receivedInr: 0 });
    expect(d.byMonth[11]?.month).toBe('2027-03');
    expect(JSON.stringify(d)).not.toMatch(/NaN|Infinity/);
  });
});

describe('received in the period', () => {
  async function world() {
    const a = await makeBillableProject({ client: await makeClient({ name: 'Alpha Ltd' }) });
    const b = await makeBillableProject({ client: await makeClient({ name: 'Beta Inc' }), currency: 'USD', amountMinor: 5_000_000 });
    await makeFxRate('USD', 83.42, '2026-10-01');
    await makeLedgerPayment(a.project, { amountMinor: 10_000_000, receivedOn: '2026-04-01', mode: 'bank_transfer' }); // first day of the FY
    await makeLedgerPayment(a.project, { amountMinor: 20_000_000, receivedOn: '2026-06-15', mode: 'upi' });
    await makeLedgerPayment(a.project, { amountMinor: 5_000_000, receivedOn: '2026-06-20', mode: 'upi', type: 'refund' });
    await makeLedgerPayment(a.project, { amountMinor: 99_000_000, receivedOn: '2026-06-21', status: 'void' }); // void: in no figure
    await makeLedgerPayment(a.project, { amountMinor: 40_000_000, receivedOn: '2026-03-31' }); // last financial year
    await makeLedgerPayment(b.project, { amountMinor: 100_000, currency: 'USD', receivedOn: '2026-06-15', mode: 'wise' }); // INR 83,42,000 paise = 8,342,000
    await makeLedgerPayment(b.project, { amountMinor: 20_000, currency: 'USD', receivedOn: '2026-07-10', mode: 'wise', type: 'refund' }); // 1,668,400 paise
    await makeLedgerPayment(b.project, { amountMinor: 1, currency: 'USD', receivedOn: '2027-03-31', mode: 'wise' }); // last day of the FY: INR 0.83 -> 83 paise
    await makeLedgerPayment(b.project, { amountMinor: 1, currency: 'USD', receivedOn: '2027-04-01', mode: 'wise' }); // next year
    return { a, b };
  }

  it('sums received entries in INR, net of refunds, leaving out void entries and other periods', async () => {
    await world();
    const d = await dash();
    // receipts: 10,000,000 + 20,000,000 + 8,342,000 + 83 ; refunds: 5,000,000 + 1,668,400
    expect(d.receiptsInr).toBe(10_000_000 + 20_000_000 + 8_342_000 + 83);
    expect(d.receipts).toBe(4);
    expect(d.refundsInr).toBe(5_000_000 + 1_668_400);
    expect(d.refunds).toBe(2);
    expect(d.receivedInr).toBe(38_342_083 - 6_668_400);
    expect(d.hasRecords).toBe(true);
  });

  it('includes both ends of the period, and follows the period it is given', async () => {
    await world();
    const lastYear = await dash({}, { from: D('2025-04-01'), to: D('2026-03-31') });
    expect(lastYear.receivedInr).toBe(40_000_000);
    expect(lastYear.receipts).toBe(1);
    const june = await dash({}, { from: D('2026-06-01'), to: D('2026-06-30') });
    expect(june.receipts).toBe(2);
    expect(june.receivedInr).toBe(20_000_000 + 8_342_000 - 5_000_000);
    expect((await dash({}, { from: D('2026-06-15'), to: D('2026-06-15') })).receipts).toBe(2); // a one-day period
  });

  it('charts the net per month, zero-filled across the whole period', async () => {
    await world();
    const d = await dash();
    const month = (key: string) => d.byMonth.find((m) => m.month === key)?.receivedInr;
    expect(month('2026-04')).toBe(10_000_000);
    expect(month('2026-05')).toBe(0);
    expect(month('2026-06')).toBe(20_000_000 - 5_000_000 + 8_342_000);
    expect(month('2026-07')).toBe(-1_668_400); // a refund in a month with no receipt shows as negative
    expect(month('2027-03')).toBe(83);
    expect(d.byMonth.reduce((sum, m) => sum + m.receivedInr, 0)).toBe(d.receivedInr);
  });

  it('groups by currency with the native total and the INR value, refunds subtracted from both', async () => {
    await world();
    const d = await dash();
    expect(d.byCurrency).toEqual([
      { currency: 'INR', nativeMinor: 25_000_000, inrMinor: 25_000_000 },
      { currency: 'USD', nativeMinor: 100_000 - 20_000 + 1, inrMinor: 8_342_000 - 1_668_400 + 83 },
    ]);
    // the INR column adds up to the headline, and the native column is never added across currencies
    expect(d.byCurrency.reduce((sum, c) => sum + c.inrMinor, 0)).toBe(d.receivedInr);
  });

  it('groups by mode, net of refunds, largest first', async () => {
    await world();
    const d = await dash();
    expect(d.byMode).toEqual([
      { mode: 'upi', inrMinor: 20_000_000 - 5_000_000 },
      { mode: 'bank_transfer', inrMinor: 10_000_000 },
      { mode: 'wise', inrMinor: 8_342_000 - 1_668_400 + 83 },
    ]);
  });

  it('narrows to a client or a project, and a client that is not in the data shows zeros', async () => {
    const { a, b } = await world();
    expect((await dash({ clientId: String(a.client._id) })).receivedInr).toBe(10_000_000 + 20_000_000 - 5_000_000);
    expect((await dash({ projectId: String(b.project._id) })).receivedInr).toBe(8_342_000 - 1_668_400 + 83);
    expect((await dash({ clientId: String(a.client._id), projectId: String(b.project._id) })).receivedInr).toBe(0);
    const stranger = await makeClient();
    const empty = await dash({ clientId: String(stranger._id) });
    expect(empty.receivedInr).toBe(0);
    expect(empty.hasRecords).toBe(false);
  });

  it('does not count the internal client as revenue, even when asked for it', async () => {
    const { a } = await world();
    const internal = await makeInternalClient();
    const own = await makeProject(internal, { contract: { pricingModel: 'fixed', amountMinor: 9_000_000, currency: 'INR' } });
    await makeLedgerPayment(own, { amountMinor: 900_000, receivedOn: '2026-06-20' });
    const all = await dash();
    expect(all.receivedInr).toBe(38_342_083 - 6_668_400);
    expect((await dash({ clientId: String(internal._id) })).receivedInr).toBe(0);
    expect((await dash({ clientId: String(a.client._id) })).receivedInr).toBe(25_000_000);
  });
});

describe('TDS deducted', () => {
  it('sums TDS on received receipts in INR at each entry\'s own rate, leaving out void entries and refunds', async () => {
    const a = await makeBillableProject();
    const b = await makeBillableProject({ currency: 'USD', amountMinor: 5_000_000 });
    await makeLedgerPayment(a.project, { amountMinor: 9_000_000, receivedOn: '2026-06-15', tdsMinor: 1_000_000 }); // INR 10,000
    await makeLedgerPayment(b.project, { amountMinor: 90_000, currency: 'USD', rate: 80, receivedOn: '2026-06-16', tdsMinor: 10_000 }); // USD 100 at 80 = INR 8,000
    await makeLedgerPayment(a.project, { amountMinor: 9_000_000, receivedOn: '2026-06-17', tdsMinor: 7_000_000, status: 'void' });
    await makeLedgerPayment(a.project, { amountMinor: 1_000_000, receivedOn: '2026-06-18', tdsMinor: 500_000, type: 'refund' });
    await makeLedgerPayment(a.project, { amountMinor: 9_000_000, receivedOn: '2025-06-18', tdsMinor: 300_000 }); // last year
    await makeLedgerPayment(a.project, { amountMinor: 1_000_000, receivedOn: '2026-06-19' }); // no TDS
    const d = await dash();
    expect(d.tdsInr).toBe(1_000_000 + 800_000);
  });
});

describe('milestones due', () => {
  async function milestoneWorld() {
    const a = await makeBillableProject({
      client: await makeClient({ name: 'Alpha Ltd' }),
      pricingModel: 'milestone',
      amountMinor: 90_000_000,
      milestones: [
        { title: 'Late one', amountMinor: 10_000_000, status: 'invoiced', dueOn: '2026-10-11' }, // overdue by a day
        { title: 'Due today', amountMinor: 20_000_000, status: 'pending', dueOn: '2026-10-12' }, // not overdue
        { title: 'On the edge', amountMinor: 30_000_000, status: 'invoiced', dueOn: '2026-11-11' }, // day 30: in
        { title: 'Too far', amountMinor: 40_000_000, status: 'invoiced', dueOn: '2026-11-12' }, // day 31: out
        { title: 'Already paid', amountMinor: 50_000_000, status: 'paid', dueOn: '2026-10-01' },
        { title: 'No date', amountMinor: 60_000_000, status: 'invoiced' },
      ],
    });
    const usd = await makeBillableProject({
      client: await makeClient({ name: 'Beta Inc' }),
      currency: 'USD',
      pricingModel: 'milestone',
      amountMinor: 1_000_000,
      milestones: [{ title: 'Dollar milestone', amountMinor: 500_000, status: 'invoiced', dueOn: '2026-10-20' }],
    });
    return { a, usd };
  }

  it('counts milestones due in the next 30 days and overdue ones apart, and leaves out paid, undated and later ones', async () => {
    await milestoneWorld();
    const d = await dash();
    expect(d.overdue.count).toBe(1);
    expect(d.dueSoon.count).toBe(3); // due today, the 30th day, and the dollar milestone
    expect(d.overdue.remaining).toEqual([{ currency: 'INR', amountMinor: 10_000_000 }]);
    expect(d.dueSoon.remaining).toEqual([
      { currency: 'INR', amountMinor: 20_000_000 + 30_000_000 },
      { currency: 'USD', amountMinor: 500_000 },
    ]);
  });

  it('measures "today" in the organisation zone', async () => {
    await milestoneWorld();
    const { viewer } = await paymentActors();
    // 20:00 UTC on 12 October is already 13 October in India: "due today" has become overdue
    const d = await getPaymentsDashboard(viewer, FY27, { now: new Date('2026-10-12T20:00:00Z') });
    expect(d.overdue.count).toBe(2);
  });

  it('lists overdue first and then the soonest, with what each has already received', async () => {
    const { a } = await milestoneWorld();
    await makeLedgerPayment(a.project, { amountMinor: 4_000_000, receivedOn: '2026-10-05', milestoneId: a.project.milestones[1]!._id, status: 'received' });
    await makeLedgerPayment(a.project, { amountMinor: 1_000_000, receivedOn: '2026-10-05', milestoneId: a.project.milestones[1]!._id, status: 'void' });
    const d = await dash();
    expect(d.upcoming.map((u) => [u.title, u.dueOn, u.overdue, u.daysFromToday])).toEqual([
      ['Late one', '2026-10-11', true, -1],
      ['Due today', '2026-10-12', false, 0],
      ['Dollar milestone', '2026-10-20', false, 8],
      ['On the edge', '2026-11-11', false, 30],
    ]);
    const today = d.upcoming.find((u) => u.title === 'Due today');
    expect(today).toMatchObject({ projectRef: a.project.ref, clientName: 'Alpha Ltd', currency: 'INR', amountMinor: 20_000_000, receivedMinor: 4_000_000, status: 'pending' });
    // what is still to come is net of what the milestone has received
    expect(d.dueSoon.remaining[0]).toEqual({ currency: 'INR', amountMinor: 16_000_000 + 30_000_000 });
  });

  it('leaves out archived, proposal, cancelled and internal projects, and follows the client and project filters', async () => {
    const { a, usd } = await milestoneWorld();
    const milestone = [{ title: 'Hidden', amountMinor: 1_000_000, status: 'invoiced', dueOn: '2026-10-15' }] as never;
    const contract = { pricingModel: 'milestone' as const, amountMinor: 1_000_000, currency: 'INR' };
    const client = await makeClient();
    await makeProject(client, { status: 'proposal', contract, milestones: milestone });
    await makeProject(client, { status: 'cancelled', contract, milestones: milestone });
    await makeProject(client, { archivedAt: new Date(), contract, milestones: milestone });
    await makeProject(await makeInternalClient(), { contract, milestones: milestone });
    const all = await dash();
    expect(all.dueSoon.count + all.overdue.count).toBe(4);
    expect((await dash({ projectId: String(usd.project._id) })).dueSoon.count).toBe(1);
    expect((await dash({ clientId: String(a.client._id) })).overdue.count).toBe(1);
    expect((await dash({ clientId: String(usd.client._id) })).overdue.count).toBe(0);
  });

  it('caps the list at 15 but counts them all', async () => {
    await makeBillableProject({
      pricingModel: 'milestone',
      amountMinor: 1_000_000,
      milestones: Array.from({ length: 20 }, (_, i) => ({ title: `M${i}`, amountMinor: 1_000, status: 'invoiced' as const, dueOn: '2026-10-20' })),
    });
    const d = await dash();
    expect(d.dueSoon.count).toBe(20);
    expect(d.upcoming).toHaveLength(15);
  });
});

describe('outstanding by project', () => {
  it('is the billable total less what was received toward the contract, void excluded and refunds added back', async () => {
    const a = await makeBillableProject({ client: await makeClient({ name: 'Alpha Ltd' }), amountMinor: 100_000_000 });
    await makeLedgerPayment(a.project, { amountMinor: 30_000_000, receivedOn: '2026-06-01' });
    await makeLedgerPayment(a.project, { amountMinor: 5_000_000, receivedOn: '2026-06-02', type: 'refund' });
    await makeLedgerPayment(a.project, { amountMinor: 50_000_000, receivedOn: '2026-06-03', status: 'void' });
    const d = await dash();
    expect(d.outstanding.rows).toEqual([
      expect.objectContaining({ projectId: String(a.project._id), projectRef: a.project.ref, clientName: 'Alpha Ltd', currency: 'INR', billableMinor: 100_000_000, receivedMinor: 25_000_000, outstandingMinor: 75_000_000, outstandingInr: 75_000_000 }),
    ]);
    expect(d.outstanding).toMatchObject({ projects: 1, totalInr: 75_000_000, missingRates: [] });
  });

  it('counts received toward the contract by the contract equivalent, not the INR value, and ignores the period', async () => {
    const usd = await makeBillableProject({ currency: 'USD', amountMinor: 1_000_000 }); // USD 10,000.00
    await makeFxRate('USD', 84, '2026-10-01');
    await makeLedgerPayment(usd.project, { amountMinor: 8_342_000, currency: 'INR', receivedOn: '2025-01-01', contractEquivalentMinor: 100_000 }); // a year before the period
    const d = await dash();
    expect(d.outstanding.rows[0]).toMatchObject({ currency: 'USD', billableMinor: 1_000_000, receivedMinor: 100_000, outstandingMinor: 900_000 });
    // 9,000.00 USD at the latest rate of 84 INR: INR 7,56,000.00
    expect(d.outstanding.rows[0]?.outstandingInr).toBe(75_600_000);
    expect(d.outstanding.totalInr).toBe(75_600_000);
  });

  it('is left out in INR, and named, when the currency has no rate; the total keeps what can be converted', async () => {
    await makeBillableProject({ amountMinor: 10_000_000 });
    const eur = await makeBillableProject({ currency: 'EUR', amountMinor: 500_000 });
    const d = await dash();
    expect(d.outstanding.missingRates).toEqual(['EUR']);
    expect(d.outstanding.totalInr).toBe(10_000_000);
    expect(d.outstanding.rows.map((r) => [r.currency, r.outstandingInr])).toEqual([['INR', 10_000_000], ['EUR', null]]);
    expect(d.outstanding.rows[1]?.projectId).toBe(String(eur.project._id));
    // with a rate it joins the total
    await makeFxRate('EUR', 90, '2026-01-01');
    expect((await dash()).outstanding).toMatchObject({ missingRates: [], totalInr: 10_000_000 + 45_000_000 });
  });

  it('bills hourly and retainer projects by their invoiced and paid milestones only', async () => {
    const hourly = await makeBillableProject({
      pricingModel: 'hourly',
      amountMinor: 0,
      milestones: [
        { title: 'Invoiced', amountMinor: 3_000_000, status: 'invoiced' },
        { title: 'Paid', amountMinor: 2_000_000, status: 'paid' },
        { title: 'Not yet', amountMinor: 9_000_000, status: 'pending' },
      ],
    });
    await makeLedgerPayment(hourly.project, { amountMinor: 2_000_000, receivedOn: '2026-06-01' });
    expect((await dash()).outstanding.rows[0]).toMatchObject({ billableMinor: 5_000_000, receivedMinor: 2_000_000, outstandingMinor: 3_000_000 });
  });

  it('leaves out settled, over-paid, proposal, cancelled, archived and internal projects, and ranks by INR', async () => {
    const small = await makeBillableProject({ client: await makeClient({ name: 'Small' }), amountMinor: 1_000_000 });
    const big = await makeBillableProject({ client: await makeClient({ name: 'Big' }), amountMinor: 80_000_000 });
    const settled = await makeBillableProject({ amountMinor: 1_000_000 });
    await makeLedgerPayment(settled.project, { amountMinor: 1_000_000, receivedOn: '2026-06-01' });
    const advance = await makeBillableProject({ amountMinor: 1_000_000 });
    await makeLedgerPayment(advance.project, { amountMinor: 2_000_000, receivedOn: '2026-06-01' });
    await makeBillableProject({ status: 'proposal', amountMinor: 5_000_000 });
    await makeBillableProject({ status: 'cancelled', amountMinor: 5_000_000 });
    const archived = await makeBillableProject({ amountMinor: 5_000_000 });
    await Project.updateOne({ _id: archived.project._id }, { $set: { archivedAt: new Date() } });
    const internal = await makeInternalClient();
    await makeProject(internal, { contract: { pricingModel: 'fixed', amountMinor: 5_000_000, currency: 'INR' } });

    const d = await dash();
    expect(d.outstanding.rows.map((r) => r.projectId)).toEqual([String(big.project._id), String(small.project._id)]);
    expect(d.outstanding.projects).toBe(2);
    expect((await dash({ clientId: String(big.client._id) })).outstanding.rows).toHaveLength(1);
    expect((await dash({ projectId: String(small.project._id) })).outstanding.rows[0]?.projectId).toBe(String(small.project._id));
  });

  it('lists the ten largest and still counts and totals every project', async () => {
    for (let i = 1; i <= 12; i++) await makeBillableProject({ amountMinor: i * 1_000_000 });
    const d = await dash();
    expect(d.outstanding.rows).toHaveLength(10);
    expect(d.outstanding.projects).toBe(12);
    expect(d.outstanding.totalInr).toBe((12 * 13 / 2) * 1_000_000);
    expect(d.outstanding.rows[0]?.outstandingMinor).toBe(12_000_000);
  });
});
