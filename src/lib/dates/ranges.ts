import { DEFAULT_TIMEZONE } from './fiscal-year';
import { formatDateOnly, parseDateOnly } from './date-only';

/**
 * Period presets for every dashboard and list. The default is the current FINANCIAL year
 * (1 April to 31 March). Two kinds of range come out, because two kinds of field exist:
 *
 * - `from` / `to` are DATE-ONLY (UTC midnight, both inclusive) for received-on, paid-on, spent-on ...
 * - `fromInstant` / `toInstant` are real instants (start inclusive, end EXCLUSIVE) for timestamps
 *   such as createdAt, bucketed in the organisation's time zone.
 */
export const PERIOD_KEYS = ['this_month', 'last_month', 'this_quarter', 'this_fy', 'last_fy', 'custom'] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  this_fy: 'This financial year',
  last_fy: 'Last financial year',
  custom: 'Custom range',
};

export interface Period {
  key: PeriodKey;
  label: string;
  from: Date;
  to: Date;
  fromInstant: Date;
  toInstant: Date;
  /** "FY27" for a financial-year period, else null. */
  fyLabel: string | null;
}

export interface PeriodOptions {
  fyStartMonth?: number;
  timeZone?: string;
}

interface Ymd {
  y: number;
  m: number;
  d: number;
}

function ymdIn(date: Date, timeZone: string): Ymd {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return { y, m, d };
}

/** Minutes the zone is ahead of UTC at an instant. */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** The instant at which a calendar date BEGINS in a time zone. */
export function startOfDayInstant(date: Date, timeZone = DEFAULT_TIMEZONE): Date {
  const guess = date.getTime();
  const first = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  const second = guess - offsetMinutes(new Date(first), timeZone) * 60_000;
  return new Date(second);
}

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0));

function fyStartYear({ y, m }: Ymd, startMonth: number) {
  return m >= startMonth ? y : y - 1;
}

function fyLabelFor(startYear: number, startMonth: number): string {
  const end = startMonth === 1 ? startYear : startYear + 1;
  return `FY${String(end % 100).padStart(2, '0')}`;
}

function build(key: PeriodKey, from: Date, to: Date, timeZone: string, fyLabel: string | null, label = PERIOD_LABELS[key]): Period {
  return {
    key,
    label,
    from,
    to,
    fromInstant: startOfDayInstant(from, timeZone),
    toInstant: startOfDayInstant(new Date(to.getTime() + 86_400_000), timeZone),
    fyLabel,
  };
}

/** Month offset helper: (y, m) plus n months, as a [year, month] pair. */
function plusMonths(y: number, m: number, n: number): [number, number] {
  const idx = y * 12 + (m - 1) + n;
  return [Math.floor(idx / 12), (idx % 12) + 1];
}

export interface PeriodInput {
  period?: string | null;
  from?: string | null;
  to?: string | null;
}

/** Resolves URL params (`period`, `from`, `to`) to a Period. An unknown or invalid value falls back to the default. */
export function resolvePeriod(input: PeriodInput = {}, now = new Date(), options: PeriodOptions = {}): Period {
  const timeZone = options.timeZone ?? DEFAULT_TIMEZONE;
  const startMonth = options.fyStartMonth ?? 4;
  const today = ymdIn(now, timeZone);
  const key = (PERIOD_KEYS as readonly string[]).includes(input.period ?? '') ? (input.period as PeriodKey) : 'this_fy';

  if (key === 'custom') {
    const from = input.from ? parseDateOnly(input.from) : null;
    const to = input.to ? parseDateOnly(input.to) : null;
    if (from && to && from <= to && to.getTime() - from.getTime() <= 3660 * 86_400_000) {
      return build('custom', from, to, timeZone, null, `${formatDateOnly(from)} to ${formatDateOnly(to)}`);
    }
    // an unusable custom range falls through to the default
  }

  if (key === 'this_month' || key === 'last_month') {
    const [y, m] = key === 'this_month' ? [today.y, today.m] : plusMonths(today.y, today.m, -1);
    return build(key, utc(y, m, 1), lastDayOfMonth(y, m), timeZone, null);
  }

  if (key === 'this_quarter') {
    const sy = fyStartYear(today, startMonth);
    const monthsIntoFy = (today.y - sy) * 12 + (today.m - startMonth);
    const q = Math.floor(monthsIntoFy / 3);
    const [y, m] = plusMonths(sy, startMonth, q * 3);
    const [ey, em] = plusMonths(y, m, 2);
    return build(key, utc(y, m, 1), lastDayOfMonth(ey, em), timeZone, null);
  }

  const sy = fyStartYear(today, startMonth) - (key === 'last_fy' ? 1 : 0);
  const [ey, em] = plusMonths(sy, startMonth, 11);
  const effectiveKey: PeriodKey = key === 'last_fy' ? 'last_fy' : 'this_fy';
  return build(effectiveKey, utc(sy, startMonth, 1), lastDayOfMonth(ey, em), timeZone, fyLabelFor(sy, startMonth));
}

/** Calendar months (UTC month starts) covered by a period, for per-month charts. */
export function monthsInPeriod(period: Pick<Period, 'from' | 'to'>): Date[] {
  const out: Date[] = [];
  let y = period.from.getUTCFullYear();
  let m = period.from.getUTCMonth() + 1;
  const end = period.to.getUTCFullYear() * 12 + period.to.getUTCMonth();
  while (y * 12 + (m - 1) <= end) {
    out.push(utc(y, m, 1));
    [y, m] = plusMonths(y, m, 1);
  }
  return out;
}
