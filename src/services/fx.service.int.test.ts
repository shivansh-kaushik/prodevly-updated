import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as cronRoute } from '@/app/api/cron/fx/route';
import { GET as listRoute, POST as createRoute } from '@/app/api/admin/fx-rates/route';
import { PATCH as patchRoute } from '@/app/api/admin/fx-rates/[id]/route';
import { GET as lookupRoute } from '@/app/api/admin/fx-rates/lookup/route';
import { moneyProblem } from '@/lib/money/fx';
import { AuditLog, ClientPayment, FxRate } from '@/models';
import {
  assertFeedReachable,
  createFxRate,
  fetchAndStoreRates,
  isCronAuthorised,
  lookupFx,
  lookupRate,
  resolveFx,
  searchFxRates,
  updateFxRate,
} from '@/services/fx.service';
import { setupTestDb } from '@/test/db';
import { call, cookieFor, makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { day, fakeFeed, feedBody, makeFxRate, makeLedgerEntry, moneyOf, setSettings } from '@/test/settings-factories';

setupTestDb();
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Failure = { code?: string; status?: number; fields?: Record<string, string>; message?: string };
const rejects = async (p: Promise<unknown>): Promise<Failure> => {
  try {
    await p;
  } catch (e) {
    return e as Failure;
  }
  throw new Error('expected the call to be rejected');
};

const ON = day('2026-10-12');
const NOW = new Date('2026-10-12T10:00:00Z');

describe('resolveFx: INR', () => {
  it('is the identity, and ignores a rate or settled amount nobody should send for INR', async () => {
    const plain = await resolveFx({ currency: 'INR', on: ON, amountMinor: 125_050 });
    expect(plain).toEqual({ amountMinor: 125_050, currency: 'INR', fxRate: 1, fxDate: ON, fxSource: 'identity', inrMinor: 125_050 });
    const sneaky = await resolveFx({ currency: 'inr', on: ON, amountMinor: 125_050, manualRate: 50, settledInrMinor: 5 });
    expect(sneaky).toMatchObject({ fxRate: 1, fxSource: 'identity', inrMinor: 125_050 });
  });
});

describe('resolveFx: the table rate', () => {
  it('uses the row for the day and computes INR on the server: USD 1,000.00 at 83.42 is INR 83,420.00', async () => {
    await makeFxRate({ currency: 'USD', on: '2026-10-12', rate: 83.42 });
    const money = await resolveFx({ currency: 'USD', on: ON, amountMinor: 100_000 });
    expect(money).toEqual({ amountMinor: 100_000, currency: 'USD', fxRate: 83.42, fxDate: ON, fxSource: 'table', inrMinor: 8_342_000 });
    expect(moneyProblem(money)).toBeNull();
  });

  it('takes the latest row ON OR BEFORE the date, never a later one, and names that row in fxDate', async () => {
    await makeFxRate({ currency: 'USD', on: '2026-10-01', rate: 80 });
    await makeFxRate({ currency: 'USD', on: '2026-10-09', rate: 83.42 }); // a Friday
    await makeFxRate({ currency: 'USD', on: '2026-10-20', rate: 90 });
    const sunday = await resolveFx({ currency: 'USD', on: day('2026-10-11'), amountMinor: 100_000 });
    expect(sunday).toMatchObject({ fxRate: 83.42, fxSource: 'table', fxDate: day('2026-10-09') });
    const early = await resolveFx({ currency: 'USD', on: day('2026-10-05'), amountMinor: 100_000 });
    expect(early.fxRate).toBe(80);
  });

  it('ignores the time of day and rejects a date that is not a date', async () => {
    await makeFxRate({ currency: 'USD', on: '2026-10-12', rate: 83.42 });
    const late = await resolveFx({ currency: 'USD', on: new Date('2026-10-12T23:59:00Z'), amountMinor: 100_000 });
    expect(late.fxRate).toBe(83.42);
    expect((await rejects(resolveFx({ currency: 'USD', on: new Date('nope'), amountMinor: 100_000 }))).fields).toHaveProperty('date');
  });

  it('is the stale boundary: a rate exactly fxStaleDays old works, one day older does not', async () => {
    await makeFxRate({ currency: 'USD', on: '2026-10-05', rate: 83.42 }); // fxStaleDays defaults to 7
    await expect(resolveFx({ currency: 'USD', on: day('2026-10-12'), amountMinor: 100_000 })).resolves.toMatchObject({ fxRate: 83.42 });
    const err = await rejects(resolveFx({ currency: 'USD', on: day('2026-10-13'), amountMinor: 100_000 }));
    expect(err).toMatchObject({ code: 'FX_RATE_MISSING', status: 422 });
    expect(err.fields).toEqual({ fxRate: 'Enter the exchange rate' });
  });

  it('follows the stale window in Settings', async () => {
    await makeFxRate({ currency: 'USD', on: '2026-09-01', rate: 83.42 });
    await setSettings({ fxStaleDays: 60 });
    await expect(resolveFx({ currency: 'USD', on: ON, amountMinor: 100_000 })).resolves.toMatchObject({ fxRate: 83.42 });
    await setSettings({ fxStaleDays: 30 });
    expect((await rejects(resolveFx({ currency: 'USD', on: ON, amountMinor: 100_000 }))).code).toBe('FX_RATE_MISSING');
  });

  it('answers FX_RATE_MISSING when there is no rate at all, or only a later one', async () => {
    expect((await rejects(resolveFx({ currency: 'USD', on: ON, amountMinor: 100_000 }))).code).toBe('FX_RATE_MISSING');
    await makeFxRate({ currency: 'USD', on: '2026-10-13', rate: 83.42 });
    expect((await rejects(resolveFx({ currency: 'USD', on: ON, amountMinor: 100_000 }))).code).toBe('FX_RATE_MISSING');
  });

  it('keeps currencies apart', async () => {
    await makeFxRate({ currency: 'EUR', on: '2026-10-12', rate: 90.1 });
    expect((await rejects(resolveFx({ currency: 'USD', on: ON, amountMinor: 100_000 }))).code).toBe('FX_RATE_MISSING');
    expect((await resolveFx({ currency: 'EUR', on: ON, amountMinor: 100_000 })).inrMinor).toBe(9_010_000);
  });

  it('refuses a currency that is not turned on, even with a rate typed in, on the field named currency', async () => {
    await setSettings({ enabledCurrencies: ['INR', 'EUR'] });
    await makeFxRate({ currency: 'USD', on: '2026-10-12', rate: 83.42 });
    for (const extra of [{}, { manualRate: 83.5 }, { settledInrMinor: 8_350_000 }]) {
      const err = await rejects(resolveFx({ currency: 'USD', on: ON, amountMinor: 100_000, ...extra }));
      expect(err.code).toBe('VALIDATION_FAILED');
      expect(err.fields).toHaveProperty('currency');
    }
    expect((await rejects(resolveFx({ currency: 'XXX', on: ON, amountMinor: 100_000 }))).fields).toHaveProperty('currency');
  });

  it('refuses an amount that is not a positive whole number of minor units', async () => {
    for (const amountMinor of [0, -5, 1.5, Number.NaN, 2 ** 60]) {
      expect((await rejects(resolveFx({ currency: 'INR', on: ON, amountMinor }))).fields).toHaveProperty('amountMinor');
    }
  });

  it('reports an amount too large to convert on the amount, not on the rate', async () => {
    const huge = 9_000_000_000_000_000;
    await makeFxRate({ currency: 'USD', on: '2026-10-12', rate: 83.42 });
    for (const extra of [{}, { manualRate: 83.42 }]) {
      const err = await rejects(resolveFx({ currency: 'USD', on: ON, amountMinor: huge, ...extra }));
      expect(err.code).toBe('VALIDATION_FAILED');
      expect(err.fields).toHaveProperty('amountMinor');
    }
  });

  it('builds a Money value the ledger schemas accept', async () => {
    await makeFxRate({ currency: 'USD', on: '2026-10-12', rate: 83.42 });
    const amount = await resolveFx({ currency: 'USD', on: ON, amountMinor: 100_000 });
    await makeLedgerEntry('clientPayment', { amount, on: '2026-10-12' });
    expect(await ClientPayment.countDocuments({ 'amount.fxSource': 'table' })).toBe(1);
  });
});

describe('resolveFx: a rate typed by hand', () => {
  it('gives source manual with the exact rate, needing no table row at all', async () => {
    const money = await resolveFx({ currency: 'USD', on: ON, amountMinor: 100_000, manualRate: 83.5 });
    expect(money).toEqual({ amountMinor: 100_000, currency: 'USD', fxRate: 83.5, fxDate: ON, fxSource: 'manual', inrMinor: 8_350_000 });
  });

  it('prefers the typed rate over a table rate that exists', async () => {
    await makeFxRate({ currency: 'USD', on: '2026-10-12', rate: 83.42 });
    expect((await resolveFx({ currency: 'USD', on: ON, amountMinor: 100_000, manualRate: 84 })).inrMinor).toBe(8_400_000);
  });

  it('accepts a full six decimals and rejects seven, zero, negatives and nonsense', async () => {
    expect((await resolveFx({ currency: 'USD', on: ON, amountMinor: 100_000, manualRate: 83.123456 })).fxRate).toBe(83.123456);
    for (const manualRate of [83.1234567, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e9]) {
      expect((await rejects(resolveFx({ currency: 'USD', on: ON, amountMinor: 100_000, manualRate }))).fields).toHaveProperty('fxRate');
    }
  });

  it('refuses a rate AND a settled amount together', async () => {
    const err = await rejects(resolveFx({ currency: 'USD', on: ON, amountMinor: 100_000, manualRate: 83.5, settledInrMinor: 8_350_000 }));
    expect(err.fields).toHaveProperty('fxRate');
  });
});

describe('resolveFx: the INR the bank delivered', () => {
  it('derives the rate and gives source bank, keeping the bank figure exactly', async () => {
    const money = await resolveFx({ currency: 'USD', on: ON, amountMinor: 100_000, settledInrMinor: 8_350_000 });
    expect(money).toEqual({ amountMinor: 100_000, currency: 'USD', fxRate: 83.5, fxDate: ON, fxSource: 'bank', inrMinor: 8_350_000 });
  });

  it('rounds a derived rate to 6 decimals and still stores the bank figure', async () => {
    const money = await resolveFx({ currency: 'USD', on: ON, amountMinor: 300, settledInrMinor: 25_027 });
    expect(money).toMatchObject({ fxRate: 83.423333, fxSource: 'bank', inrMinor: 25_027 });
    expect(moneyProblem(money)).toBeNull();
  });

  it('derives correctly for zero-decimal and three-decimal currencies', async () => {
    await setSettings({ enabledCurrencies: ['INR', 'JPY', 'KWD'] });
    expect(await resolveFx({ currency: 'JPY', on: ON, amountMinor: 1000, settledInrMinor: 55_000 })).toMatchObject({ fxRate: 0.55, inrMinor: 55_000 });
    expect(await resolveFx({ currency: 'KWD', on: ON, amountMinor: 1000, settledInrMinor: 27_000 })).toMatchObject({ fxRate: 270, inrMinor: 27_000 });
  });

  describe('tolerance against the table rate', () => {
    // USD 1,000.00 at 83.42 is 8,342,000 paise; the tolerance is 5% = 417,100 paise.
    it('accepts a bank figure inside the tolerance, at both edges', async () => {
      await makeFxRate({ currency: 'USD', on: '2026-10-12', rate: 83.42 });
      for (const settledInrMinor of [8_342_000 - 417_100, 8_350_000, 8_342_000 + 417_100]) {
        const money = await resolveFx({ currency: 'USD', on: ON, amountMinor: 100_000, settledInrMinor });
        expect(money).toMatchObject({ fxSource: 'bank', inrMinor: settledInrMinor });
      }
    });

    it('refuses a figure outside it (a dropped or extra digit) on the field settledInrMinor, and stores nothing', async () => {
      await makeFxRate({ currency: 'USD', on: '2026-10-12', rate: 83.42 });
      for (const settledInrMinor of [8_342_000 + 417_101, 834_200, 83_420_000]) {
        const err = await rejects(resolveFx({ currency: 'USD', on: ON, amountMinor: 100_000, settledInrMinor }));
        expect(err.code).toBe('VALIDATION_FAILED');
        expect(err.fields).toHaveProperty('settledInrMinor');
      }
    });

    it('has nothing to compare with when there is no current table rate: the bank figure stands', async () => {
      await expect(resolveFx({ currency: 'USD', on: ON, amountMinor: 100_000, settledInrMinor: 83_420_000 })).resolves.toMatchObject({ fxSource: 'bank' });
      await makeFxRate({ currency: 'USD', on: '2026-09-01', rate: 83.42 }); // stale
      await expect(resolveFx({ currency: 'USD', on: ON, amountMinor: 100_000, settledInrMinor: 83_420_000 })).resolves.toMatchObject({ fxSource: 'bank' });
    });
  });

  it('rejects a settled amount that is not a positive whole number of paise', async () => {
    for (const settledInrMinor of [0, -1, 1.5, Number.NaN]) {
      expect((await rejects(resolveFx({ currency: 'USD', on: ON, amountMinor: 100_000, settledInrMinor }))).fields).toHaveProperty('settledInrMinor');
    }
  });
});

describe('lookupRate and lookupFx', () => {
  it('lookupRate: identity for INR, null with no rate, the row (flagged stale) when it is too old', async () => {
    expect(await lookupRate('INR', ON)).toEqual({ rate: 1, rateOn: ON, source: 'identity', stale: false });
    expect(await lookupRate('USD', ON)).toBeNull();
    await makeFxRate({ currency: 'USD', on: '2026-09-01', rate: 83.42, source: 'ecb' });
    expect(await lookupRate('usd', ON)).toEqual({ rate: 83.42, rateOn: day('2026-09-01'), source: 'ecb', stale: true });
    await makeFxRate({ currency: 'USD', on: '2026-10-10', rate: 83.5 });
    expect(await lookupRate('USD', ON)).toEqual({ rate: 83.5, rateOn: day('2026-10-10'), source: 'manual', stale: false });
  });

  it('lookupFx: a usable rate with the INR value of the amount', async () => {
    const viewer = await sessionFor(await makeAdmin());
    await makeFxRate({ currency: 'USD', on: '2026-10-10', rate: 83.42 });
    expect(await lookupFx(viewer, { currency: 'USD', date: ON, amountMinor: 100_000 })).toEqual({
      currency: 'USD', rate: 83.42, rateOn: '2026-10-10', source: 'manual', stale: false, staleDays: 7, inrMinor: 8_342_000,
    });
    expect(await lookupFx(viewer, { currency: 'USD', date: ON })).not.toHaveProperty('inrMinor');
  });

  it('lookupFx: no INR value when the rate is stale, and nulls when there is no rate', async () => {
    const viewer = await sessionFor(await makeAdmin());
    expect(await lookupFx(viewer, { currency: 'EUR', date: ON, amountMinor: 100_000 })).toEqual({ currency: 'EUR', rate: null, rateOn: null, source: null, stale: true, staleDays: 7 });
    await makeFxRate({ currency: 'EUR', on: '2026-09-01', rate: 90 });
    const stale = await lookupFx(viewer, { currency: 'EUR', date: ON, amountMinor: 100_000 });
    expect(stale).toMatchObject({ rate: 90, stale: true });
    expect(stale).not.toHaveProperty('inrMinor');
  });

  it('lookupFx: INR is a rate of 1, and a currency that is switched off is a validation error', async () => {
    const viewer = await sessionFor(await makeAdmin());
    expect(await lookupFx(viewer, { currency: 'INR', date: ON, amountMinor: 5000 })).toMatchObject({ rate: 1, source: 'identity', inrMinor: 5000 });
    await setSettings({ enabledCurrencies: ['INR'] });
    expect((await rejects(lookupFx(viewer, { currency: 'USD', date: ON }))).fields).toHaveProperty('currency');
  });
});

describe('creating a rate', () => {
  const input = { currency: 'USD', rateOn: '2026-10-12', rate: 83.42 };

  it('is for superadmins, stores it as manual with who entered it, and audits it', async () => {
    const sa = await makeSuperadmin();
    const rate = await createFxRate(await sessionFor(sa), input, { requestId: 'r1' }, NOW);
    expect(rate).toMatchObject({ currency: 'USD', rateOn: '2026-10-12', rate: 83.42, source: 'manual', enteredBy: sa.name });
    expect(JSON.stringify(rate)).not.toContain(String(sa._id));

    const entry = await AuditLog.findOne({ action: 'fxRate.create' }).lean();
    expect(entry?.actor.name).toBe(sa.name);
    expect(entry?.entity).toMatchObject({ type: 'fxRate', label: expect.stringContaining('USD') });
    expect(entry?.changes.map((c) => c.path)).toEqual(['currency', 'rateOn', 'rate', 'source']);
    expect(entry?.requestId).toBe('r1');
  });

  it('is for a granted admin too, and for nobody else, and a refusal writes nothing', async () => {
    const granted = await sessionFor(await makeAdmin({ grants: ['fx:edit'] }));
    await expect(createFxRate(granted, input, {}, NOW)).resolves.toMatchObject({ rate: 83.42 });

    await FxRate.deleteMany({});
    await AuditLog.collection.deleteMany({});
    const plain = await sessionFor(await makeAdmin());
    expect((await rejects(createFxRate(plain, input, {}, NOW))).code).toBe('FORBIDDEN');
    expect(await FxRate.countDocuments()).toBe(0);
    expect(await AuditLog.countDocuments()).toBe(0);
  });

  it('is unique per currency per day: a second answers CONFLICT on rateOn, another day or currency is fine', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    await createFxRate(sa, input, {}, NOW);
    const dup = await rejects(createFxRate(sa, { ...input, rate: 90 }, {}, NOW));
    expect(dup).toMatchObject({ code: 'CONFLICT', status: 409 });
    expect(dup.fields).toHaveProperty('rateOn');
    expect((await FxRate.findOne({ currency: 'USD' }).lean())?.rate).toBe(83.42);
    await expect(createFxRate(sa, { ...input, rateOn: '2026-10-11' }, {}, NOW)).resolves.toBeTruthy();
    await expect(createFxRate(sa, { ...input, currency: 'EUR' }, {}, NOW)).resolves.toBeTruthy();
  });

  it('is unique in the database too, whatever the service checks', async () => {
    await makeFxRate({ currency: 'USD', on: '2026-10-12', rate: 83.42 });
    await expect(makeFxRate({ currency: 'USD', on: '2026-10-12', rate: 90 })).rejects.toMatchObject({ code: 11000 });
  });

  it('refuses INR, a currency that is switched off, and an unknown currency', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    expect((await rejects(createFxRate(sa, { ...input, currency: 'INR' }, {}, NOW))).fields).toHaveProperty('currency');
    expect((await rejects(createFxRate(sa, { ...input, currency: 'XXX' }, {}, NOW))).fields).toHaveProperty('currency');
    await setSettings({ enabledCurrencies: ['INR', 'EUR'] });
    expect((await rejects(createFxRate(sa, input, {}, NOW))).fields).toHaveProperty('currency');
    expect(await FxRate.countDocuments()).toBe(0);
  });

  it('refuses a future date but allows the organisation\'s today, even when UTC is still yesterday', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    expect((await rejects(createFxRate(sa, { ...input, rateOn: '2026-10-13' }, {}, NOW))).fields).toHaveProperty('rateOn');
    // 20:00 UTC on 11 Oct is already 12 Oct in India (UTC+5:30)
    const lateEvening = new Date('2026-10-11T20:00:00Z');
    await expect(createFxRate(sa, input, {}, lateEvening)).resolves.toBeTruthy();
    expect((await rejects(createFxRate(sa, { ...input, currency: 'EUR', rateOn: '2026-10-13' }, {}, lateEvening))).fields).toHaveProperty('rateOn');
  });

  it('refuses bad rates and dates, and a source nobody may choose', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    for (const rate of [0, -3, 83.1234567, Number.NaN, 1e9]) {
      expect((await rejects(createFxRate(sa, { ...input, rate }, {}, NOW))).fields).toHaveProperty('rate');
    }
    for (const rateOn of ['2026-02-30', '12/10/2026', '', '2026-10-12T00:00:00Z']) {
      expect((await rejects(createFxRate(sa, { ...input, rateOn }, {}, NOW))).fields).toHaveProperty('rateOn');
    }
    const withSource = { ...input, source: 'ecb' } as unknown as typeof input;
    expect((await rejects(createFxRate(sa, withSource, {}, NOW))).code).toBe('VALIDATION_FAILED');
    expect(await FxRate.countDocuments()).toBe(0);
  });

  it('is all or nothing: if the audit entry cannot be written the rate is not saved', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    vi.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('audit store down'));
    await expect(createFxRate(sa, input, {}, NOW)).rejects.toThrow('audit store down');
    expect(await FxRate.countDocuments()).toBe(0);
  });
});

