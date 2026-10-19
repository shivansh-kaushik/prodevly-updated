import { describe, expect, it } from 'vitest';
import { formatReplyTime } from './reply-time';

describe('formatReplyTime', () => {
  it('says so when there is nothing to measure', () => {
    expect(formatReplyTime(null)).toBe('No data');
    expect(formatReplyTime(Number.NaN)).toBe('No data');
  });
  it('reads in minutes, hours and days', () => {
    expect(formatReplyTime(0.4)).toBe('< 1 min');
    expect(formatReplyTime(45)).toBe('45m');
    expect(formatReplyTime(200)).toBe('3h 20m');
    expect(formatReplyTime(120)).toBe('2h');
    expect(formatReplyTime(47 * 60)).toBe('47h');
    expect(formatReplyTime(5 * 1440)).toBe('5 days');
  });
});
