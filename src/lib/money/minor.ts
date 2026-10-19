import { currencyDigits } from '@/config/currencies';

/**
 * Amounts are integers in a currency's minor unit (paise, cents). A user types
 * "1,250.50" and the form sends 125050. Nothing here ever uses a float for money.
 */

const GROUPED_OR_PLAIN = /^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3})(?:\.\d+)?$/;

/** Parses a user-typed amount into minor units. Returns null when it is not a valid amount. */
export function parseMinor(input: string, currency: string): number | null {
  const digits = currencyDigits(currency);
  const trimmed = input.trim();
  // Commas are only thousands separators, and only in a place a person would put them:
  // 1,250.50 and 12,34,567 (Indian grouping) are amounts; "12,50" (a decimal comma) is
  // NOT, because reading it as 1250 would silently turn INR 12.50 into INR 1,250.
  if (!GROUPED_OR_PLAIN.test(trimmed)) return null;
  const cleaned = trimmed.replace(/,/g, '');
  const match = /^(\d{1,15})(?:\.(\d+))?$/.exec(cleaned);
  if (!match) return null;
  const whole = match[1] ?? '';
  const frac = match[2] ?? '';
  if (frac.length > digits) return null; // 12.345 USD is not a real amount
  const minor = Number(whole + frac.padEnd(digits, '0'));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Minor units to a plain decimal string ("1250.50"), exact, no locale. */
export function minorToDecimal(amountMinor: number, currency: string): string {
  const digits = currencyDigits(currency);
  const negative = amountMinor < 0;
  const abs = String(Math.abs(Math.trunc(amountMinor))).padStart(digits + 1, '0');
  const whole = abs.slice(0, abs.length - digits);
  const frac = digits > 0 ? abs.slice(abs.length - digits) : '';
  return `${negative ? '-' : ''}${whole}${digits > 0 ? `.${frac}` : ''}`;
}

/** Formats an amount for display. INR uses Indian digit grouping (12,34,567.00). */
export function formatMinor(amountMinor: number, currency: string, locale = 'en-IN'): string {
  const digits = currencyDigits(currency);
  const major = Number(minorToDecimal(amountMinor, currency));
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(major);
}
