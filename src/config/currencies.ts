/**
 * Currencies. ISO 4217 three-letter codes in uppercase.
 *
 * `digits` is the number of minor-unit decimals (INR 2, JPY 0, KWD 3). Amounts
 * are always stored as integers in the minor unit and never as floats.
 * INR is the base currency: every ledger entry also stores its INR value.
 */
export const BASE_CURRENCY = 'INR';

export const CURRENCY_DIGITS = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  AED: 2,
  AUD: 2,
  CAD: 2,
  SGD: 2,
  CHF: 2,
  JPY: 0,
  KWD: 3,
  SAR: 2,
  QAR: 2,
  NZD: 2,
} as const satisfies Record<string, number>;

export type CurrencyCode = keyof typeof CURRENCY_DIGITS;

export const CURRENCY_CODES = Object.keys(CURRENCY_DIGITS) as CurrencyCode[];

/** Enabled out of the box. Superadmins can change the set in Settings (INR can never be disabled). */
export const DEFAULT_ENABLED_CURRENCIES: readonly CurrencyCode[] = [
  'INR',
  'USD',
  'EUR',
  'GBP',
  'AED',
  'AUD',
  'CAD',
  'SGD',
];

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.hasOwn(CURRENCY_DIGITS, value);
}

export function currencyDigits(code: string): number {
  if (!isCurrencyCode(code)) throw new Error(`Unsupported currency "${code}"`);
  return CURRENCY_DIGITS[code];
}
