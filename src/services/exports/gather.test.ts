import { describe, expect, it } from 'vitest';
import { EXPORT_PAGE_SIZE, gather } from './gather';

/** A list of `total` rows served in pages the way the services serve them: clamped to the last page when asked past the end. */
function serve(total: number, options: { onCall?: (page: number) => void; rows?: (n: number) => { id: string } } = {}) {
  const rows = Array.from({ length: total }, (_, i) => options.rows?.(i) ?? { id: `r${i}` });
  const calls: number[] = [];
  let inFlight = 0;
  let peak = 0;
  const fetchPage = async (page: number, pageSize: number) => {
    calls.push(page);
    options.onCall?.(page);
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 2));
    inFlight--;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const safe = Math.min(page, pages);
    return { items: rows.slice((safe - 1) * pageSize, safe * pageSize), total };
  };
  return { fetchPage, calls, peak: () => peak };
}

describe('gather', () => {
  it('reads one page for a short list and reports it complete', async () => {
    const s = serve(7);
    const out = await gather(20_000, s.fetchPage);
    expect(out.items.map((r) => r.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6']);
    expect(out).toMatchObject({ total: 7, truncated: false });
    expect(s.calls).toEqual([1]);
  });

  it('reads an empty list as one empty page', async () => {
    const s = serve(0);
    expect(await gather(20_000, s.fetchPage)).toMatchObject({ items: [], total: 0, truncated: false });
    expect(s.calls).toEqual([1]);
  });

  it('joins pages in order, each row once', async () => {
    const s = serve(EXPORT_PAGE_SIZE * 7 + 13);
    const out = await gather(20_000, s.fetchPage);
    expect(out.items).toHaveLength(EXPORT_PAGE_SIZE * 7 + 13);
    expect(out.items.map((r) => r.id)).toEqual(Array.from({ length: EXPORT_PAGE_SIZE * 7 + 13 }, (_, i) => `r${i}`));
    expect([...s.calls].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(out.truncated).toBe(false);
  });

  it('never has more than four page reads in flight, after the first', async () => {
    const s = serve(EXPORT_PAGE_SIZE * 12);
    await gather(20_000, s.fetchPage);
    expect(s.peak()).toBeLessThanOrEqual(4);
    expect(s.peak()).toBeGreaterThan(1);
  });

  it('stops at the cap, reads no more pages than it needs, and says it was cut', async () => {
    const s = serve(EXPORT_PAGE_SIZE * 50);
    const out = await gather(EXPORT_PAGE_SIZE * 2 + 5, s.fetchPage);
    expect(out.items).toHaveLength(EXPORT_PAGE_SIZE * 2 + 5);
    expect(out).toMatchObject({ total: EXPORT_PAGE_SIZE * 50, truncated: true });
    expect(Math.max(...s.calls)).toBe(3);
  });

  it('is not truncated when the total equals the cap, and is when it is one over', async () => {
    expect(await gather(150, serve(150).fetchPage)).toMatchObject({ truncated: false });
    expect(await gather(150, serve(151).fetchPage)).toMatchObject({ truncated: true });
    expect((await gather(150, serve(151).fetchPage)).items).toHaveLength(150);
  });

  it('drops a row that slid onto two pages while the list was being read', async () => {
    // Row 99 is served at the end of page 1 and again at the start of page 2.
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: `r${i}` }));
    const fetchPage = async (page: number) => ({ items: page === 2 ? [rows[99]!, ...rows.slice(100, 199)] : rows.slice((page - 1) * 100, page * 100), total: 250 });
    const out = await gather(20_000, fetchPage);
    expect(new Set(out.items.map((r) => r.id)).size).toBe(out.items.length);
    expect(out.items.filter((r) => r.id === 'r99')).toHaveLength(1);
  });

  it('survives a list that shrinks while it is read (later pages come back short or repeat the last page)', async () => {
    let calls = 0;
    const rows = Array.from({ length: 300 }, (_, i) => ({ id: `r${i}` }));
    const fetchPage = async (page: number) => {
      calls++;
      // The first call saw 300 rows; by the next call only 120 are left, so page 3 is clamped to page 2.
      return page === 1 ? { items: rows.slice(0, 100), total: 300 } : { items: rows.slice(100, 120), total: 120 };
    };
    const out = await gather(20_000, fetchPage);
    expect(calls).toBe(3);
    expect(out.items).toHaveLength(120);
    expect(out.truncated).toBe(false);
  });
});
