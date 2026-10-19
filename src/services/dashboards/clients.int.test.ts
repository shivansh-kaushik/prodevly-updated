import { describe, expect, it } from 'vitest';
import { ClientPayment, FxRate } from '@/models';
import { buildMoney } from '@/lib/money/fx';
import { resolvePeriod } from '@/lib/dates/ranges';
import { getClientMoney, getClientsDashboard } from '@/services/dashboards/clients';
import { makeClient, makeProject } from '@/test/domain-factories';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { setupTestDb } from '@/test/db';

setupTestDb();

const NOW = new Date('2026-10-12T09:00:00Z');
const period = resolvePeriod({}, NOW); // FY27: 1 Apr 2026 to 31 Mar 2027
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const by = { id: null, name: 'Test' };

let n = 0;
async function pay(client: { _id: unknown }, project: { _id: unknown }, o: { amountMinor: number; currency?: string; on?: string; type?: 'receipt' | 'refund'; status?: 'received' | 'void'; contract?: number }) {
  const currency = o.currency ?? 'INR';
  await ClientPayment.create({
    ref: `PAY-FY27-${String(++n).padStart(4, '0')}`,
    type: o.type ?? 'receipt',
    clientId: client._id,
    projectId: project._id,
    amount: buildMoney({ amountMinor: o.amountMinor, currency, fxRate: currency === 'INR' ? 1 : 80, fxDate: d(o.on ?? '2026-07-01'), fxSource: 'table' }),
    contractEquivalentMinor: o.contract ?? o.amountMinor,
    receivedOn: d(o.on ?? '2026-07-01'),
    mode: 'bank_transfer',
    status: o.status ?? 'received',
    ...(o.status === 'void' ? { voidReason: 'entered twice' } : {}),
    recordedBy: by,
  } as never);
}

