import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The contact form's token: `v1.<issued-at in ms>.<HMAC-SHA256 of the first two parts>`.
 *
 * The page fetches one from GET /api/form-token and sends it back with the submission. It proves
 * two things without a database or a cookie: the form was loaded from us (a bot that posts
 * straight to /api/leads has no valid token), and how long ago (a human takes longer than 3
 * seconds to fill a form, a script does not). It is not a CSRF token and not single-use: the rate
 * limit and the duplicate window bound replays.
 *
 * - Under FORM_TOKEN_MIN_AGE_MS since issue: "too_fast". The caller silently discards.
 * - Over FORM_TOKEN_MAX_AGE_MS: "expired". The caller asks the visitor to refresh the page.
 * - Anything that is not a token we signed (wrong shape, wrong signature, other secret): "invalid".
 */
export const FORM_TOKEN_MIN_AGE_MS = 3_000;
export const FORM_TOKEN_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const VERSION = 'v1';

function secret(): string {
  const value = process.env.FORM_TOKEN_SECRET;
  if (process.env.NODE_ENV === 'production') {
    if (!value || value.length < 16) throw new Error('FORM_TOKEN_SECRET is required in production (at least 16 characters)');
    return value;
  }
  return value || 'dev-form-token-secret';
}

const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url');
const millis = (at: number | Date) => (typeof at === 'number' ? at : at.getTime());

export function signFormToken(issuedAt: number | Date = Date.now()): string {
  const payload = `${VERSION}.${millis(issuedAt)}`;
  return `${payload}.${sign(payload)}`;
}

export type FormTokenCheck = 'ok' | 'too_fast' | 'expired' | 'invalid';

/** Verifies the signature in constant time first, and only then looks at the age. */
export function checkFormToken(token: unknown, now: number | Date = Date.now()): FormTokenCheck {
  if (typeof token !== 'string' || token.length > 200) return 'invalid';
  const parts = token.split('.');
  if (parts.length !== 3) return 'invalid';
  const [version, issued, signature] = parts as [string, string, string];
  if (version !== VERSION || !/^\d{1,15}$/.test(issued)) return 'invalid';

  const given = Buffer.from(signature);
  const expected = Buffer.from(sign(`${version}.${issued}`));
  // timingSafeEqual throws on different lengths, and a length mismatch is already "not ours".
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'invalid';

  const age = millis(now) - Number(issued);
  if (age < FORM_TOKEN_MIN_AGE_MS) return 'too_fast'; // includes a token "from the future"
  if (age > FORM_TOKEN_MAX_AGE_MS) return 'expired';
  return 'ok';
}
