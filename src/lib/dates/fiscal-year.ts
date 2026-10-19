/**
 * Financial years. The default runs 1 April to 31 March (the Indian financial
 * year) and is labelled by the year it ENDS in: April 2026 to March 2027 is FY27.
 * Money references restart each April (PAY-FY27-0001).
 */
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

interface Parts {
  year: number;
  month: number;
}

/** Calendar year and month of an instant in a time zone. */
function partsIn(date: Date, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' });
  const parts = fmt.formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  return { year, month };
}

/** The calendar year in which the financial year containing `date` STARTS. */
export function fiscalStartYear(date: Date, startMonth = 4, timeZone = DEFAULT_TIMEZONE): number {
  const { year, month } = partsIn(date, timeZone);
  return month >= startMonth ? year : year - 1;
}

/** "FY27" for any instant between April 2026 and March 2027. */
export function fiscalYearLabel(date: Date, startMonth = 4, timeZone = DEFAULT_TIMEZONE): string {
  const start = fiscalStartYear(date, startMonth, timeZone);
  // A year starting in January ends in the same calendar year.
  const endYear = startMonth === 1 ? start : start + 1;
  return `FY${String(endYear % 100).padStart(2, '0')}`;
}
