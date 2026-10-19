import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { BASE_CURRENCY } from '@/config/currencies';
import { serviceUnavailable } from '@/lib/api/errors';
import { addDays, formatDateOnly, parseDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { withTransaction } from '@/lib/db/mongoose';
import { isValidRate, roundRate } from '@/lib/money/fx';
import { FxRate } from '@/models';
import { audit, SYSTEM_ACTOR } from './audit.service';
import { loadSettings } from './settings.service';

/**
 * The ECB feed (Frankfurter). `npm run fx:fetch` and GET /api/cron/fx are thin callers of this. It sits
 * in its own file to keep fx.service.ts to the rate table and `resolveFx`; import it from `./fx.service`.
 */

/** Frankfurter serves the European Central Bank's daily reference rates. */
export const FRANKFURTER_BASE = 'https://api.frankfurter.dev/v1';
const FEED_ACTOR_NAME = 'ECB rates feed';

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Response>;

export interface FxFetchResult {
  fetchedAt: string;
  /** Foreign currencies that were asked about. */
  attempted: number;
  stored: Array<{ currency: string; rateOn: string; rate: number }>;
  /** A row for that currency and day already existed (manual or earlier ECB), so nothing was written. */
  unchanged: Array<{ currency: string; rateOn: string; keptSource: 'manual' | 'ecb' }>;
  /** The ECB does not publish this currency (or the answer was not usable): enter it by hand. */
  skipped: Array<{ currency: string; reason: string }>;
  /** The feed could not be reached or answered badly. Nothing for this currency was written. */
  failed: Array<{ currency: string; reason: string }>;
}

const frankfurterSchema = z.object({
  base: z.string(),
  date: z.string(),
  rates: z.record(z.string(), z.number()),
});

type Fetched = { kind: 'rate'; currency: string; rateOn: Date; rate: number } | { kind: 'skipped' | 'failed'; currency: string; reason: string };

/**
 * One currency from the feed. `base=<currency>&symbols=INR` answers INR per 1 unit of the currency
 * directly, which is exactly what the table stores; asking for `base=INR` and inverting would throw
 * away precision on every small-value currency.
 */
async function fetchOne(currency: string, fetchImpl: FetchLike, timeoutMs: number, latestAllowed: Date): Promise<Fetched> {
  const url = `${FRANKFURTER_BASE}/latest?${new URLSearchParams({ base: currency, symbols: BASE_CURRENCY })}`;
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return { kind: 'failed', currency, reason: timedOut ? 'The rate feed took too long to answer' : 'The rate feed could not be reached' };
  }
  // 404 and 422 are how the feed says "I do not have that currency": not an outage.
  if (response.status === 404 || response.status === 422) {
    return { kind: 'skipped', currency, reason: `The ECB does not publish a reference rate for ${currency}. Enter it by hand.` };
  }
  if (!response.ok) return { kind: 'failed', currency, reason: `The rate feed answered with an error (HTTP ${response.status})` };

  let json: unknown;
  try {
    const text = await response.text();
    if (text.length > 20_000) return { kind: 'failed', currency, reason: 'The rate feed sent an unexpectedly large answer' };
    json = JSON.parse(text);
  } catch {
    return { kind: 'failed', currency, reason: 'The rate feed sent an answer that could not be read' };
  }
  const parsed = frankfurterSchema.safeParse(json);
  const rateOn = parsed.success ? parseDateOnly(parsed.data.date) : null;
  const raw = parsed.success ? parsed.data.rates[BASE_CURRENCY] : undefined;
  if (!parsed.success || !rateOn || parsed.data.base !== currency || raw === undefined) {
    return { kind: 'failed', currency, reason: 'The rate feed sent an answer in an unexpected shape' };
  }
  const rate = roundRate(raw);
  if (!isValidRate(rate)) return { kind: 'failed', currency, reason: 'The rate feed sent a rate that cannot be used' };
  if (rateOn.getTime() > latestAllowed.getTime()) return { kind: 'failed', currency, reason: 'The rate feed dated a rate in the future' };
  return { kind: 'rate', currency, rateOn, rate };
}

