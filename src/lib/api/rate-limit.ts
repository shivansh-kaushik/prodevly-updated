import { RateLimit } from '@/models';
import { connectToDatabase } from '@/lib/db/mongoose';
import type { RateLimitRule } from '@/config/rate-limits';
import { mongoose } from '@/lib/db/mongoose';
import { hashKey } from './client-ip';
import { rateLimited, serviceUnavailable } from './errors';

/**
 * Fixed-window rate limiting backed by MongoDB: one document per (bucket, key,
 * window) with a TTL index, so state is shared across instances and cleans itself
 * up. The counter is one atomic `$inc`.
 *
 * The window is fixed rather than sliding: a sliding window needs per-hit
 * documents, and for these endpoints the extra precision buys nothing.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

function windowOf(rule: RateLimitRule, now: number) {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  return { windowStart, expiresAt: new Date(windowStart + windowMs) };
}

/**
 * The stored key never contains the raw identifier: emails and IPs would otherwise sit
 * in `rateLimits._id` in clear text. Hashing needs the salt, so it happens inside the
 * try block of the callers and a missing production salt fails closed like any other fault.
 */
function limiterKey(bucket: string, identifier: string, windowStart: number): string {
  return `${bucket}:${hashKey(`${bucket}:${identifier}`)}:${windowStart}`;
}

export async function checkRateLimit(bucket: string, identifier: string, rule: RateLimitRule): Promise<RateLimitResult> {
  const limit = identifier === 'unknown' && rule.unknownLimit ? rule.unknownLimit : rule.limit;
  const now = Date.now();
  const { windowStart, expiresAt } = windowOf(rule, now);

  try {
    const key = limiterKey(bucket, identifier, windowStart);
    await connectToDatabase();
    const doc = await RateLimit.findOneAndUpdate(
      { _id: key },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    ).lean();
    const count = doc?.count ?? 1;
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.ceil((expiresAt.getTime() - now) / 1000),
    };
  } catch (error) {
    if (rule.failClosed) {
      // The limiter itself is broken. For authentication, admin writes and money, deny.
      console.error('[rate-limit] store unavailable, failing closed', { bucket, error });
      throw serviceUnavailable('We could not process that right now. Please try again in a moment.');
    }
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }
}

/**
 * Gives back one hit in the CURRENT window. Used after a successful sign-in so the
 * person's own correct logins do not eat the quota meant for wrong guesses. Best
 * effort: a failure here must never fail the sign-in, and it never goes below zero.
 */
export async function refundRateLimit(bucket: string, identifier: string, rule: RateLimitRule): Promise<void> {
  try {
    const { windowStart } = windowOf(rule, Date.now());
    await connectToDatabase();
    await RateLimit.updateOne(
      { _id: limiterKey(bucket, identifier, windowStart), count: mongoose.trusted({ $gt: 0 }) },
      { $inc: { count: -1 } },
    );
  } catch (error) {
    console.error('[rate-limit] refund failed', { bucket, error });
  }
}

/**
 * Deletes every window for one (bucket, identifier), e.g. to un-block a locked-out owner.
 * Works on the hashed key, so the raw identifier is never needed in the database.
 */
export async function clearRateLimit(bucket: string, identifier: string): Promise<number> {
  await connectToDatabase();
  const prefix = `${bucket}:${hashKey(`${bucket}:${identifier}`)}:`;
  const { deletedCount } = await RateLimit.deleteMany({ _id: new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}`) });
  return deletedCount;
}

/** Throws a 429 (with `Retry-After`) when the caller is over the limit. */
export async function enforceRateLimit(
  bucket: string,
  identifier: string,
  rule: RateLimitRule,
  message?: string,
): Promise<void> {
  const result = await checkRateLimit(bucket, identifier, rule);
  if (!result.allowed) throw rateLimited(result.retryAfterSeconds, message);
}
