import { formatMinor } from '@/lib/money/minor';
import { DEFAULT_TIMEZONE } from '@/lib/dates/fiscal-year';

/** Display formatting for the admin panel. Pure and safe on both server and client. */

/** Words that are not plain English, in the spelling people expect to read (keys are lower case). */
const KNOWN_WORDS: ReadonlyMap<string, string> = new Map([
  ['upi', 'UPI'],
  ['tds', 'TDS'],
  ['gst', 'GST'],
  ['gstin', 'GSTIN'],
  ['fx', 'FX'],
  ['inr', 'INR'],
  ['ecb', 'ECB'],
  ['paypal', 'PayPal'],
  ['wise', 'Wise'],
  ['payoneer', 'Payoneer'],
]);

/**
 * "in_progress" to "In progress". Known acronyms and brands keep their own spelling ("upi" is "UPI", "paypal" is "PayPal").
 * Pass `capitalise = false` for running text ("marked as paid"), where only those words keep their capitals.
 */
export function humanize(value: string, capitalise = true): string {
  const spaced = value.replaceAll('_', ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  const text = spaced.replace(/[\p{L}\p{N}]+/gu, (word) => KNOWN_WORDS.get(word) ?? word);
  return capitalise ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

const toDate = (v: string | Date) => (v instanceof Date ? v : new Date(v));

/** A date-only value (stored as UTC midnight): shown as that calendar date, never shifted by a zone. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(toDate(value));
}

/** A real instant, shown in the organisation's zone: "12 Oct 2026, 3:45 pm". */
export function formatDateTime(value: string | Date | null | undefined, timeZone = DEFAULT_TIMEZONE): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(toDate(value));
}

/** An instant as a short relative phrase for activity feeds: "just now", "5 min ago", "3 days ago", else the date. */
export function formatAgo(value: string | Date, now = new Date()): string {
  const secs = Math.round((now.getTime() - toDate(value).getTime()) / 1000);
  if (secs < 45) return 'just now';
  if (secs < 3600) return `${Math.max(1, Math.round(secs / 60))} min ago`;
  if (secs < 86_400) return `${Math.round(secs / 3600)} h ago`;
  if (secs < 7 * 86_400) return `${Math.round(secs / 86_400)} d ago`;
  return formatDateTime(value).split(',')[0] ?? '';
}

/** INR with Indian digit grouping: 1234567 paise-minor 123456700 -> "₹12,34,567.00". */
export function formatInr(inrMinor: number): string {
  return formatMinor(inrMinor, 'INR');
}

/** A compact INR figure for chart axes and tight tiles: "₹12.3L", "₹4.5Cr". */
export function formatInrCompact(inrMinor: number): string {
  const rupees = inrMinor / 100;
  const abs = Math.abs(rupees);
  const sign = rupees < 0 ? '-' : '';
  const trim = (n: number) => String(Number(n.toFixed(1)));
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)}Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)}L`;
  if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3)}K`;
  return `${sign}₹${trim(abs)}`;
}

/** Minutes as "2h 30m". */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest}m`;
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`;
}

/** Hours with one decimal: 90 minutes -> "1.5 h". */
export function formatHours(minutes: number): string {
  return `${(Math.round((minutes / 60) * 10) / 10).toLocaleString('en-IN')} h`;
}

/** A ratio as a percent, only when the denominator is above zero (never "NaN%" or "Infinity%"). */
export function formatPercent(numerator: number, denominator: number, digits = 0): string | null {
  if (!(denominator > 0)) return null;
  return `${((numerator / denominator) * 100).toFixed(digits)}%`;
}

/** A plain count with Indian grouping. */
export function formatCount(n: number): string {
  return n.toLocaleString('en-IN');
}

/** Initials for an avatar chip. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase();
}
