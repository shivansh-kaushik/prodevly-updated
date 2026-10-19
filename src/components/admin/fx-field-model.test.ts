import { describe, expect, it } from 'vitest';
import { CURRENCY_CODES } from '@/config/currencies';
import { toInrMinor } from '@/lib/money/fx';
import {
  deriveRate,
  formatCoded,
  fxSummary,
  fxValueError,
  fxValueToPayload,
  parseRateText,
  parseSettledInr,
  previewInr,
  tableBasis,
  tableUsable,
  TABLE_FX,
  type FxLookup,
  type FxValue,
} from './fx-field-model';

const value = (v: Partial<FxValue>): FxValue => ({ choice: 'table', manualRate: '', settledInr: '', ...v });

describe('fxValueToPayload', () => {
  it('sends nothing for the table rate, whatever is left in the other boxes', () => {
    expect(fxValueToPayload(TABLE_FX)).toEqual({});
    expect(fxValueToPayload(value({ choice: 'table', manualRate: '99', settledInr: '5' }))).toEqual({});
  });

  it('sends the exact rate as a number for manual, and only that', () => {
    expect(fxValueToPayload(value({ choice: 'manual', manualRate: '83.42' }))).toEqual({ manualRate: 83.42 });
    expect(fxValueToPayload(value({ choice: 'manual', manualRate: ' 83.123456 ', settledInr: '500' }))).toEqual({ manualRate: 83.123456 });
    expect(fxValueToPayload(value({ choice: 'manual', manualRate: '84' }))).toEqual({ manualRate: 84 });
  });

  it('sends the INR that arrived as whole paise for bank, and only that', () => {
    expect(fxValueToPayload(value({ choice: 'bank', settledInr: '83,420.00', manualRate: '1' }))).toEqual({ settledInrMinor: 8_342_000 });
    expect(fxValueToPayload(value({ choice: 'bank', settledInr: '1250.5' }))).toEqual({ settledInrMinor: 125_050 });
    expect(fxValueToPayload(value({ choice: 'bank', settledInr: '12,34,567' }))).toEqual({ settledInrMinor: 123_456_700 });
  });

  it('THROWS for an incomplete choice, so a typed rate can never silently become a table lookup', () => {
    for (const manualRate of ['', ' ', 'abc', '0', '0.0000001', '83,42', '-5', '1e3']) {
      expect(() => fxValueToPayload(value({ choice: 'manual', manualRate })), `manual "${manualRate}"`).toThrow(RangeError);
    }
    for (const settledInr of ['', 'abc', '0', '0.00', '12,50', '1.234', '-4']) {
      expect(() => fxValueToPayload(value({ choice: 'bank', settledInr })), `bank "${settledInr}"`).toThrow(RangeError);
    }
  });
});

describe('fxValueError', () => {
  it('is null when the value is complete and a message when it is not', () => {
    expect(fxValueError(TABLE_FX)).toBeNull();
    expect(fxValueError(value({ choice: 'manual', manualRate: '83.5' }))).toBeNull();
    expect(fxValueError(value({ choice: 'bank', settledInr: '8350' }))).toBeNull();
    expect(fxValueError(value({ choice: 'manual' }))).toMatch(/exact rate/);
    expect(fxValueError(value({ choice: 'bank' }))).toMatch(/INR amount/);
  });
});

describe('parseRateText', () => {
  it('reads plain positive decimals of at most six places', () => {
    expect(parseRateText('83.42')).toBe(83.42);
    expect(parseRateText('0.000001')).toBe(0.000001);
    expect(parseRateText('0.55')).toBe(0.55);
    expect(parseRateText('270')).toBe(270);
    expect(parseRateText(' 83.123456 ')).toBe(83.123456);
  });
  it('refuses everything else', () => {
    for (const bad of ['', '.5', '5.', '83.1234567', '1,234.5', '83,42', '-1', '+1', '0', '0.0', '1e2', 'NaN', '1000000000', '12 3']) {
      expect(parseRateText(bad), bad).toBeNull();
    }
  });
});

describe('parseSettledInr', () => {
  it('reads an INR amount into paise and refuses zero and junk', () => {
    expect(parseSettledInr('83,420.00')).toBe(8_342_000);
    expect(parseSettledInr('0.01')).toBe(1);
    expect(parseSettledInr('0')).toBeNull();
    expect(parseSettledInr('83.421')).toBeNull();
    expect(parseSettledInr('')).toBeNull();
  });
});

