/**
 * The plain-text half of the settings rules: no zod, no server imports, so the settings screens can
 * use the same functions the server validates with (a preview of what will be saved can never
 * disagree with what is saved).
 */

/** How big each setting may be. The model's own field sizes are the ceiling: an option has to fit the record it is stored on. */
export const SETTINGS_LIMITS = {
  orgName: { min: 2, max: 80 },
  /** Payment.mode is `text(40)`. */
  paymentModes: { items: 30, length: 40 },
  /** Expense.category is `text(60)`. */
  expenseCategories: { items: 40, length: 60 },
  /** ThirdParty.type is `text(40)`. */
  thirdPartyTypes: { items: 20, length: 40 },
  budgetRanges: { items: 20, length: 60 },
  workLogEditWindowDays: { min: 0, max: 90 },
  fxStaleDays: { min: 1, max: 60 },
} as const;

/**
 * Option values are stored as codes (`bank_transfer`), like the defaults, so a value typed as
 * "Bank transfer", "bank-transfer" and "BANK TRANSFER" is one option and filters and forms compare
 * plain strings. Screens show them through `humanize()`.
 */
export function toCode(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Free text for display: control characters and invisible direction overrides become spaces, runs of spaces collapse. */
export function cleanText(raw: string): string {
  return raw
    .replace(/[\p{Cc}\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A real IANA zone. Dashboards and periods bucket by it, so a bad value would break every one of them. */
export function isValidTimeZone(value: string): boolean {
  // Offsets ("+05:30") are accepted by newer engines but are not zones: no daylight rules, no name.
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Zone names for a datalist. `Intl.supportedValuesOf` still lists the old canonical spellings (it has
 * Asia/Calcutta, not Asia/Kolkata), so the default is added explicitly.
 */
export function timeZoneOptions(): string[] {
  const supported = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [...new Set(['Asia/Kolkata', 'UTC', ...supported])].sort();
}