describe('correcting a rate', () => {
  it('changes the value, makes the row manual, and audits before and after', async () => {
    const sa = await makeSuperadmin();
    const row = await makeFxRate({ currency: 'USD', on: '2026-10-12', rate: 83.42, source: 'ecb' });
    const out = await updateFxRate(await sessionFor(sa), String(row._id), { rate: 83.5 }, {}, NOW);
    expect(out).toMatchObject({ rate: 83.5, source: 'manual', enteredBy: sa.name, rateOn: '2026-10-12' });
    const entry = await AuditLog.findOne({ action: 'fxRate.update' }).lean();
    expect(entry?.changes).toEqual([
      { path: 'rate', before: 83.42, after: 83.5 },
      { path: 'source', before: 'ecb', after: 'manual' },
    ]);
  });

  it('can move a row to the day it belongs to, but not onto a day that has one, and not into the future', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const wrong = await makeFxRate({ currency: 'USD', on: '2026-10-02', rate: 83.42 });
    await makeFxRate({ currency: 'USD', on: '2026-10-10', rate: 83 });
    await makeFxRate({ currency: 'EUR', on: '2026-10-09', rate: 90 });
    expect((await rejects(updateFxRate(sa, String(wrong._id), { rateOn: '2026-10-10' }, {}, NOW))).code).toBe('CONFLICT');
    expect((await rejects(updateFxRate(sa, String(wrong._id), { rateOn: '2026-10-13' }, {}, NOW))).fields).toHaveProperty('rateOn');
    // another currency's row on that day is no obstacle
    await expect(updateFxRate(sa, String(wrong._id), { rateOn: '2026-10-09' }, {}, NOW)).resolves.toMatchObject({ rateOn: '2026-10-09' });
  });

  it('is a no-op, with no audit entry and the source untouched, when nothing really changes', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const row = await makeFxRate({ currency: 'USD', on: '2026-10-12', rate: 83.42, source: 'ecb' });
    const out = await updateFxRate(sa, String(row._id), { rate: 83.42, rateOn: '2026-10-12' }, {}, NOW);
    expect(out.source).toBe('ecb');
    expect(await AuditLog.countDocuments({ action: 'fxRate.update' })).toBe(0);
  });

  it('needs fx:edit, and 404s on an id that is malformed or unknown', async () => {
    const row = await makeFxRate({ currency: 'USD', on: '2026-10-12', rate: 83.42 });
    const plain = await sessionFor(await makeAdmin());
    expect((await rejects(updateFxRate(plain, String(row._id), { rate: 90 }, {}, NOW))).code).toBe('FORBIDDEN');
    expect((await FxRate.findById(row._id).lean())?.rate).toBe(83.42);

    const sa = await sessionFor(await makeSuperadmin());
    expect((await rejects(updateFxRate(sa, 'not-an-id', { rate: 90 }, {}, NOW))).code).toBe('NOT_FOUND');
    expect((await rejects(updateFxRate(sa, '5f3a9c0b1d2e4f6a8b7c9d0e', { rate: 90 }, {}, NOW))).code).toBe('NOT_FOUND');
    expect((await rejects(updateFxRate(sa, String(row._id), {}, {}, NOW))).code).toBe('VALIDATION_FAILED');
    expect((await rejects(updateFxRate(sa, String(row._id), { rate: 0 }, {}, NOW))).fields).toHaveProperty('rate');
  });

  it('never changes an entry already saved with the old rate', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const row = await makeFxRate({ currency: 'USD', on: '2026-10-12', rate: 83.42 });
    const amount = await resolveFx({ currency: 'USD', on: ON, amountMinor: 100_000 });
    await makeLedgerEntry('clientPayment', { amount, on: '2026-10-12' });
    await updateFxRate(sa, String(row._id), { rate: 99 }, {}, NOW);
    const saved = await ClientPayment.findOne().lean();
    expect(saved?.amount).toMatchObject({ fxRate: 83.42, inrMinor: 8_342_000 });
  });
});

