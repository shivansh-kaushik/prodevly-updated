/**
 * Walks a list function page by page and collects the rows, so an export applies the SAME filters, sorting and
 * capability scoping as the screen without a second copy of that logic. The services clamp a page to 100 rows.
 */
export const EXPORT_PAGE_SIZE = 100;
/** Pages read at once after the first. Enough to keep a 20,000-row export to a few seconds without flooding the connection pool. */
const CONCURRENCY = 4;

export interface GatherPage<T> {
  items: T[];
  /** Rows that match the filters, across every page. */
  total: number;
}

export interface Gathered<T> {
  items: T[];
  total: number;
  truncated: boolean;
}

export async function gather<T extends { id: string }>(
  cap: number,
  fetchPage: (page: number, pageSize: number) => Promise<GatherPage<T>>,
): Promise<Gathered<T>> {
  // The first page says how many there are; the rest are read a few at a time, and joined in page order.
  const first = await fetchPage(1, EXPORT_PAGE_SIZE);
  const pages = Math.ceil(Math.min(first.total, cap) / EXPORT_PAGE_SIZE);
  const results = [first];
  for (let start = 2; start <= pages; start += CONCURRENCY) {
    const batch: Array<Promise<GatherPage<T>>> = [];
    for (let page = start; page < start + CONCURRENCY && page <= pages; page++) batch.push(fetchPage(page, EXPORT_PAGE_SIZE));
    results.push(...(await Promise.all(batch)));
  }

  const items: T[] = [];
  // A row written while we page can slide onto two pages; the first copy wins.
  const seen = new Set<string>();
  for (const result of results) {
    for (const item of result.items) {
      if (items.length >= cap) break;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  return { items, total: Math.max(first.total, items.length), truncated: first.total > cap };
}