describe('deriveRate', () => {
  it('is the inverse of the INR computation: USD 1,000.00 delivering INR 83,500.00 is a rate of 83.5', () => {
    expect(deriveRate(100_000, 'USD', 8_350_000)).toBe(83.5);
    expect(deriveRate(100_000, 'USD', 8_342_000)).toBe(83.42);
  });

  it('rounds half up to six decimals', () => {
    expect(deriveRate(300, 'USD', 25_027)).toBe(83.423333);
    expect(deriveRate(3, 'USD', 25)).toBe(8.333333);
    expect(deriveRate(7, 'USD', 1)).toBe(0.142857);
  });

  it('knows the minor unit of each currency (JPY has none, KWD has three)', () => {
    expect(deriveRate(1000, 'JPY', 55_000)).toBe(0.55);
    expect(deriveRate(1000, 'KWD', 27_000)).toBe(270);
  });

  it('is 1 for INR and null for anything that cannot be a rate', () => {
    expect(deriveRate(5000, 'INR', 5000)).toBe(1);
    expect(deriveRate(0, 'USD', 100)).toBeNull();
    expect(deriveRate(100, 'USD', 0)).toBeNull();
    expect(deriveRate(100, 'USD', -1)).toBeNull();
    expect(deriveRate(1.5, 'USD', 100)).toBeNull();
    expect(deriveRate(Number.MAX_SAFE_INTEGER, 'USD', 1)).toBeNull(); // rounds to nothing
  });

  it('round-trips with toInrMinor: converting at the derived rate gives the figure the bank delivered (to within rounding of the rate)', () => {
    for (const currency of CURRENCY_CODES.filter((c) => c !== 'INR')) {
      for (const [amountMinor, settled] of [[100_000, 8_350_000], [1250, 104_100], [999_999, 83_000_000], [12, 1001]] as const) {
        const rate = deriveRate(amountMinor, currency, settled);
        if (rate === null) continue;
        const back = toInrMinor(amountMinor, currency, rate);
        // A six-decimal rate cannot always hit the exact paisa for a tiny amount; the miss is bounded by the rate's own rounding.
        const slack = Math.max(1, Math.ceil(amountMinor * 1e-6 * 100) + 1);
        expect(Math.abs(back - settled), `${currency} ${amountMinor}`).toBeLessThanOrEqual(slack);
      }
    }
  });
});

describe('previewInr', () => {
  it('converts, and gives null instead of throwing when the sum is too large', () => {
    expect(previewInr(100_000, 'USD', 83.42)).toBe(8_342_000);
    expect(previewInr(Number.MAX_SAFE_INTEGER, 'USD', 999_999)).toBeNull();
  });
});

describe('the quiet line', () => {
  it('writes the sentence from the brief exactly', () => {
    expect(fxSummary({ currency: 'USD', amountMinor: 100_000, inrMinor: 8_342_000, rate: 83.42, basis: tableBasis('2026-10-12') }))
      .toBe('USD 1,000.00 = INR 83,420.00 at 83.42 (table, 12 Oct 2026)');
  });
  it('groups INR the Indian way and others the Western way', () => {
    expect(formatCoded(8_342_000_00, 'INR')).toBe('INR 83,42,000.00');
    expect(formatCoded(123_456_789, 'USD')).toBe('USD 1,234,567.89');
    expect(formatCoded(1000, 'JPY')).toBe('JPY 1,000');
    expect(formatCoded(1500, 'KWD')).toBe('KWD 1.500');
  });
  it('states the rate alone while there is no amount yet', () => {
    expect(fxSummary({ currency: 'EUR', amountMinor: null, inrMinor: null, rate: 91.2, basis: 'table, 9 Oct 2026' })).toBe('1 EUR = INR 91.2 (table, 9 Oct 2026)');
    expect(fxSummary({ currency: 'EUR', amountMinor: 0, inrMinor: 0, rate: 91.2, basis: 'x' })).toBe('1 EUR = INR 91.2 (x)');
  });
});

describe('tableUsable', () => {
  const base: FxLookup = { currency: 'USD', rate: 83.42, rateOn: '2026-10-12', source: 'ecb', stale: false, staleDays: 7 };
  it('needs a rate that is on file and not stale', () => {
    expect(tableUsable(base)).toBe(true);
    expect(tableUsable({ ...base, stale: true })).toBe(false);
    expect(tableUsable({ ...base, rate: null, rateOn: null, source: null, stale: true })).toBe(false);
    expect(tableUsable(null)).toBe(false);
  });
});