describe('reading the table', () => {
  it('lets any signed-in admin read it, newest first, filtered and paged, with no actor ids', async () => {
    const plain = await sessionFor(await makeAdmin());
    await makeFxRate({ currency: 'USD', on: '2026-10-01', rate: 80 });
    await makeFxRate({ currency: 'USD', on: '2026-10-10', rate: 83 });
    await makeFxRate({ currency: 'EUR', on: '2026-10-10', rate: 90 });
    await makeFxRate({ currency: 'USD', on: '2026-09-01', rate: 78 });

    const all = await searchFxRates(plain);
    expect(all.rows.map((r) => `${r.rateOn} ${r.currency}`)).toEqual(['2026-10-10 EUR', '2026-10-10 USD', '2026-10-01 USD', '2026-09-01 USD']);
    expect(all.meta).toMatchObject({ total: 4, page: 1 });
    expect(JSON.stringify(all.rows)).not.toMatch(/"id":null|enteredBy":\{/);

    const usd = await searchFxRates(plain, { currency: 'usd', from: day('2026-10-01'), to: day('2026-10-31') });
    expect(usd.rows.map((r) => r.rateOn)).toEqual(['2026-10-10', '2026-10-01']);

    const second = await searchFxRates(plain, { pageSize: 2, page: 2 });
    expect(second.rows).toHaveLength(2);
    expect(second.meta).toMatchObject({ page: 2, pages: 2, from: 3, to: 4 });
  });

  it('searches by currency code or by who entered the rate, as literal text, and filters by source', async () => {
    const sa = await makeSuperadmin();
    const viewer = await sessionFor(await makeAdmin());
    await createFxRate(await sessionFor(sa), { currency: 'USD', rateOn: '2026-10-10', rate: 83 }, {}, NOW);
    await makeFxRate({ currency: 'EUR', on: '2026-10-10', rate: 90, source: 'ecb' });
    await makeFxRate({ currency: 'GBP', on: '2026-10-10', rate: 105 });

    expect((await searchFxRates(viewer, { q: 'us' })).rows.map((r) => r.currency)).toEqual(['USD']);
    expect((await searchFxRates(viewer, { q: sa.name.slice(0, 4).toLowerCase() })).rows.map((r) => r.currency)).toEqual(['USD']);
    expect((await searchFxRates(viewer, { q: 'ECB' })).rows.map((r) => r.currency)).toEqual(['EUR']);
    expect((await searchFxRates(viewer, { source: 'ecb' })).rows.map((r) => r.currency)).toEqual(['EUR']);
    expect((await searchFxRates(viewer, { source: 'manual' })).rows).toHaveLength(2);
    // regex characters are plain characters: ".*" matches nothing, not everything
    expect((await searchFxRates(viewer, { q: '.*' })).rows).toEqual([]);
    expect((await rejects(searchFxRates(viewer, { source: 'bank' as 'manual' }))).code).toBe('VALIDATION_FAILED');
  });

  it('treats a currency filter as text, never an operator', async () => {
    const plain = await sessionFor(await makeAdmin());
    await makeFxRate({ currency: 'USD', on: '2026-10-10', rate: 83 });
    const err = await rejects(searchFxRates(plain, { currency: { $ne: 'USD' } as unknown as string }));
    expect(err.code).toBe('VALIDATION_FAILED');
  });
});

describe('the HTTP routes', () => {
  it('lets a plain admin read the table and look rates up, and nothing else; 401 when signed out', async () => {
    const plain = await makeAdmin();
    const cookie = await cookieFor(plain);
    const row = await makeFxRate({ currency: 'USD', on: '2026-10-10', rate: 83.42 });

    const list = await call(listRoute, '/api/admin/fx-rates?currency=USD', { cookie });
    expect(list.status).toBe(200);
    expect(list.body.data.rates).toHaveLength(1);

    const create = await call(createRoute, '/api/admin/fx-rates', { method: 'POST', body: { currency: 'EUR', rateOn: '2026-10-10', rate: 90 }, cookie });
    expect(create.status).toBe(403);
    const patch = await call(patchRoute, `/api/admin/fx-rates/${row._id}`, { method: 'PATCH', body: { rate: 90 }, cookie }, { id: String(row._id) });
    expect(patch.status).toBe(403);
    expect(await FxRate.countDocuments()).toBe(1);
    expect((await FxRate.findById(row._id).lean())?.rate).toBe(83.42);

    const lookup = await call(lookupRoute, '/api/admin/fx-rates/lookup?currency=USD&date=2026-10-12&amount=100000', { cookie });
    expect(lookup.status).toBe(200);
    expect(lookup.body.data).toMatchObject({ rate: 83.42, rateOn: '2026-10-10', source: 'manual', stale: false, inrMinor: 8_342_000 });

    expect((await call(listRoute, '/api/admin/fx-rates')).status).toBe(401);
    expect((await call(lookupRoute, '/api/admin/fx-rates/lookup?currency=USD&date=2026-10-12')).status).toBe(401);
  });

  it('creates and corrects through the routes for a granted admin and a superadmin, with field errors in place', async () => {
    const granted = await makeAdmin({ grants: ['fx:edit'] });
    const cookie = await cookieFor(granted);
    const created = await call(createRoute, '/api/admin/fx-rates', { method: 'POST', body: { currency: 'usd', rateOn: '2026-01-05', rate: 83.42 }, cookie });
    expect(created.status).toBe(201);
    expect(created.body.data.rate).toMatchObject({ currency: 'USD', source: 'manual', enteredBy: granted.name });

    const dup = await call(createRoute, '/api/admin/fx-rates', { method: 'POST', body: { currency: 'USD', rateOn: '2026-01-05', rate: 90 }, cookie });
    expect(dup.status).toBe(409);
    expect(dup.body.error.fields).toHaveProperty('rateOn');

    const bad = await call(createRoute, '/api/admin/fx-rates', { method: 'POST', body: { currency: 'USD', rateOn: '2026-01-06', rate: 0 }, cookie });
    expect(bad.status).toBe(422);
    expect(bad.body.error.fields).toHaveProperty('rate');

    const future = await call(createRoute, '/api/admin/fx-rates', { method: 'POST', body: { currency: 'USD', rateOn: '2999-01-01', rate: 90 }, cookie });
    expect(future.status).toBe(422);

    const id = created.body.data.rate.id as string;
    const sa = await cookieFor(await makeSuperadmin());
    const patched = await call(patchRoute, `/api/admin/fx-rates/${id}`, { method: 'PATCH', body: { rate: 83.5 }, cookie: sa }, { id });
    expect(patched.status).toBe(200);
    expect(patched.body.data.rate.rate).toBe(83.5);
    expect((await call(patchRoute, '/api/admin/fx-rates/not-an-id', { method: 'PATCH', body: { rate: 83.5 }, cookie: sa }, { id: 'not-an-id' })).status).toBe(404);
  });

  it('refuses cross-site writes even with a valid cookie, and writes nothing', async () => {
    const cookie = await cookieFor(await makeSuperadmin());
    const res = await call(createRoute, '/api/admin/fx-rates', {
      method: 'POST', body: { currency: 'USD', rateOn: '2026-01-05', rate: 83.42 }, cookie, headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(res.status).toBe(403);
    expect(await FxRate.countDocuments()).toBe(0);
  });

  it('lookup validates its query: 422 with the field named', async () => {
    const cookie = await cookieFor(await makeAdmin());
    const get = (q: string) => call(lookupRoute, `/api/admin/fx-rates/lookup?${q}`, { cookie });
    expect((await get('date=2026-10-12')).body.error.fields).toHaveProperty('currency');
    expect((await get('currency=USD')).body.error.fields).toHaveProperty('date');
    expect((await get('currency=USD&date=2026-13-45')).body.error.fields).toHaveProperty('date');
    expect((await get('currency=ZZZ&date=2026-10-12')).body.error.fields).toHaveProperty('currency');
    expect((await get('currency=USD&date=2026-10-12&amount=12.5')).body.error.fields).toHaveProperty('amount');
    await setSettings({ enabledCurrencies: ['INR'] });
    expect((await get('currency=USD&date=2026-10-12')).status).toBe(422);
    expect((await get('currency=INR&date=2026-10-12&amount=500')).body.data).toMatchObject({ rate: 1, inrMinor: 500 });
  });
});

describe('the ECB feed', () => {
  // 9 Oct 2026 is a Friday; the feed is run on the Sunday and still answers Friday's date.
  const SUNDAY = new Date('2026-10-11T08:00:00Z');
  const fullFeed = () => fakeFeed({ USD: feedBody('USD', '2026-10-09', 83.4213456), EUR: feedBody('EUR', '2026-10-09', 91.2), GBP: feedBody('GBP', '2026-10-09', 105.05) });

  it('asks for each enabled foreign currency as the base with INR as the symbol, so it stores INR per 1 unit', async () => {
    const feed = fullFeed();
    await fetchAndStoreRates({ fetchImpl: feed.fetchImpl, now: SUNDAY });
    expect(feed.urls).toHaveLength(7); // USD EUR GBP AED AUD CAD SGD: never INR
    expect(feed.urls.every((u) => u.startsWith('https://api.frankfurter.dev/v1/latest?'))).toBe(true);
    const usd = new URL(feed.urls.find((u) => u.includes('base=USD')) as string);
    expect(usd.searchParams.get('symbols')).toBe('INR');
    expect(feed.urls.some((u) => u.includes('base=INR'))).toBe(false);
  });

  it('stores each rate rounded to 6 decimals, dated with the ECB\'s own day, as source ecb, and reports what it skipped', async () => {
    const result = await fetchAndStoreRates({ fetchImpl: fullFeed().fetchImpl, now: SUNDAY });
    expect(result.stored).toEqual([
      { currency: 'USD', rateOn: '2026-10-09', rate: 83.421346 },
      { currency: 'EUR', rateOn: '2026-10-09', rate: 91.2 },
      { currency: 'GBP', rateOn: '2026-10-09', rate: 105.05 },
    ]);
    expect(result.skipped.map((s) => s.currency).sort()).toEqual(['AED', 'AUD', 'CAD', 'SGD']);
    expect(result.skipped[0]?.reason).toMatch(/does not publish/);
    expect(result.failed).toEqual([]);

    const row = await FxRate.findOne({ currency: 'USD' }).lean();
    expect(row).toMatchObject({ rate: 83.421346, source: 'ecb', rateOn: day('2026-10-09') });
    expect(row?.enteredBy?.id).toBeNull();
    expect(await FxRate.countDocuments()).toBe(3);

    const entries = await AuditLog.find({ action: 'fxRate.create' }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.actor).toMatchObject({ id: null, name: 'System' });
    expect(entries[0]?.changes).toHaveLength(3);
  });

  it('is idempotent: a second run changes nothing and writes no second audit entry', async () => {
    await fetchAndStoreRates({ fetchImpl: fullFeed().fetchImpl, now: SUNDAY });
    const again = await fetchAndStoreRates({ fetchImpl: fullFeed().fetchImpl, now: SUNDAY });
    expect(again.stored).toEqual([]);
    expect(again.unchanged).toHaveLength(3);
    expect(await FxRate.countDocuments()).toBe(3);
    expect(await AuditLog.countDocuments({ action: 'fxRate.create' })).toBe(1);
  });

  it('NEVER overwrites a rate for the same day, manual or not', async () => {
    await makeFxRate({ currency: 'USD', on: '2026-10-09', rate: 84, source: 'manual' });
    await makeFxRate({ currency: 'EUR', on: '2026-10-09', rate: 92, source: 'ecb' });
    const result = await fetchAndStoreRates({ fetchImpl: fullFeed().fetchImpl, now: SUNDAY });
    expect(result.unchanged).toEqual([
      { currency: 'USD', rateOn: '2026-10-09', keptSource: 'manual' },
      { currency: 'EUR', rateOn: '2026-10-09', keptSource: 'ecb' },
    ]);
    expect(result.stored.map((s) => s.currency)).toEqual(['GBP']);
    expect(await FxRate.findOne({ currency: 'USD' }).lean()).toMatchObject({ rate: 84, source: 'manual' });
    expect(await FxRate.findOne({ currency: 'EUR' }).lean()).toMatchObject({ rate: 92, source: 'ecb' });
  });

  it('only asks about the currencies that are switched on, and does nothing when there are none', async () => {
    await setSettings({ enabledCurrencies: ['INR', 'USD'] });
    const feed = fullFeed();
    const result = await fetchAndStoreRates({ fetchImpl: feed.fetchImpl, now: SUNDAY });
    expect(feed.urls).toHaveLength(1);
    expect(result.attempted).toBe(1);

    await setSettings({ enabledCurrencies: ['INR'] });
    const none = fullFeed();
    const idle = await fetchAndStoreRates({ fetchImpl: none.fetchImpl, now: SUNDAY });
    expect(none.urls).toHaveLength(0);
    expect(idle).toMatchObject({ attempted: 0, stored: [], failed: [] });
    expect(() => assertFeedReachable(idle)).not.toThrow();
  });

  it('survives a bad answer for one currency and still stores the rest', async () => {
    await setSettings({ enabledCurrencies: ['INR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD'] });
    const feed = fakeFeed({
      USD: feedBody('USD', '2026-10-09', 83.42),
      EUR: new TypeError('fetch failed'),
      GBP: { status: 502 },
      AUD: '{not json',
      CAD: feedBody('USD', '2026-10-09', 60), // the answer is about a different base
    });
    const result = await fetchAndStoreRates({ fetchImpl: feed.fetchImpl, now: SUNDAY });
    expect(result.stored.map((s) => s.currency)).toEqual(['USD']);
    expect(result.failed.map((f) => f.currency).sort()).toEqual(['AUD', 'CAD', 'EUR', 'GBP']);
    expect(JSON.stringify(result)).not.toMatch(/fetch failed|not json/); // reasons are written for people
    expect(() => assertFeedReachable(result)).not.toThrow();
  });

  it('refuses rates it cannot trust: zero, negative, missing INR, a future date, an oversized body', async () => {
    await setSettings({ enabledCurrencies: ['INR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD'] });
    const feed = fakeFeed({
      USD: feedBody('USD', '2026-10-09', 0),
      EUR: feedBody('EUR', '2026-10-09', -91),
      GBP: { amount: 1, base: 'GBP', date: '2026-10-09', rates: { USD: 1.3 } },
      AUD: feedBody('AUD', '2026-11-20', 55),
      CAD: JSON.stringify({ ...feedBody('CAD', '2026-10-09', 60), pad: 'x'.repeat(30_000) }),
    });
    const result = await fetchAndStoreRates({ fetchImpl: feed.fetchImpl, now: SUNDAY });
    expect(result.stored).toEqual([]);
    expect(result.failed).toHaveLength(5);
    expect(await FxRate.countDocuments()).toBe(0);
  });

  it('is an outage only when EVERY currency failed: the cron route should alarm, not stay quiet', async () => {
    const down = fakeFeed(Object.fromEntries(['USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD'].map((c) => [c, new TypeError('offline')])));
    const result = await fetchAndStoreRates({ fetchImpl: down.fetchImpl, now: SUNDAY });
    expect(result.failed).toHaveLength(7);
    expect(() => assertFeedReachable(result)).toThrowError(expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }));
  });

  it('gives up on a feed that hangs', async () => {
    await setSettings({ enabledCurrencies: ['INR', 'USD'] });
    const hang = (_url: string, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    const result = await fetchAndStoreRates({ fetchImpl: hang, now: SUNDAY, timeoutMs: 20 });
    expect(result.failed[0]?.reason).toMatch(/too long/);
  });
});

describe('the cron route', () => {
  const SECRET = 'cron-secret-for-tests-0123456789';
  const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

  it('answers a bare 401 without the right bearer secret, whatever is wrong with it, and does nothing', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    for (const options of [{}, bearer('wrong'), bearer(`${SECRET} `.trim() + 'x'), bearer(SECRET.slice(1)), { headers: { authorization: SECRET } }, { headers: { authorization: 'Basic abc' } }, bearer('')]) {
      const res = await call(cronRoute, '/api/cron/fx', options);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await FxRate.countDocuments()).toBe(0);
  });

  it('authorises nobody when CRON_SECRET is not configured, not even an empty bearer', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await call(cronRoute, '/api/cron/fx', bearer('anything'))).status).toBe(401);
    expect((await call(cronRoute, '/api/cron/fx', { headers: { authorization: 'Bearer ' } })).status).toBe(401);
  });

  it('with the secret, pulls the rates through fetch and answers the report', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    await setSettings({ enabledCurrencies: ['INR', 'USD'] });
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(feedBody('USD', '2026-10-09', 83.42)), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const res = await call(cronRoute, '/api/cron/fx', bearer(SECRET));
    expect(res.status).toBe(200);
    expect(res.body.data.stored).toEqual([{ currency: 'USD', rateOn: '2026-10-09', rate: 83.42 }]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(await FxRate.findOne({ currency: 'USD' }).lean()).toMatchObject({ source: 'ecb', rate: 83.42 });
  });

  it('answers 503 when the feed is down for every currency, and never logs or returns the secret', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    await setSettings({ enabledCurrencies: ['INR', 'USD'] });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call(cronRoute, '/api/cron/fx', bearer(SECRET));
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(SECRET);
  });

  it('isCronAuthorised compares secrets of any length without a shortcut', () => {
    expect(isCronAuthorised('Bearer abc', 'abc')).toBe(true);
    expect(isCronAuthorised('bearer   abc', 'abc')).toBe(true);
    expect(isCronAuthorised('Bearer abcd', 'abc')).toBe(false);
    expect(isCronAuthorised('Bearer ab', 'abc')).toBe(false);
    expect(isCronAuthorised('Bearer abc', '')).toBe(false);
    expect(isCronAuthorised('Bearer abc', undefined)).toBe(false);
    expect(isCronAuthorised(null, 'abc')).toBe(false);
    expect(isCronAuthorised('Token abc', 'abc')).toBe(false);
  });
});

describe('moneyOf fixtures stay coherent', () => {
  it('every fixture source passes the money model check', () => {
    for (const source of ['identity', 'table', 'manual'] as const) expect(moneyProblem(moneyOf(source))).toBeNull();
  });
});