/**
 * Pulls the ECB reference rates for every enabled foreign currency and stores each as a row with
 * source "ecb", dated with the day the ECB gives (a weekend run stores Friday's rate). NEVER
 * overwrites: a row that already exists for that currency and day, manual or ECB, is left exactly as
 * it is. Network calls happen before the transaction; the rows and one audit entry commit together.
 *
 * Not a user action: the cron route authenticates with CRON_SECRET and the script is run by an
 * operator, so there is no viewer. `fetchImpl` is injectable so tests run on fixture JSON.
 */
export async function fetchAndStoreRates(options: { fetchImpl?: FetchLike; now?: Date; timeoutMs?: number } = {}): Promise<FxFetchResult> {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, { ...init, cache: 'no-store' }));
  const now = options.now ?? new Date();
  const settings = await loadSettings();
  const currencies = settings.enabledCurrencies.filter((c) => c !== BASE_CURRENCY);
  // One day of grace: the ECB's date can run a day ahead of an organisation that is west of Europe.
  const latestAllowed = addDays(todayDateOnly(now, settings.timezone), 1);

  const fetched: Fetched[] = [];
  for (const currency of currencies) fetched.push(await fetchOne(currency, fetchImpl, options.timeoutMs ?? 10_000, latestAllowed));

  const result: FxFetchResult = { fetchedAt: now.toISOString(), attempted: currencies.length, stored: [], unchanged: [], skipped: [], failed: [] };
  const rates = fetched.filter((f): f is Extract<Fetched, { kind: 'rate' }> => f.kind === 'rate');
  for (const f of fetched) {
    if (f.kind === 'skipped') result.skipped.push({ currency: f.currency, reason: f.reason });
    if (f.kind === 'failed') result.failed.push({ currency: f.currency, reason: f.reason });
  }
  if (rates.length === 0) return result;

  await withTransaction(async (session) => {
    // A retried transaction runs this body again: start from empty so nothing is counted twice.
    result.stored = [];
    result.unchanged = [];
    for (const f of rates) {
      const existing = await FxRate.findOne({ currency: f.currency, rateOn: f.rateOn }).select('source').session(session).lean();
      if (existing) {
        result.unchanged.push({ currency: f.currency, rateOn: formatDateOnly(f.rateOn), keptSource: existing.source });
        continue;
      }
      await FxRate.create(
        [{ currency: f.currency, rateOn: f.rateOn, rate: f.rate, source: 'ecb', enteredBy: { id: null, name: FEED_ACTOR_NAME } }],
        { session },
      );
      result.stored.push({ currency: f.currency, rateOn: formatDateOnly(f.rateOn), rate: f.rate });
    }
    if (result.stored.length === 0) return;
    await audit(
      {
        actor: SYSTEM_ACTOR,
        action: 'fxRate.create',
        entity: { type: 'fxRate', label: 'ECB reference rates' },
        summary: `Stored ${result.stored.length} ECB ${result.stored.length === 1 ? 'rate' : 'rates'}: ${result.stored.map((s) => s.currency).join(', ')}`,
        changes: result.stored.map((s) => ({ path: `${s.currency} ${s.rateOn}`, after: s.rate })),
      },
      session,
    );
  });
  return result;
}

/** The cron route's outcome: a feed that failed for EVERY currency asked about is an outage, anything less is a report. */
export function assertFeedReachable(result: FxFetchResult): void {
  if (result.attempted > 0 && result.failed.length === result.attempted) throw serviceUnavailable('The rate feed could not be reached');
}

/**
 * `Authorization: Bearer <CRON_SECRET>`, compared in constant time (both sides hashed first, so the
 * comparison takes the same time whatever the length of what was sent). An unset or empty secret
 * authorises nobody. The secret is never logged or echoed.
 */
export function isCronAuthorised(authorization: string | null, secret: string | undefined = process.env.CRON_SECRET): boolean {
  if (!secret) return false;
  const sent = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
  if (!sent) return false;
  const digest = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(digest(sent), digest(secret));
}
