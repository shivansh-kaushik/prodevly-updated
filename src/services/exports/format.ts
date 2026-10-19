import { humanize } from '@/lib/admin/format';
import { csvDecimal, type CsvCell } from '@/lib/csv';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import type { Period } from '@/lib/dates/ranges';
import { minorToDecimal } from '@/lib/money/minor';

/**
 * Cell helpers shared by every section. Money is exact decimal text built from integer minor units
 * (never a float), calendar dates are "YYYY-MM-DD", and anything that is not a trusted number is text.
 */

export const yesNo = (value: boolean): string => (value ? 'Yes' : 'No');

/** A stored code ("bank_transfer") as words ("Bank transfer"). */
export const words = (value: string | null | undefined): string | null => (value ? humanize(value) : null);

/** An amount in its own currency: "1250.50". Blank when there is none. */
export function amount(minor: number | null | undefined, currency: string): CsvCell {
  if (minor === null || minor === undefined || !Number.isSafeInteger(minor)) return null;
  return csvDecimal(minorToDecimal(minor, currency));
}

/** The INR column: integer paise from the record's own `inrMinor`, never recomputed here. */
export const inr = (inrMinor: number | null | undefined): CsvCell => amount(inrMinor, 'INR');

/** Minutes as hours with two decimals ("1.50"), which is what a timesheet reader expects. */
export function hours(minutes: number | null | undefined): CsvCell {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return null;
  return csvDecimal((minutes / 60).toFixed(2));
}

/** Several values in one cell. */
export const list = (values: readonly string[]): string | null => (values.length > 0 ? values.join('; ') : null);

/** An instant as the calendar date it falls on in the organisation's time zone. */
export function dayIn(iso: string | null | undefined, timeZone: string): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : formatDateOnly(todayDateOnly(at, timeZone));
}

/** An instant as "HH:mm" in the organisation's time zone. */
export function timeIn(iso: string | null | undefined, timeZone: string): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}

const regions = new Intl.DisplayNames(['en'], { type: 'region' });

/** "IN" as "India"; a code Intl does not know is written as it was typed. */
export function regionName(code: string | null | undefined): string | null {
  if (!code) return null;
  try {
    return regions.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** "key=value" lines for the filters that were actually set, in the order given. */
export function filterLines(pairs: ReadonlyArray<readonly [string, string | number | boolean | null | undefined]>): string[] {
  const out: string[] = [];
  for (const [key, value] of pairs) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    out.push(`${key}=${value === true ? 'yes' : value}`);
  }
  return out;
}

/** The period a list was showing, with its exact dates (a custom range's label already is its dates). */
export function describePeriod(period: Period): string {
  return period.key === 'custom' ? `period=${period.label}` : `period=${period.label} (${formatDateOnly(period.from)} to ${formatDateOnly(period.to)})`;
}
