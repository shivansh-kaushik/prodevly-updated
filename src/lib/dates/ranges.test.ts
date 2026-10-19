import { describe, expect, it } from 'vitest';
import { formatDateOnly, parseDateOnly, todayDateOnly } from './date-only';
import { monthsInPeriod, resolvePeriod, startOfDayInstant } from './ranges';

const iso = (d: Date) => d.toISOString();
const at = (s: string) => new Date(s);

describe('date-only', () => {
  it('parses real calendar dates to UTC midnight and rejects the rest', () => {
    expect(iso(parseDateOnly('2026-10-12')!)).toBe('2026-10-12T00:00:00.000Z');
    for (const bad of ['2026-02-30', '2026-13-01', '12-10-2026', '2026-1-1', '', '2026-10-12T00:00:00Z']) {
      expect(parseDateOnly(bad), bad).toBeNull();
    }
    expect(parseDateOnly('2028-02-29')).not.toBeNull(); // leap day
    expect(parseDateOnly('2027-02-29')).toBeNull();
  });
  it('round-trips', () => {
    expect(formatDateOnly(parseDateOnly('2026-04-01')!)).toBe('2026-04-01');
  });
  it('today is the calendar date in the organisation zone, not in UTC', () => {
    // 20:00 UTC on 11 Oct is already 01:30 on 12 Oct in India
    expect(formatDateOnly(todayDateOnly(at('2026-10-11T20:00:00Z')))).toBe('2026-10-12');
    expect(formatDateOnly(todayDateOnly(at('2026-10-11T10:00:00Z')))).toBe('2026-10-11');
  });
});

describe('startOfDayInstant', () => {
  it('is IST midnight, which is 18:30 UTC the day before', () => {
    expect(iso(startOfDayInstant(parseDateOnly('2026-10-12')!))).toBe('2026-10-11T18:30:00.000Z');
  });
  it('handles a daylight-saving zone', () => {
    // New York is UTC-4 in October, UTC-5 in January
    expect(iso(startOfDayInstant(parseDateOnly('2026-10-12')!, 'America/New_York'))).toBe('2026-10-12T04:00:00.000Z');
    expect(iso(startOfDayInstant(parseDateOnly('2026-01-12')!, 'America/New_York'))).toBe('2026-01-12T05:00:00.000Z');
  });
});

describe('resolvePeriod', () => {
  const now = at('2026-10-12T09:00:00Z'); // 12 Oct 2026, mid FY27
  const fmt = (p: ReturnType<typeof resolvePeriod>) => [formatDateOnly(p.from), formatDateOnly(p.to)];

  it('defaults to the current financial year (April to March)', () => {
    const p = resolvePeriod({}, now);
    expect(p.key).toBe('this_fy');
    expect(fmt(p)).toEqual(['2026-04-01', '2027-03-31']);
    expect(p.fyLabel).toBe('FY27');
  });
  it('knows last financial year', () => {
    const p = resolvePeriod({ period: 'last_fy' }, now);
    expect(fmt(p)).toEqual(['2025-04-01', '2026-03-31']);
    expect(p.fyLabel).toBe('FY26');
  });
  it('rolls the financial year over at 1 April, in India', () => {
    // 31 Mar 2027 20:00 UTC is already 1 Apr 2027 in India
    expect(resolvePeriod({}, at('2027-03-31T20:00:00Z')).fyLabel).toBe('FY28');
    expect(resolvePeriod({}, at('2027-03-31T10:00:00Z')).fyLabel).toBe('FY27');
  });
  it('this and last month, across a year boundary', () => {
    expect(fmt(resolvePeriod({ period: 'this_month' }, now))).toEqual(['2026-10-01', '2026-10-31']);
    expect(fmt(resolvePeriod({ period: 'last_month' }, at('2027-01-10T10:00:00Z')))).toEqual(['2026-12-01', '2026-12-31']);
    expect(fmt(resolvePeriod({ period: 'this_month' }, at('2028-02-10T10:00:00Z')))).toEqual(['2028-02-01', '2028-02-29']);
  });
  it('quarters follow the financial year', () => {
    expect(fmt(resolvePeriod({ period: 'this_quarter' }, now))).toEqual(['2026-10-01', '2026-12-31']); // Q3 of FY27
    expect(fmt(resolvePeriod({ period: 'this_quarter' }, at('2027-02-15T10:00:00Z')))).toEqual(['2027-01-01', '2027-03-31']);
    expect(fmt(resolvePeriod({ period: 'this_quarter' }, at('2026-05-15T10:00:00Z')))).toEqual(['2026-04-01', '2026-06-30']);
  });
  it('supports a January financial-year start', () => {
    const p = resolvePeriod({}, now, { fyStartMonth: 1 });
    expect(fmt(p)).toEqual(['2026-01-01', '2026-12-31']);
    expect(p.fyLabel).toBe('FY26');
  });
  it('custom ranges need both dates, in order, and a sane length', () => {
    expect(fmt(resolvePeriod({ period: 'custom', from: '2026-06-01', to: '2026-06-30' }, now))).toEqual(['2026-06-01', '2026-06-30']);
    for (const bad of [{ from: '2026-06-30', to: '2026-06-01' }, { from: '2026-06-01' }, { from: 'x', to: 'y' }, { from: '2000-01-01', to: '2026-06-01' }]) {
      expect(resolvePeriod({ period: 'custom', ...bad }, now).key, JSON.stringify(bad)).toBe('this_fy');
    }
  });
  it('an unknown preset falls back to the default', () => {
    expect(resolvePeriod({ period: 'whenever' }, now).key).toBe('this_fy');
  });
  it('the instant range is IST midnight to IST midnight, end exclusive', () => {
    const p = resolvePeriod({ period: 'this_month' }, now);
    expect(iso(p.fromInstant)).toBe('2026-09-30T18:30:00.000Z');
    expect(iso(p.toInstant)).toBe('2026-10-31T18:30:00.000Z');
  });
  it('lists the months a period covers', () => {
    const months = monthsInPeriod(resolvePeriod({}, now)).map((m) => formatDateOnly(m).slice(0, 7));
    expect(months).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']);
  });
});
