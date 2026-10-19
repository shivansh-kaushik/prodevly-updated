import { z } from 'zod';

/**
 * URL state for lists and dashboards. Filters, sort and page live in the URL, so a view can be
 * bookmarked, shared and survives a refresh, and a Server Component can read them directly.
 */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/** First value of a param, trimmed, or undefined. */
export function first(sp: RawSearchParams, key: string): string | undefined {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  const t = s?.trim();
  return t ? t : undefined;
}

export interface ListParams {
  q?: string;
  page: number;
  pageSize: number;
  sort: string;
  dir: 'asc' | 'desc';
}

export interface ListParamOptions {
  /** Sort keys the screen allows. Anything else falls back to `defaultSort`. */
  sortable: readonly string[];
  defaultSort: string;
  defaultDir?: 'asc' | 'desc';
  pageSize?: number;
}

const MAX_PAGE_SIZE = 100;

/** Parses q, page, sort and dir defensively: a bad value is ignored, never an error page. */
export function parseListParams(sp: RawSearchParams, options: ListParamOptions): ListParams {
  const page = z.coerce.number().int().min(1).max(10_000).catch(1).parse(first(sp, 'page') ?? 1);
  const sort = first(sp, 'sort');
  const dir = first(sp, 'dir');
  const q = first(sp, 'q');
  return {
    q: q ? q.slice(0, 100) : undefined,
    page,
    pageSize: Math.min(options.pageSize ?? 25, MAX_PAGE_SIZE),
    sort: sort && options.sortable.includes(sort) ? sort : options.defaultSort,
    dir: dir === 'asc' || dir === 'desc' ? dir : (options.defaultDir ?? 'desc'),
  };
}

/** One value from a fixed set (a status filter), or undefined when absent or not in the set. */
export function oneOf<T extends string>(sp: RawSearchParams, key: string, allowed: readonly T[]): T | undefined {
  const v = first(sp, key);
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** A 24-hex id param, lowercased, or undefined. */
export function objectIdParam(sp: RawSearchParams, key: string): string | undefined {
  const v = first(sp, key);
  return v && /^[a-f\d]{24}$/i.test(v) ? v.toLowerCase() : undefined;
}

/** Builds an href that keeps the current params and applies overrides ("" or undefined removes one). Resets `page` unless set. */
export function withParams(
  path: string,
  current: RawSearchParams,
  overrides: Record<string, string | number | undefined | null>,
): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s) next.set(k, s);
  }
  if (!('page' in overrides)) next.delete('page');
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === null || v === '') next.delete(k);
    else next.set(k, String(v));
  }
  const qs = next.toString();
  return qs ? `${path}?${qs}` : path;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  from: number;
  to: number;
}

export function pageMeta(page: number, pageSize: number, total: number): PageMeta {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safe = Math.min(page, pages);
  return {
    page: safe,
    pageSize,
    total,
    pages,
    from: total === 0 ? 0 : (safe - 1) * pageSize + 1,
    to: Math.min(total, safe * pageSize),
  };
}

/** Escapes a user string for use inside a RegExp (name search). */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
