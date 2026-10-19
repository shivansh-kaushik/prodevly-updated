import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  SESSION_HARD_LIMIT_SECONDS,
  SESSION_TTL_SECONDS,
  sessionCookieName,
  sessionCookieOptions,
  shouldReissue,
  signSession,
  stepUpActive,
  verifySession,
  type SessionPayload,
} from './token';

const user = { id: '65f000000000000000000001', role: 'admin' as const, tokenVersion: 3 };
const key = () => new TextEncoder().encode(process.env.AUTH_SECRET!);
const now = () => Math.floor(Date.now() / 1000);

/** Forge a token with arbitrary claims, signed with the REAL secret, to test the verifier's own checks. */
const forge = (claims: Record<string, unknown>, o: { iss?: string; aud?: string; exp?: number; alg?: 'HS256' | 'HS512' } = {}) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: o.alg ?? 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setIssuer(o.iss ?? 'prodevly')
    .setAudience(o.aud ?? 'prodevly-admin')
    .setExpirationTime(o.exp ?? now() + 600)
    .sign(key());

describe('session tokens', () => {
  it('round-trips the identity claims', async () => {
    const { token, maxAgeSeconds } = await signSession(user);
    const p = await verifySession(token);
    expect(p).toMatchObject({ sub: user.id, role: 'admin', tv: 3 });
    expect(maxAgeSeconds).toBe(SESSION_TTL_SECONDS);
  });
  it('rejects empty, malformed and tampered tokens', async () => {
    expect(await verifySession(undefined)).toBeNull();
    expect(await verifySession('')).toBeNull();
    expect(await verifySession('a.b.c')).toBeNull();
    const { token } = await signSession(user);
    // Alter a character in the MIDDLE of the signature. The LAST base64url character carries
    // padding bits, so changing it can decode to the same bytes (it made this test flaky).
    const [header, payload, signature] = token.split('.') as [string, string, string];
    const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
    expect(await verifySession(`${header}.${payload}.${flip(signature, 10)}`)).toBeNull();
    expect(await verifySession(`${header}.${flip(payload, 10)}.${signature}`)).toBeNull();
    expect(await verifySession(`${flip(header, 10)}.${payload}.${signature}`)).toBeNull();
  });
  it('rejects a wrong issuer, a wrong audience and an expired token', async () => {
    const claims = { role: 'admin', tv: 0, auth_time: now() };
    expect(await verifySession(await forge(claims))).not.toBeNull();
    expect(await verifySession(await forge(claims, { iss: 'someone-else' }))).toBeNull();
    expect(await verifySession(await forge(claims, { aud: 'prodevly-public' }))).toBeNull();
    expect(await verifySession(await forge(claims, { exp: now() - 10 }))).toBeNull();
  });
  it('rejects the wrong algorithm (no HS512 or "none" downgrade)', async () => {
    expect(await verifySession(await forge({ role: 'admin', tv: 0, auth_time: now() }, { alg: 'HS512' }))).toBeNull();
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, role: 'admin', tv: 0, auth_time: now(), iss: 'prodevly', aud: 'prodevly-admin', exp: now() + 600 })).toString('base64url')}.`;
    expect(await verifySession(none)).toBeNull();
  });
  it('rejects tokens missing required claims or carrying an unknown role', async () => {
    expect(await verifySession(await forge({ role: 'admin', tv: 0 }))).toBeNull(); // no auth_time
    expect(await verifySession(await forge({ role: 'admin', auth_time: now() }))).toBeNull(); // no tv
    expect(await verifySession(await forge({ role: 'root', tv: 0, auth_time: now() }))).toBeNull();
  });
  it('enforces the 12 hour hard limit even on an otherwise valid, unexpired token', async () => {
    const old = now() - SESSION_HARD_LIMIT_SECONDS - 5;
    expect(await verifySession(await forge({ role: 'admin', tv: 0, auth_time: old }, { exp: now() + 3600 }))).toBeNull();
  });
  it('a refreshed session can never be extended past the hard limit', async () => {
    const authTime = now() - SESSION_HARD_LIMIT_SECONDS + 600; // 10 minutes of absolute life left
    const { token, maxAgeSeconds } = await signSession(user, { authTime });
    expect(maxAgeSeconds).toBeLessThanOrEqual(600);
    expect((await verifySession(token))?.auth_time).toBe(authTime);
  });
  it('slides only when under half its life is left and the hard limit still allows it', async () => {
    const mk = (remaining: number, authAge: number) =>
      ({ sub: user.id, role: 'admin', tv: 0, exp: now() + remaining, auth_time: now() - authAge }) as SessionPayload;
    expect(shouldReissue(mk(SESSION_TTL_SECONDS - 60, 60))).toBe(false); // fresh
    expect(shouldReissue(mk(SESSION_TTL_SECONDS / 2 - 600, 3600 * 4))).toBe(true); // half spent
    expect(shouldReissue(mk(300, SESSION_HARD_LIMIT_SECONDS - 300))).toBe(false); // nothing left to extend to
  });
});

describe('step-up claim', () => {
  it('is absent by default, carried when asked for, and dropped when already in the past', async () => {
    expect((await verifySession((await signSession(user)).token))?.su).toBeUndefined();
    const until = now() + 600;
    const payload = await verifySession((await signSession(user, { stepUpUntil: until })).token);
    expect(payload?.su).toBe(until);
    expect(stepUpActive(payload!)).toBe(true);
    expect((await verifySession((await signSession(user, { stepUpUntil: now() - 1 })).token))?.su).toBeUndefined();
  });
  it('is inactive once the window passes, and for a token with no claim', () => {
    expect(stepUpActive({ su: now() - 1 })).toBe(false);
    expect(stepUpActive({ su: undefined })).toBe(false);
  });
  it('rejects a token whose su is not a number', async () => {
    expect(await verifySession(await forge({ role: 'admin', tv: 0, auth_time: now(), su: 'yes' }))).toBeNull();
  });
});

describe('sliding sessions', () => {
  it('reissue keeps auth_time and the step-up window, and never passes the hard limit', async () => {
    const authTime = now() - 8 * 3600; // 4 hours of absolute life left
    const until = now() + 300;
    const first = await verifySession((await signSession(user, { authTime, stepUpUntil: until })).token);
    expect(first).not.toBeNull();
    const again = await signSession(user, { authTime: first!.auth_time, stepUpUntil: first!.su });
    const second = await verifySession(again.token);
    expect(second?.auth_time).toBe(authTime);
    expect(second?.su).toBe(until);
    expect(second!.exp!).toBeLessThanOrEqual(authTime + SESSION_HARD_LIMIT_SECONDS);
    expect(again.maxAgeSeconds).toBeLessThanOrEqual(4 * 3600);
  });
});

describe('cookie', () => {
  it('is httpOnly, lax and scoped to the site; __Host- prefixed only in production', () => {
    const o = sessionCookieOptions(100);
    expect(o).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 100 });
    expect(o).not.toHaveProperty('domain');
    expect(sessionCookieName()).toBe('pdv_session'); // NODE_ENV=test
  });
});
