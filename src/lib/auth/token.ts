import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { AdminRole } from '@/config/capabilities';

/**
 * Stateless admin sessions: an HS256 JWT in an HTTP-only cookie.
 *
 * Why not a session table: every admin request would pay a Mongo round-trip just
 * to learn who is calling. The `tv` (token version) claim gives stateless tokens
 * the one thing they lack, revocation: raising `Admin.tokenVersion` kills every
 * token that admin holds. The DATABASE stays the source of truth (role, grants and
 * status are re-read on every request); the claims here are only identity.
 *
 * This file imports nothing from Next, so the proxy and tests can use it.
 */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;
/** Sliding sessions can never be extended past this many seconds after sign-in. */
export const SESSION_HARD_LIMIT_SECONDS = 12 * 60 * 60;
const ISSUER = 'prodevly';
const AUDIENCE = 'prodevly-admin';

export interface SessionPayload extends JWTPayload {
  sub: string;
  role: AdminRole;
  /** Mirrors `Admin.tokenVersion`; a mismatch means the token was revoked. */
  tv: number;
  /** Seconds since epoch of the real sign-in. Never moves when the session slides. */
  auth_time: number;
  /**
   * Step-up is valid until this time (epoch seconds). It lives IN THE COOKIE, not
   * on the account: it is only ever present in the token issued to the browser that
   * just re-entered its password, so a second copy of the session (a stolen cookie)
   * does not inherit it.
   */
  su?: number;
}

let cached: { secret: string; key: Uint8Array } | null = null;

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET is missing or too short. Set 32+ random characters (openssl rand -base64 48).');
  }
  if (cached?.secret !== secret) cached = { secret, key: new TextEncoder().encode(secret) };
  return cached.key;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

export interface SignOptions {
  /** Original sign-in time; omit for a fresh sign-in. */
  authTime?: number;
  /** Carry a step-up window into the new token (epoch seconds). Ignored once it has passed. */
  stepUpUntil?: number;
}

export async function signSession(
  user: { id: string; role: AdminRole; tokenVersion: number },
  options: SignOptions = {},
): Promise<{ token: string; maxAgeSeconds: number }> {
  const now = nowSeconds();
  const authTime = options.authTime ?? now;
  const exp = Math.min(now + SESSION_TTL_SECONDS, authTime + SESSION_HARD_LIMIT_SECONDS);
  const claims: Record<string, unknown> = { role: user.role, tv: user.tokenVersion, auth_time: authTime };
  if (options.stepUpUntil !== undefined && options.stepUpUntil > now) claims.su = options.stepUpUntil;
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuedAt(now)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(exp)
    .sign(secretKey());
  return { token, maxAgeSeconds: Math.max(1, exp - now) };
}

/** Verifies signature, issuer, audience, expiry and the 12 h hard limit. Returns null for anything wrong. */
export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify<SessionPayload>(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.tv !== 'number') return null;
    if (typeof payload.auth_time !== 'number') return null;
    if (payload.su !== undefined && typeof payload.su !== 'number') return null;
    if (payload.role !== 'superadmin' && payload.role !== 'admin') return null;
    if (nowSeconds() > payload.auth_time + SESSION_HARD_LIMIT_SECONDS) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Is the step-up window carried in this token still open? */
export function stepUpActive(payload: Pick<SessionPayload, 'su'>): boolean {
  return typeof payload.su === 'number' && payload.su > nowSeconds();
}

/** Slide the session when less than half its life is left, as long as the hard limit allows. */
export function shouldReissue(payload: SessionPayload): boolean {
  const now = nowSeconds();
  const remaining = (payload.exp ?? 0) - now;
  const canExtend = payload.auth_time + SESSION_HARD_LIMIT_SECONDS - now > remaining + 60;
  return remaining < SESSION_TTL_SECONDS / 2 && canExtend;
}

/**
 * `__Host-` pins the cookie to this exact host (no Domain, Path=/, Secure). It
 * needs HTTPS, so localhost development uses the plain name.
 */
export function sessionCookieName(): string {
  return process.env.NODE_ENV === 'production' ? '__Host-pdv_session' : 'pdv_session';
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
