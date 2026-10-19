import type { RateLimitRule } from '@/config/rate-limits';

/** The most rows one export carries. A bigger result is cut at this many and the response says so. */
export const EXPORT_ROW_CAP = 20_000;

/**
 * Exports read a lot of rows, so they get their own limit (the shared write limit does not cover a GET).
 * It fails closed like every limit on money: when the limiter cannot count, nothing is exported.
 */
export const EXPORT_RATE_LIMIT = { limit: 15, windowSeconds: 60, failClosed: true } as const satisfies RateLimitRule;
