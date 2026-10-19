import { BASE_CURRENCY, currencyDigits, isCurrencyCode } from '@/config/currencies';
import type { FX_SOURCES } from '@/config/statuses';

/** Rates carry at most 6 decimal places. */
const RATE_SCALE = 1_000_000;

/** Rounds a rate to 6 decimals. */
export function roundRate(rate: number): number {
  return Math.round(rate * RATE_SCALE) / RATE_SCALE;
}

export function isValidRate(rate: number): boolean {
  return Number.isFinite(rate) && rate > 0 && rate < 1e9 && roundRate(rate) === rate;
}

/**
 * The INR value of an amount, in paise, computed exactly with BigInt:
 *
 *   inrMinor = round(amountMinor x rate x 10^(2 - digits(currency)))
 *
 * USD 1,000.00 (100000 cents) at 83.42 is 8,342,000 paise = INR 83,420.00.
 * Rounds half up. Always computed on the SERVER; the client never sends it.
 */
export function toInrMinor(amountMinor: number, currency: string, rate: number): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error('Amount must be a whole number');
  if (currency === BASE_CURRENCY) return amountMinor;
  const digits = currencyDigits(currency);
  const rateMicro = BigInt(Math.round(rate * RATE_SCALE));
  if (rateMicro <= BigInt(0)) throw new Error('The rate must be above zero');

  const up = BigInt(10) ** BigInt(Math.max(0, 2 - digits));
  const down = BigInt(10) ** BigInt(Math.max(0, digits - 2));
  const numerator = BigInt(amountMinor) * rateMicro * up;
  const denominator = BigInt(RATE_SCALE) * down;
  const result = (numerator * BigInt(2) + denominator) / (denominator * BigInt(2)); // round half up
  const value = Number(result);
  if (!Number.isSafeInteger(value)) throw new Error('Amount is too large');
  return value;
}

export type FxSource = (typeof FX_SOURCES)[number];

export interface MoneyFields {
  amountMinor: number;
  currency: string;
  fxRate: number;
  fxSource: FxSource;
  inrMinor: number;
}

/** A bank settles at its own rate, so its INR figure may differ from amount x table rate by up to 5% (never less than INR 1). */
export function bankToleranceMinor(expectedInrMinor: number): number {
  return Math.max(100, Math.ceil(expectedInrMinor * 0.05));
}

/**
 * Checks that the pieces of a ledger entry agree with each other. Returns the first
 * problem as `{ path, message }`, or null when coherent. Pure, never throws: the
 * schema validators call it, and so can Phase 3 services before they write.
 *
 * - INR is rate 1, source `identity`, INR value equal to the amount.
 * - Any other currency has a rate of at most 6 decimals, a source other than `identity`,
 *   and an INR value that is exactly `toInrMinor(amount, currency, rate)` (`table`,
 *   `manual`) or within a bank tolerance of it (`bank`, the amount the bank settled).
 */
export function moneyProblem(m: MoneyFields): { path: 'fxRate' | 'fxSource' | 'inrMinor'; message: string } | null {
  if (!isCurrencyCode(m.currency)) return null; // the currency enum reports this
  if (m.currency === BASE_CURRENCY) {
    if (m.fxRate !== 1) return { path: 'fxRate', message: 'INR entries use a rate of exactly 1' };
    if (m.fxSource !== 'identity') return { path: 'fxSource', message: 'INR entries use the identity rate source' };
    if (m.inrMinor !== m.amountMinor) return { path: 'inrMinor', message: 'An INR entry must equal its own amount' };
    return null;
  }
  if (!isValidRate(m.fxRate)) {
    return { path: 'fxRate', message: 'The rate must be above zero with at most 6 decimals' };
  }
  if (m.fxSource === 'identity') return { path: 'fxSource', message: 'Only INR entries use the identity rate source' };
  let expected: number;
  try {
    expected = toInrMinor(m.amountMinor, m.currency, m.fxRate);
  } catch {
    return { path: 'inrMinor', message: 'The INR value cannot be computed from this amount and rate' };
  }
  const off = Math.abs(m.inrMinor - expected);
  const allowed = m.fxSource === 'bank' ? bankToleranceMinor(expected) : 0;
  if (off > allowed) return { path: 'inrMinor', message: 'The INR value does not match the amount at the stated rate' };
  return null;
}

export interface BuildMoneyInput {
  amountMinor: number;
  currency: string;
  /** INR per 1 unit. Ignored for INR. */
  fxRate?: number;
  fxDate: Date;
  fxSource?: Exclude<FxSource, 'identity'>;
  /** Only for `bank`: the INR the bank actually settled. Otherwise it is always computed. */
  settledInrMinor?: number;
}

/**
 * The one way services build the `Money` subdocument. The client never supplies the INR
 * value (except a bank-settled figure, bounded by `moneyProblem`): it is computed here.
 */
export function buildMoney(input: BuildMoneyInput) {
  const { amountMinor, currency, fxDate } = input;
  if (currency === BASE_CURRENCY) {
    return { amountMinor, currency, fxRate: 1, fxDate, fxSource: 'identity' as const, inrMinor: amountMinor };
  }
  const fxSource = input.fxSource ?? 'table';
  const fxRate = input.fxRate;
  if (fxRate === undefined || !isValidRate(fxRate)) throw new Error('A valid exchange rate is required');
  const inrMinor =
    fxSource === 'bank' && input.settledInrMinor !== undefined
      ? input.settledInrMinor
      : toInrMinor(amountMinor, currency, fxRate);
  const money = { amountMinor, currency, fxRate, fxDate, fxSource, inrMinor };
  const problem = moneyProblem(money);
  if (problem) throw new Error(problem.message);
  return money;
}
