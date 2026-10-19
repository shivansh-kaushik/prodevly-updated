import { describe, expect, it } from 'vitest';
import { fiscalStartYear, fiscalYearLabel } from './fiscal-year';

describe('fiscal year (1 April to 31 March, labelled by the year it ends)', () => {
  it('labels April 2026 to March 2027 as FY27', () => {
    expect(fiscalYearLabel(new Date('2026-04-01T00:00:00+05:30'))).toBe('FY27');
    expect(fiscalYearLabel(new Date('2026-10-12T12:00:00Z'))).toBe('FY27');
    expect(fiscalYearLabel(new Date('2027-03-31T23:59:00+05:30'))).toBe('FY27');
    expect(fiscalYearLabel(new Date('2027-04-01T00:00:00+05:30'))).toBe('FY28');
  });
  it('uses the business time zone, not UTC, at the boundary', () => {
    // 31 March 2027 20:00 UTC is already 1 April 01:30 in India
    expect(fiscalYearLabel(new Date('2027-03-31T20:00:00Z'))).toBe('FY28');
    expect(fiscalYearLabel(new Date('2027-03-31T20:00:00Z'), 4, 'UTC')).toBe('FY27');
  });
  it('supports a January start', () => {
    expect(fiscalYearLabel(new Date('2026-06-15T00:00:00Z'), 1, 'UTC')).toBe('FY26');
  });
  it('gives the start year', () => {
    expect(fiscalStartYear(new Date('2027-02-01T00:00:00Z'))).toBe(2026);
  });
});
