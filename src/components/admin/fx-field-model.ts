import { BASE_CURRENCY, currencyDigits } from '@/config/currencies';
import { formatDate } from '@/lib/admin/format';
import { isValidRate, toInrMinor } from '@/lib/money/fx';
import { minorToDecimal, parseMinor } from '@/lib/money/minor';

/**
 * The pure half of `<FxField>`: what the person typed, what it means, and the sentence shown
 * under the amount. No React in here, so it is unit-tested directly, and the SERVER reuses
 * `deriveRate` so the form's preview and the stored rate can never be computed two ways.
 *
 * Three ways to settle a foreign-currency amount (docs/plan section 4):
 *   table  use the rate on file for the entry's date (the default)
 *   manual type the exact rate the bank applied
 *   bank   type the INR that actually arrived; the rate is derived from it
 */
export type FxChoice = 'table' | 'manual' | 'bank';

/** What is in the field. The two inputs are TEXT while typing; they become numbers only in `fxValueToPayload`. */
export interface FxValue {
  choice: FxChoice;
  /** INR per 1 unit, as typed ("83.42"). */
  manualRate: string;
  /** INR that arrived, as typed ("83,420.00"). */
  settledInr: string;
}

export const TABLE_FX: Readonly<FxValue> = Object.freeze({ choice: 'table', manualRate: '', settledInr: '' });

/** The answer of GET /api/admin/fx-rates/lookup. When no rate is on file, `rate`, `rateOn` and `source` are null and `stale` is true. */
export interface FxLookup {
  currency: string;
  rate: number | null;
  /** "YYYY-MM-DD", the day the rate on file is for. */
  rateOn: string | null;
  source: 'manual' | 'ecb' | 'identity' | null;
  /** True when there is no rate, or the latest one is older than `staleDays` before the entry's date. */
  stale: boolean;
  /** The organisation's allowance (Settings), so the warning can say how old is too old. */
  staleDays: number;
  /** The INR value of the amount asked about, when an amount was sent and a usable rate exists. */
  inrMinor?: number;
}

/** True when the table rate can be used as it is. */
export const tableUsable = (lookup: FxLookup | null): lookup is FxLookup & { rate: number; rateOn: string } =>
  Boolean(lookup && lookup.rate !== null && lookup.rateOn !== null && !lookup.stale);

/**
 * "83.42" gives 83.42. Anything that is not a plain positive decimal with at most six places gives
 * null: no thousands commas (a rate is not grouped), no decimal comma (it would silently read 83,42 as 8342).
 */
export function parseRateText(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,9}(?:\.\d{1,6})?$/.test(t)) return null;
  const n = Number(t);
  return isValidRate(n) ? n : null;
}

/** The INR figure typed for a bank-settled entry, in paise. Null when it is not a real, positive amount. */
export function parseSettledInr(text: string): number | null {
  const minor = parseMinor(text, BASE_CURRENCY);
  return minor !== null && minor > 0 ? minor : null;
}

/** The message to show under the field, or null when the value is complete. A table choice is always complete. */
export function fxValueError(value: FxValue): string | null {
  if (value.choice === 'manual' && parseRateText(value.manualRate) === null) {
    return 'Enter the exact rate, for example 83.42 (up to 6 decimals)';
  }
  if (value.choice === 'bank' && parseSettledInr(value.settledInr) === null) {
    return 'Enter the INR amount that arrived, for example 83,420.00';
  }
  return null;
}

/**
 * The fields to send with a money entry's API body. `{}` means "use the table rate".
 *
 * An incomplete manual or bank value THROWS instead of returning `{}`: a person who chose to type
 * the bank's rate must never have it silently turn into a table lookup. Forms call `fxValueError`
 * first and show its message; the throw is the backstop.
 */
export function fxValueToPayload(value: FxValue): { manualRate?: number; settledInrMinor?: number } {
  if (value.choice === 'table') return {};
  const problem = fxValueError(value);
  if (problem) throw new RangeError(problem);
  if (value.choice === 'manual') return { manualRate: parseRateText(value.manualRate) as number };
  return { settledInrMinor: parseSettledInr(value.settledInr) as number };
}

/**
 * The rate implied by what the bank delivered, to 6 decimals (INR per 1 unit):
 *
 *   rate = settledInrMinor / (amountMinor x 10^(2 - digits))
 *
 * the inverse of `toInrMinor`, in exact integer arithmetic and rounded half up. Null when it cannot
 * be a valid rate (a zero amount or INR value, or a rate that would round to nothing).
 */
export function deriveRate(amountMinor: number, currency: string, settledInrMinor: number): number | null {
  if (currency === BASE_CURRENCY) return 1;
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  if (!Number.isSafeInteger(settledInrMinor) || settledInrMinor <= 0) return null;
  const digits = currencyDigits(currency);
  const numerator = BigInt(settledInrMinor) * BigInt(1_000_000) * BigInt(10) ** BigInt(Math.max(0, digits - 2));
  const denominator = BigInt(amountMinor) * BigInt(10) ** BigInt(Math.max(0, 2 - digits));
  const micro = (numerator * BigInt(2) + denominator) / (denominator * BigInt(2));
  if (micro < BigInt(1) || micro >= BigInt(1_000_000_000) * BigInt(1_000_000)) return null;
  const rate = Number(micro) / 1_000_000;
  return isValidRate(rate) ? rate : null;
}

/** The INR value of an amount at a rate, or null when the sum cannot be done (too large). */
export function previewInr(amountMinor: number, currency: string, rate: number): number | null {
  try {
    return toInrMinor(amountMinor, currency, rate);
  } catch {
    return null;
  }
}

/** "USD 1,000.00": the code first, then the grouped number (Indian grouping for INR). */
export function formatCoded(amountMinor: number, currency: string): string {
  const digits = currencyDigits(currency);
  const number = new Intl.NumberFormat(currency === BASE_CURRENCY ? 'en-IN' : 'en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(minorToDecimal(amountMinor, currency)));
  return `${currency} ${number}`;
}

export const formatRate = (rate: number) => rate.toLocaleString('en-IN', { maximumFractionDigits: 6 });

/**
 * The quiet line under the amount: "USD 1,000.00 = INR 83,420.00 at 83.42 (table, 12 Oct 2026)".
 * Without an amount it states the rate alone: "1 USD = INR 83.42 (table, 12 Oct 2026)".
 */
export function fxSummary(input: { currency: string; amountMinor: number | null; rate: number; inrMinor: number | null; basis: string }): string {
  const rate = formatRate(input.rate);
  if (input.amountMinor && input.amountMinor > 0 && input.inrMinor !== null) {
    return `${formatCoded(input.amountMinor, input.currency)} = ${formatCoded(input.inrMinor, BASE_CURRENCY)} at ${rate} (${input.basis})`;
  }
  return `1 ${input.currency} = INR ${rate} (${input.basis})`;
}

/** "table, 12 Oct 2026": where a table rate comes from, so the person can judge it. */
export const tableBasis = (rateOn: string) => `table, ${formatDate(rateOn)}`;
