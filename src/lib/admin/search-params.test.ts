import { describe, expect, it } from 'vitest';
import { escapeRegex, first, objectIdParam, oneOf, pageMeta, parseListParams, withParams } from './search-params';
import { formatAgo, formatDuration, formatInr, formatInrCompact, formatPercent, humanize, initials } from './format';

const opts = { sortable: ['name', 'updatedAt'], defaultSort: 'updatedAt' } as const;

describe('parseListParams', () => {
  it('uses defaults for an empty query', () => {
    expect(parseListParams({}, opts)).toEqual({ q: undefined, page: 1, pageSize: 25, sort: 'updatedAt', dir: 'desc' });
  });
  it('ignores bad values instead of failing', () => {
    expect(parseListParams({ page: 'abc', sort: 'passwordHash', dir: 'sideways' }, opts)).toMatchObject({ page: 1, sort: 'updatedAt', dir: 'desc' });
    expect(parseListParams({ page: '-3' }, opts).page).toBe(1);
    expect(parseListParams({ page: '2.5' }, opts).page).toBe(1);
  });
  it('accepts allowed sorts, trims and caps the search text', () => {
    const p = parseListParams({ q: `  ${'x'.repeat(300)}  `, sort: 'name', dir: 'asc', page: '3' }, opts);
    expect(p).toMatchObject({ page: 3, sort: 'name', dir: 'asc' });
    expect(p.q).toHaveLength(100);
  });
  it('takes the first of a repeated param', () => {
    expect(first({ q: ['a', 'b'] }, 'q')).toBe('a');
    expect(first({ q: '   ' }, 'q')).toBeUndefined();
  });
});

describe('filters', () => {
  it('oneOf only returns allowed values', () => {
    expect(oneOf({ status: 'active' }, 'status', ['active', 'past'] as const)).toBe('active');
    expect(oneOf({ status: 'nope' }, 'status', ['active', 'past'] as const)).toBeUndefined();
  });
  it('objectIdParam lowercases real ids and drops the rest', () => {
    expect(objectIdParam({ client: '5F3A9C0B1D2E4F6A8B7C9D0E' }, 'client')).toBe('5f3a9c0b1d2e4f6a8b7c9d0e');
    expect(objectIdParam({ client: 'x' }, 'client')).toBeUndefined();
  });
});

describe('withParams', () => {
  it('keeps params, applies overrides, removes empties and resets the page', () => {
    expect(withParams('/admin/clients', { status: 'active', page: '3', q: 'acme' }, { status: 'past' })).toBe('/admin/clients?status=past&q=acme');
    expect(withParams('/admin/clients', { status: 'active' }, { status: undefined })).toBe('/admin/clients');
    expect(withParams('/admin/clients', { status: 'active', page: '3' }, { page: 4 })).toBe('/admin/clients?status=active&page=4');
  });
});

describe('pageMeta', () => {
  it('computes ranges and clamps the page', () => {
    expect(pageMeta(1, 25, 60)).toMatchObject({ pages: 3, from: 1, to: 25 });
    expect(pageMeta(3, 25, 60)).toMatchObject({ from: 51, to: 60 });
    expect(pageMeta(99, 25, 60).page).toBe(3);
    expect(pageMeta(1, 25, 0)).toMatchObject({ pages: 1, from: 0, to: 0 });
  });
  it('escapes regex characters in search text', () => {
    expect(new RegExp(escapeRegex('a.b*c(d)')).test('a.b*c(d)')).toBe(true);
    expect(new RegExp(escapeRegex('a.b')).test('axb')).toBe(false);
  });
});

describe('format', () => {
  it('humanises status words and camelCase', () => {
    expect(humanize('in_progress')).toBe('In progress');
    expect(humanize('proposalSent')).toBe('Proposal sent');
  });
  it('groups rupees the Indian way', () => {
    expect(formatInr(123456700)).toContain('12,34,567.00');
    expect(formatInr(0)).toContain('0.00');
  });
  it('compacts to K, L and Cr', () => {
    expect(formatInrCompact(0)).toBe('₹0');
    expect(formatInrCompact(150_000)).toBe('₹1.5K');
    expect(formatInrCompact(12_345_600)).toBe('₹1.2L');
    expect(formatInrCompact(450_000_000)).toBe('₹45L');
    expect(formatInrCompact(4_500_000_000)).toBe('₹4.5Cr');
    expect(formatInrCompact(-12_345_600)).toBe('-₹1.2L');
  });
  it('durations and percentages never divide by zero', () => {
    expect(formatDuration(150)).toBe('2h 30m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(120)).toBe('2h');
    expect(formatPercent(1, 0)).toBeNull();
    expect(formatPercent(1, 4)).toBe('25%');
  });
  it('relative times', () => {
    const now = new Date('2026-10-12T10:00:00Z');
    expect(formatAgo('2026-10-12T09:59:30Z', now)).toBe('just now');
    expect(formatAgo('2026-10-12T09:50:00Z', now)).toBe('10 min ago');
    expect(formatAgo('2026-10-12T07:00:00Z', now)).toBe('3 h ago');
    expect(formatAgo('2026-10-09T10:00:00Z', now)).toBe('3 d ago');
  });
  it('initials', () => {
    expect(initials('Aman Gupta')).toBe('AG');
    expect(initials('Cher')).toBe('C');
  });
});
