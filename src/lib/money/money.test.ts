import { describe, expect, it } from 'vitest';
import { formatMinor, minorToDecimal, parseMinor } from './minor';
import { buildMoney, isValidRate, moneyProblem, roundRate, toInrMinor } from './fx';

describe('parseMinor', () => {
  it('turns typed amounts into integer minor units', () => {
    expect(parseMinor('1,250.50', 'INR')).toBe(125050);
    expect(parseMinor('1250', 'USD')).toBe(125000);
    expect(parseMinor(' 0.05 ', 'EUR')).toBe(5);
    expect(parseMinor('500', 'JPY')).toBe(500);
    expect(parseMinor('1.234', 'KWD')).toBe(1234);
  });
  it('accepts thousands separators only where a person would put them', () => {
    expect(parseMinor('1,250', 'INR')).toBe(125000);
    expect(parseMinor('12,34,567', 'INR')).toBe(123456700); // Indian grouping
    expect(parseMinor('1,234,567.89', 'USD')).toBe(123456789);
    // "12,50" is a decimal comma, NOT 1250: reading it that way silently multiplies by 100.
    expect(parseMinor('12,50', 'INR')).toBeNull();
    expect(parseMinor('0,5', 'EUR')).toBeNull();
  });
  it('rejects things that are not amounts', () => {
    for (const bad of ['', 'abc', '12.345', '-5', '1e3', '1.2.3', '12,34,56.789', '12,50', '1,2,3', '1,,000', ',100', '100,', '1 000', '1_000', '1,0000']) {
      expect(parseMinor(bad, 'USD')).toBeNull();
    }
    expect(parseMinor('1.5', 'JPY')).toBeNull();
    expect(parseMinor('9'.repeat(16), 'USD')).toBeNull();
  });
});

describe('minorToDecimal / formatMinor', () => {
  it('is exact', () => {
    expect(minorToDecimal(125050, 'INR')).toBe('1250.50');
    expect(minorToDecimal(5, 'USD')).toBe('0.05');
    expect(minorToDecimal(500, 'JPY')).toBe('500');
    expect(minorToDecimal(1234, 'KWD')).toBe('1.234');
  });
  it('groups INR the Indian way', () => {
    expect(formatMinor(123456700, 'INR')).toContain('12,34,567.00');
  });
});

describe('toInrMinor', () => {
  it('matches the worked example: USD 1,000.00 at 83.42 is INR 83,420.00', () => {
    expect(toInrMinor(100000, 'USD', 83.42)).toBe(8342000);
  });
  it('is the identity for INR', () => {
    expect(toInrMinor(123456, 'INR', 1)).toBe(123456);
  });
  it('handles zero-decimal and three-decimal currencies', () => {
    // JPY 1,000 at 0.55 INR = INR 550.00 = 55000 paise
    expect(toInrMinor(1000, 'JPY', 0.55)).toBe(55000);
    // KWD 1.000 (1000 fils) at 270 INR = INR 270.00 = 27000 paise
    expect(toInrMinor(1000, 'KWD', 270)).toBe(27000);
  });
  it('rounds half up and never drifts like float arithmetic', () => {
    // 1 cent at 83.425 INR = 0.83425 INR = 83.425 paise -> 83
    expect(toInrMinor(1, 'USD', 83.425)).toBe(83);
    // 1 cent at 83.5 = 83.5 paise -> 84 (half up)
    expect(toInrMinor(1, 'USD', 83.5)).toBe(84);
    // classic float trap: 0.1 + 0.2 style values stay exact
    expect(toInrMinor(30, 'USD', 0.1)).toBe(3);
  });
  it('rejects nonsense', () => {
    expect(() => toInrMinor(1.5, 'USD', 83)).toThrow();
    expect(() => toInrMinor(-1, 'USD', 83)).toThrow();
    expect(() => toInrMinor(100, 'USD', 0)).toThrow();
  });
});

describe('rates', () => {
  it('rounds to six decimals and validates', () => {
    expect(roundRate(83.4200004)).toBe(83.42);
    expect(isValidRate(83.42)).toBe(true);
    expect(isValidRate(0)).toBe(false);
    expect(isValidRate(-1)).toBe(false);
    expect(isValidRate(Number.NaN)).toBe(false);
    expect(isValidRate(83.4200004)).toBe(false);
  });
});