describe('clients dashboard', () => {
  it('is empty and honest on an empty database', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const dash = await getClientsDashboard(sa, period, NOW);
    expect(dash).toMatchObject({ total: 0, newInPeriod: 0, byCountry: [] });
    expect(dash.money).toMatchObject({ receivedInrMinor: 0, topThreeSharePct: null, outstandingInrMinor: 0, receivedByClient: [], overdueMilestones: [] });
  });

  it('counts clients by status, leaves out the internal client and archived ones, and groups countries', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    await makeClient({ name: 'Alpha', status: 'active', country: 'IN' });
    await makeClient({ name: 'Bravo', status: 'active', country: 'IN' });
    await makeClient({ name: 'Charlie', status: 'prospect', country: 'US' });
    await makeClient({ name: 'Delta', status: 'past' });
    await makeClient({ name: 'ProDevly (internal)', isInternal: true, status: 'active' });
    const archived = await makeClient({ name: 'Echo', status: 'active', country: 'IN' });
    await (await import('@/models')).Client.updateOne({ _id: archived._id }, { $set: { archivedAt: new Date() } });
    const dash = await getClientsDashboard(sa, period, NOW);
    expect(dash.total).toBe(4);
    expect(dash.byStatus).toEqual({ prospect: 1, active: 2, paused: 0, past: 1 });
    expect(dash.byCountry).toEqual([{ country: 'IN', count: 2 }, { country: 'US', count: 1 }, { country: 'Not set', count: 1 }]);
    expect(dash.newInPeriod).toBe(5); // created this year, so new, even though Echo was archived since
  });

  it('computes receipts net of refunds, excludes void and the internal client, and the top-three share', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const a = await makeClient({ name: 'Alpha' });
    const b = await makeClient({ name: 'Bravo' });
    const c = await makeClient({ name: 'Charlie' });
    const e = await makeClient({ name: 'Echo' });
    const internal = await makeClient({ name: 'ProDevly (internal)', isInternal: true });
    const [pa, pb, pc, pe, pi] = await Promise.all([a, b, c, e, internal].map((cl) => makeProject(cl)));
    await pay(a, pa!, { amountMinor: 100_000 });
    await pay(a, pa!, { amountMinor: 20_000, type: 'refund' });
    await pay(b, pb!, { amountMinor: 50_000 });
    await pay(c, pc!, { amountMinor: 30_000 });
    await pay(e, pe!, { amountMinor: 20_000 });
    await pay(e, pe!, { amountMinor: 999_999, status: 'void' });
    await pay(internal, pi!, { amountMinor: 777_777 });
    await pay(a, pa!, { amountMinor: 123_456, on: '2025-12-01' }); // last financial year

    const { money } = await getClientsDashboard(sa, period, NOW);
    expect(money?.receivedInrMinor).toBe(100_000 - 20_000 + 50_000 + 30_000 + 20_000);
    expect(money?.receivingClients).toBe(4);
    expect(money?.receivedByClient.map((r) => [r.name, r.inrMinor])).toEqual([['Alpha', 80_000], ['Bravo', 50_000], ['Charlie', 30_000], ['Echo', 20_000]]);
    expect(money?.topThreeSharePct).toBe(89); // 160,000 of 180,000
  });

  it('computes outstanding per project, never below zero, at the latest table rate, and lists overdue milestones', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    await FxRate.create({ currency: 'USD', rateOn: d('2026-10-01'), rate: 80, source: 'manual' });
    const a = await makeClient({ name: 'Alpha' });
    const b = await makeClient({ name: 'Bravo' });
    const pa = await makeProject(a, {
      name: 'Alpha site', contract: { pricingModel: 'fixed', amountMinor: 1_000_000, currency: 'INR' },
      milestones: [{ title: 'Beta', amountMinor: 400_000, dueOn: d('2026-09-01'), status: 'invoiced' }] as never,
    });
    const pb = await makeProject(b, { name: 'Bravo app', contract: { pricingModel: 'fixed', amountMinor: 20_000, currency: 'USD' } });
    const overpaid = await makeProject(a, { name: 'Overpaid', contract: { pricingModel: 'fixed', amountMinor: 100, currency: 'INR' } });
    await pay(a, pa, { amountMinor: 300_000 }); // 700,000 still owed
    await pay(b, pb, { amountMinor: 5_000, currency: 'USD', contract: 5_000 }); // USD 150.00 still owed
    await pay(a, overpaid, { amountMinor: 500 }); // more than billable: contributes 0, not -400

    const { money } = await getClientsDashboard(sa, period, NOW);
    expect(money?.outstandingByCurrency).toEqual([{ currency: 'INR', minor: 700_000 }, { currency: 'USD', minor: 15_000 }]);
    expect(money?.outstandingInrMinor).toBe(700_000 + 15_000 * 80); // USD at 80
    expect(money?.outstandingMissingRates).toEqual([]);
    expect(money?.outstandingByClient.map((r) => r.name)).toEqual(['Bravo', 'Alpha']); // 1,200,000 vs 700,000
    expect(money?.overdueMilestones).toEqual([expect.objectContaining({ clientName: 'Alpha', milestone: 'Beta', daysLate: 41, amountMinor: 400_000 })]);
  });

  it('lists a currency with no rate instead of inventing one', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const a = await makeClient({ name: 'Alpha' });
    await makeProject(a, { contract: { pricingModel: 'fixed', amountMinor: 10_000, currency: 'EUR' } });
    const { money } = await getClientsDashboard(sa, period, NOW);
    expect(money?.outstandingMissingRates).toEqual(['EUR']);
    expect(money?.outstandingInrMinor).toBe(0);
    expect(money?.outstandingByCurrency).toEqual([{ currency: 'EUR', minor: 10_000 }]);
  });

  it('gives a viewer without payment:view no money at all (null, not zero)', async () => {
    const plain = await sessionFor(await makeAdmin());
    await makeClient({ name: 'Alpha' });
    const dash = await getClientsDashboard(plain, period, NOW);
    expect(dash.money).toBeNull();
    expect(dash.total).toBe(1);
  });
});

describe('one client\'s money', () => {
  it('shows received, outstanding and margin per project, and totals them', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const a = await makeClient({ name: 'Alpha' });
    const other = await makeClient({ name: 'Bravo' });
    const p1 = await makeProject(a, { name: 'First', contract: { pricingModel: 'fixed', amountMinor: 1_000_000, currency: 'INR' } });
    await makeProject(a, { name: 'Second', contract: { pricingModel: 'fixed', amountMinor: 50_000, currency: 'INR' } });
    const po = await makeProject(other, { name: 'Not ours' });
    await pay(a, p1, { amountMinor: 250_000 });
    await pay(other, po, { amountMinor: 999_000 });

    const report = await getClientMoney(sa, String(a._id));
    expect(report.projects.map((p) => p.name).sort()).toEqual(['First', 'Second']);
    const first = report.projects.find((p) => p.name === 'First');
    expect(first).toMatchObject({ billableMinor: 1_000_000, receivedContractMinor: 250_000, outstandingMinor: 750_000, receivedInrMinor: 250_000, marginInrMinor: 250_000 });
    expect(report.totals).toMatchObject({ receivedInrMinor: 250_000, marginInrMinor: 250_000, marginPct: 100 });
    expect(report.isInternal).toBe(false);
  });

  it('needs payment:view', async () => {
    const plain = await sessionFor(await makeAdmin());
    const a = await makeClient({ name: 'Alpha' });
    await expect(getClientMoney(plain, String(a._id))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
