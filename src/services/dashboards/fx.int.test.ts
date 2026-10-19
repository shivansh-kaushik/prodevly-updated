import { describe, expect, it } from 'vitest';
import { resolvePeriod } from '@/lib/dates/ranges';
import { getFxDashboard } from '@/services/dashboards/fx';
import { setupTestDb } from '@/test/db';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { day, makeFxRate, makeLedgerEntry, moneyOf, setSettings } from '@/test/settings-factories';

setupTestDb();

const NOW = new Date('2026-10-12T10:00:00Z');
// The current financial year at NOW: 1 April 2026 to 31 March 2027.
const FY = resolvePeriod({}, NOW);
const DEFAULT_FOREIGN = ['USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD'];

const manual = (o = {}) => moneyOf('manual', o);
const bank = (o = {}) => moneyOf('bank', { inrMinor: 8_350_000, ...o });

describe('an empty database', () => {
  it('renders zeros and empty lists, not invented figures', async () => {
    const viewer = await sessionFor(await makeSuperadmin());
    const d = await getFxDashboard(viewer, FY, { now: NOW });
    expect(d.today).toBe('2026-10-12');
    expect(d.staleDays).toBe(7);
    expect(d.currencies.map((c) => c.currency)).toEqual(DEFAULT_FOREIGN);
    expect(d.currencies.every((c) => c.status === 'missing' && c.rate === null && c.rateOn === null && c.ageDays === null)).toBe(true);
    expect(d.stale).toEqual(DEFAULT_FOREIGN);
    expect(d.manualOrBank).toEqual({
      total: 0,
      byKind: [
        { kind: 'clientPayment', label: 'Client payments', count: 0 },
        { kind: 'thirdPartyPayout', label: 'Third-party payouts', count: 0 },
        { kind: 'expense', label: 'Expenses', count: 0 },
        { kind: 'teamPayout', label: 'Team payouts', count: 0 },
      ],
      counted: ['clientPayment', 'thirdPartyPayout', 'expense', 'teamPayout'],
    });
    expect(d.history).toEqual({ currency: null, available: [], points: [] });
  });

  it('has nothing to track when only INR is on', async () => {
    await setSettings({ enabledCurrencies: ['INR'] });
    const d = await getFxDashboard(await sessionFor(await makeSuperadmin()), FY, { now: NOW });
    expect(d.currencies).toEqual([]);
    expect(d.stale).toEqual([]);
    expect(d.history).toEqual({ currency: null, available: [], points: [] });
  });

  it('needs a signed-in viewer', async () => {
    await expect(getFxDashboard(undefined as never, FY, { now: NOW })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('the latest rate per enabled currency', () => {
  it('reports the newest rate on or before today with its date, age and source, and flags what is stale or missing', async () => {
    await makeFxRate({ currency: 'USD', on: '2026-10-01', rate: 80 });
    await makeFxRate({ currency: 'USD', on: '2026-10-10', rate: 83.42, source: 'ecb' });
    await makeFxRate({ currency: 'USD', on: '2026-10-20', rate: 99 }); // after today: not "latest"
    await makeFxRate({ currency: 'EUR', on: '2026-10-01', rate: 90.5 });
    await makeFxRate({ currency: 'GBP', on: '2026-10-12', rate: 105 });
    const d = await getFxDashboard(await sessionFor(await makeAdmin()), FY, { now: NOW });
    const by = Object.fromEntries(d.currencies.map((c) => [c.currency, c]));
    expect(by.USD).toEqual({ currency: 'USD', rate: 83.42, rateOn: '2026-10-10', source: 'ecb', ageDays: 2, status: 'current' });
    expect(by.EUR).toEqual({ currency: 'EUR', rate: 90.5, rateOn: '2026-10-01', source: 'manual', ageDays: 11, status: 'stale' });
    expect(by.GBP).toMatchObject({ rate: 105, ageDays: 0, status: 'current' });
    expect(by.AED).toMatchObject({ rate: null, status: 'missing' });
    expect(d.stale).toEqual(['EUR', 'AED', 'AUD', 'CAD', 'SGD']);
  });

  it('treats a rate exactly fxStaleDays old as current and one day older as stale, as resolveFx does', async () => {
    await makeFxRate({ currency: 'USD', on: '2026-10-05', rate: 83 }); // 7 days
    await makeFxRate({ currency: 'EUR', on: '2026-10-04', rate: 90 }); // 8 days
    const d = await getFxDashboard(await sessionFor(await makeAdmin()), FY, { now: NOW });
    expect(d.currencies.find((c) => c.currency === 'USD')).toMatchObject({ ageDays: 7, status: 'current' });
    expect(d.currencies.find((c) => c.currency === 'EUR')).toMatchObject({ ageDays: 8, status: 'stale' });
  });

  it('follows the stale window and the enabled list in Settings, and today in the organisation\'s zone', async () => {
    await setSettings({ fxStaleDays: 30, enabledCurrencies: ['INR', 'EUR', 'USD'] });
    await makeFxRate({ currency: 'USD', on: '2026-09-20', rate: 83 });
    await makeFxRate({ currency: 'GBP', on: '2026-10-10', rate: 105 }); // not enabled: not shown
    const d = await getFxDashboard(await sessionFor(await makeAdmin()), FY, { now: NOW });
    expect(d.currencies.map((c) => c.currency)).toEqual(['EUR', 'USD']);
    expect(d.currencies[1]).toMatchObject({ currency: 'USD', status: 'current', ageDays: 22 });
    expect(d.stale).toEqual(['EUR']);

    // 20:00 UTC on the 11th is already the 12th in India
    const late = await getFxDashboard(await sessionFor(await makeAdmin()), FY, { now: new Date('2026-10-11T20:00:00Z') });
    expect(late.today).toBe('2026-10-12');
    await makeFxRate({ currency: 'EUR', on: '2026-10-12', rate: 90 });
    const withToday = await getFxDashboard(await sessionFor(await makeAdmin()), FY, { now: new Date('2026-10-11T20:00:00Z') });
    expect(withToday.currencies[0]).toMatchObject({ currency: 'EUR', ageDays: 0 });
  });
});

describe('entries that used a manual or bank rate', () => {
  it('counts each ledger, skipping table and identity rates, void and rejected entries and other periods', async () => {
    // client payments (date: receivedOn)
    await makeLedgerEntry('clientPayment', { amount: manual(), on: '2026-10-05' });
    await makeLedgerEntry('clientPayment', { amount: bank(), on: '2026-06-30' });
    await makeLedgerEntry('clientPayment', { amount: moneyOf('table'), on: '2026-10-05' });
    await makeLedgerEntry('clientPayment', { amount: moneyOf('identity'), on: '2026-10-05' });
    await makeLedgerEntry('clientPayment', { amount: manual(), on: '2026-10-05', status: 'void' });
    await makeLedgerEntry('clientPayment', { amount: manual(), on: '2026-03-31' }); // last financial year
    await makeLedgerEntry('clientPayment', { amount: manual(), on: '2027-04-01' }); // next one
    // expenses (date: spentOn; void and rejected excluded, a submitted one still has its rate)
    await makeLedgerEntry('expense', { amount: manual(), on: '2026-10-06', status: 'approved' });
    await makeLedgerEntry('expense', { amount: bank(), on: '2026-10-06', status: 'submitted' });
    await makeLedgerEntry('expense', { amount: manual(), on: '2026-10-06', status: 'rejected' });
    await makeLedgerEntry('expense', { amount: manual(), on: '2026-10-06', status: 'void' });
    await makeLedgerEntry('expense', { amount: moneyOf('table'), on: '2026-10-06' });
    // third-party payouts: paid -> paidOn, due -> dueOn, neither -> the day the rate was set
    await makeLedgerEntry('thirdPartyPayout', { amount: manual(), on: '2026-10-07', status: 'paid' });
    await makeLedgerEntry('thirdPartyPayout', { amount: manual(), dueOn: '2026-11-15', status: 'due' });
    await makeLedgerEntry('thirdPartyPayout', { amount: manual({ fxDate: day('2026-10-20') }), status: 'due' });
    await makeLedgerEntry('thirdPartyPayout', { amount: manual(), on: '2025-10-07', status: 'paid' }); // outside
    await makeLedgerEntry('thirdPartyPayout', { amount: manual(), on: '2026-10-07', status: 'void' });
    // team payouts
    await makeLedgerEntry('teamPayout', { amount: bank(), on: '2026-10-08', status: 'paid' });
    await makeLedgerEntry('teamPayout', { amount: moneyOf('table'), on: '2026-10-08', status: 'paid' });

    const d = await getFxDashboard(await sessionFor(await makeSuperadmin()), FY, { now: NOW });
    expect(d.manualOrBank?.byKind).toEqual([
      { kind: 'clientPayment', label: 'Client payments', count: 2 },
      { kind: 'thirdPartyPayout', label: 'Third-party payouts', count: 3 },
      { kind: 'expense', label: 'Expenses', count: 2 },
      { kind: 'teamPayout', label: 'Team payouts', count: 1 },
    ]);
    expect(d.manualOrBank?.total).toBe(8);
  });

  it('follows the chosen period, a custom one included', async () => {
    await makeLedgerEntry('clientPayment', { amount: manual(), on: '2026-10-05' });
    await makeLedgerEntry('clientPayment', { amount: manual(), on: '2026-10-20' });
    await makeLedgerEntry('clientPayment', { amount: manual(), on: '2026-09-20' });
    const viewer = await sessionFor(await makeSuperadmin());
    const custom = resolvePeriod({ period: 'custom', from: '2026-10-05', to: '2026-10-20' }, NOW);
    expect((await getFxDashboard(viewer, custom, { now: NOW })).manualOrBank?.total).toBe(2); // both ends inclusive
    const lastMonth = resolvePeriod({ period: 'last_month' }, NOW);
    expect((await getFxDashboard(viewer, lastMonth, { now: NOW })).manualOrBank?.total).toBe(1);
  });

  it('is left OUT (null, never zero) for a viewer who may not see any ledger, and counts only the ledgers a viewer may see', async () => {
    await makeLedgerEntry('clientPayment', { amount: manual(), on: '2026-10-05' });
    await makeLedgerEntry('expense', { amount: manual(), on: '2026-10-05', status: 'approved' });
    await makeLedgerEntry('thirdPartyPayout', { amount: manual(), on: '2026-10-05', status: 'paid' });
    await makeLedgerEntry('teamPayout', { amount: manual(), on: '2026-10-05', status: 'paid' });

    const plain = await getFxDashboard(await sessionFor(await makeAdmin()), FY, { now: NOW });
    expect(plain.manualOrBank).toBeNull();
    expect(plain.currencies).toHaveLength(7); // rates are readable by every admin

    const payments = await getFxDashboard(await sessionFor(await makeAdmin({ grants: ['payment:view'] })), FY, { now: NOW });
    expect(payments.manualOrBank).toMatchObject({ total: 1, counted: ['clientPayment'] });

    const spending = await getFxDashboard(await sessionFor(await makeAdmin({ grants: ['expense:view', 'payout:view'] })), FY, { now: NOW });
    expect(spending.manualOrBank).toMatchObject({ total: 2, counted: ['thirdPartyPayout', 'expense'] });

    const everything = await getFxDashboard(await sessionFor(await makeSuperadmin()), FY, { now: NOW });
    expect(everything.manualOrBank).toMatchObject({ total: 4, counted: ['clientPayment', 'thirdPartyPayout', 'expense', 'teamPayout'] });
  });
});

describe('the rate history', () => {
  it('lists the points of one currency inside the period, oldest first, and which currencies have any', async () => {
    await makeFxRate({ currency: 'USD', on: '2026-10-09', rate: 83.1 });
    await makeFxRate({ currency: 'USD', on: '2026-10-02', rate: 82.9 });
    await makeFxRate({ currency: 'USD', on: '2026-03-30', rate: 80 }); // last financial year
    await makeFxRate({ currency: 'EUR', on: '2026-10-09', rate: 91 });
    await makeFxRate({ currency: 'JPY', on: '2026-10-09', rate: 0.55 }); // not enabled
    const viewer = await sessionFor(await makeAdmin());

    const d = await getFxDashboard(viewer, FY, { now: NOW });
    expect(d.history.available).toEqual(['USD', 'EUR']);
    expect(d.history.currency).toBe('USD'); // the first with data
    expect(d.history.points).toEqual([{ day: '2026-10-02', rate: 82.9 }, { day: '2026-10-09', rate: 83.1 }]);

    const eur = await getFxDashboard(viewer, FY, { now: NOW, currency: 'EUR' });
    expect(eur.history).toEqual({ currency: 'EUR', available: ['USD', 'EUR'], points: [{ day: '2026-10-09', rate: 91 }] });
  });

  it('keeps a chosen currency with nothing in the period (an empty line), and ignores one that is not enabled or not a currency', async () => {
    await makeFxRate({ currency: 'USD', on: '2026-10-09', rate: 83.1 });
    const viewer = await sessionFor(await makeAdmin());
    expect((await getFxDashboard(viewer, FY, { now: NOW, currency: 'GBP' })).history).toMatchObject({ currency: 'GBP', points: [] });
    expect((await getFxDashboard(viewer, FY, { now: NOW, currency: 'JPY' })).history.currency).toBe('USD');
    expect((await getFxDashboard(viewer, FY, { now: NOW, currency: 'INR' })).history.currency).toBe('USD');
    expect((await getFxDashboard(viewer, FY, { now: NOW, currency: '$ne' })).history.currency).toBe('USD');
  });

  it('narrows to a custom period, both ends inclusive', async () => {
    for (const on of ['2026-10-01', '2026-10-05', '2026-10-10', '2026-10-11']) await makeFxRate({ currency: 'USD', on, rate: 83 });
    const custom = resolvePeriod({ period: 'custom', from: '2026-10-05', to: '2026-10-10' }, NOW);
    const d = await getFxDashboard(await sessionFor(await makeAdmin()), custom, { now: NOW });
    expect(d.history.points.map((p) => p.day)).toEqual(['2026-10-05', '2026-10-10']);
  });
});