const usd = { amountMinor: 100000, currency: 'USD', fxRate: 83.42, fxSource: 'table' as const, inrMinor: 8342000 };

describe('moneyProblem', () => {
  it('accepts a coherent entry for every source', () => {
    expect(moneyProblem(usd)).toBeNull();
    expect(moneyProblem({ ...usd, fxSource: 'manual' })).toBeNull();
    expect(moneyProblem({ amountMinor: 500, currency: 'INR', fxRate: 1, fxSource: 'identity', inrMinor: 500 })).toBeNull();
  });
  it('INR is identity at rate 1', () => {
    const inr = { amountMinor: 500, currency: 'INR', fxRate: 1, fxSource: 'identity' as const, inrMinor: 500 };
    expect(moneyProblem({ ...inr, fxRate: 2 })?.path).toBe('fxRate');
    expect(moneyProblem({ ...inr, fxSource: 'table' })?.path).toBe('fxSource');
    expect(moneyProblem({ ...inr, inrMinor: 499 })?.path).toBe('inrMinor');
  });
  it('a foreign currency cannot claim the identity source, a zero rate, or more than 6 decimals', () => {
    expect(moneyProblem({ ...usd, fxSource: 'identity' })?.path).toBe('fxSource');
    expect(moneyProblem({ ...usd, fxRate: 0 })?.path).toBe('fxRate');
    expect(moneyProblem({ ...usd, fxRate: -1 })?.path).toBe('fxRate');
    expect(moneyProblem({ ...usd, fxRate: 83.4200001 })?.path).toBe('fxRate');
  });
  it('table and manual entries must match amount x rate exactly', () => {
    expect(moneyProblem({ ...usd, inrMinor: 8342001 })?.path).toBe('inrMinor');
    expect(moneyProblem({ ...usd, fxSource: 'manual', inrMinor: 1 })?.path).toBe('inrMinor');
  });
  it('a bank settlement may differ slightly, scaled to the amount, but not by orders of magnitude', () => {
    expect(moneyProblem({ ...usd, fxSource: 'bank', inrMinor: 8342000 + 200000 })).toBeNull(); // ~2.4% off
    expect(moneyProblem({ ...usd, fxSource: 'bank', inrMinor: 8342000 * 100 })?.path).toBe('inrMinor');
    expect(moneyProblem({ ...usd, fxSource: 'bank', inrMinor: 8342000 + 1_000_000 })?.path).toBe('inrMinor'); // ~12% off
    // a tiny amount gets a floor of INR 1, not 5% of nothing
    expect(moneyProblem({ amountMinor: 1, currency: 'USD', fxRate: 83.42, fxSource: 'bank', inrMinor: 8 + 90 })).toBeNull();
  });
  it('never throws, even for an absurd amount', () => {
    expect(() => moneyProblem({ ...usd, amountMinor: Number.MAX_SAFE_INTEGER })).not.toThrow();
    expect(moneyProblem({ ...usd, amountMinor: Number.MAX_SAFE_INTEGER })?.path).toBe('inrMinor');
  });
});

describe('buildMoney', () => {
  const fxDate = new Date('2026-10-01');
  it('computes the INR value on the server and is identity for INR', () => {
    expect(buildMoney({ amountMinor: 100000, currency: 'USD', fxRate: 83.42, fxDate })).toMatchObject({ fxSource: 'table', inrMinor: 8342000 });
    expect(buildMoney({ amountMinor: 12345, currency: 'INR', fxRate: 99, fxDate })).toMatchObject({ fxRate: 1, fxSource: 'identity', inrMinor: 12345 });
  });
  it('takes a bank-settled figure only within tolerance', () => {
    expect(buildMoney({ amountMinor: 100000, currency: 'USD', fxRate: 83.42, fxDate, fxSource: 'bank', settledInrMinor: 8300000 }).inrMinor).toBe(8300000);
    expect(() => buildMoney({ amountMinor: 100000, currency: 'USD', fxRate: 83.42, fxDate, fxSource: 'bank', settledInrMinor: 100 })).toThrow();
  });
  it('refuses a missing or malformed rate', () => {
    expect(() => buildMoney({ amountMinor: 1, currency: 'USD', fxDate })).toThrow(/rate/);
    expect(() => buildMoney({ amountMinor: 1, currency: 'USD', fxRate: 0, fxDate })).toThrow(/rate/);
  });
});
