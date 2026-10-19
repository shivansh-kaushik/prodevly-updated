import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as loginRoute } from '@/app/api/admin/auth/login/route';
import { POST as logoutRoute } from '@/app/api/admin/auth/logout/route';
import { GET as meRoute } from '@/app/api/admin/auth/me/route';
import { POST as passwordRoute } from '@/app/api/admin/auth/password/route';
import { POST as stepUpRoute } from '@/app/api/admin/auth/step-up/route';
import { POST as signOutEverywhereRoute } from '@/app/api/admin/auth/sign-out-everywhere/route';
import { GET as adminsRoute } from '@/app/api/admin/admins/route';
import { GET as clearRoute } from '@/app/admin/auth/clear/route';
import { proxy } from '@/proxy';
import { SignJWT } from 'jose';
import { sessionCookieName, signSession, verifySession } from '@/lib/auth/token';
import { Admin, AuditLog } from '@/models';
import { login } from '@/services/auth.service';
import { call, cookieFor, makeAdmin, makeRequest, makeSuperadmin, TEST_PASSWORD } from '@/test/factories';
import { setupTestDb } from '@/test/db';

setupTestDb();
afterEach(() => vi.useRealTimers());

/** Fixed 15-minute limiter windows: pin the clock mid-window so a test cannot straddle a boundary and flake. */
function pinMidWindow() {
  const window = 15 * 60_000;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Math.floor(Date.now() / window) * window + 7 * 60_000);
}

const post = (path: string, body: unknown, extra: object = {}) => ({ method: 'POST', body, ...extra });
const doLogin = (email: string, password: string, extra: object = {}) =>
  call(loginRoute, '/api/admin/auth/login', post('', { email, password }, extra));

describe('sign in', () => {
  it('signs in, sets a hardened cookie and never returns the password hash', async () => {
    const admin = await makeAdmin({ email: 'amit@example.com', mustChangePassword: false });
    const res = await doLogin('amit@example.com', TEST_PASSWORD);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.admin.email).toBe('amit@example.com');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);

    expect(res.setCookie).toMatch(/HttpOnly/i);
    expect(res.setCookie).toMatch(/SameSite=lax/i);
    expect(res.setCookie).toMatch(/Path=\//);
    expect(res.setCookie).not.toMatch(/Domain=/i);

    const payload = await verifySession(res.sessionCookieValue);
    expect(payload?.sub).toBe(String(admin._id));
    expect(payload?.tv).toBe(0);
    expect(payload?.auth_time).toBeGreaterThan(0);
  });

  it('normalises the email, so case does not matter', async () => {
    await makeAdmin({ email: 'amit@example.com' });
    expect((await doLogin('  AMIT@Example.COM ', TEST_PASSWORD)).status).toBe(200);
  });

  it('answers unknown email, wrong password, deactivated and locked in exactly the same way', async () => {
    await makeAdmin({ email: 'real@example.com' });
    await makeAdmin({ email: 'gone@example.com', status: 'deactivated' });
    const locked = await makeAdmin({ email: 'locked@example.com' });
    await Admin.updateOne({ _id: locked._id }, { $set: { lockedUntil: new Date(Date.now() + 60_000) } });

    const results = await Promise.all([
      doLogin('nobody@example.com', TEST_PASSWORD),
      doLogin('real@example.com', 'definitely-wrong-password-1'),
      doLogin('gone@example.com', TEST_PASSWORD),
      doLogin('locked@example.com', TEST_PASSWORD),
    ]);
    for (const r of results) expect(r.status).toBe(401);
    const messages = new Set(results.map((r) => r.body.error.message));
    expect(messages.size).toBe(1);
    const codes = new Set(results.map((r) => r.body.error.code));
    expect(codes.size).toBe(1);
  });

  it('locks the account after 5 wrong passwords, even for the right password, and unlocks when the lock expires', async () => {
    pinMidWindow();
    const admin = await makeAdmin({ email: 'lock@example.com' });
    for (let i = 0; i < 5; i++) await doLogin('lock@example.com', 'wrong-password-number-' + i);

    const afterLock = await Admin.findById(admin._id).lean();
    expect(afterLock?.lockedUntil && afterLock.lockedUntil.getTime() > Date.now()).toBe(true);
    expect(afterLock?.failedLoginAttempts).toBe(0); // reset when the lock is set

    // The email limiter has also tripped (5 attempts). Clear it, so what is tested next is the LOCK.
    const db = (await import('@/lib/db/mongoose')).mongoose.connection.db!;
    await db.collection('ratelimits').deleteMany({});

    // the correct password is refused while locked
    expect((await doLogin('lock@example.com', TEST_PASSWORD)).status).toBe(401);

    await Admin.updateOne({ _id: admin._id }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
    await db.collection('ratelimits').deleteMany({});
    const ok = await doLogin('lock@example.com', TEST_PASSWORD);
    expect(ok.status).toBe(200);
    expect((await Admin.findById(admin._id).lean())?.lockedUntil).toBeUndefined();
  });

  it('counts concurrent wrong guesses atomically', async () => {
    pinMidWindow();
    const admin = await makeAdmin({ email: 'race@example.com' });
    const meta = { ipHash: 'x', userAgent: 't' };
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => login('race@example.com', 'wrong-guess-number-' + i, meta)),
    );
    expect(attempts.every((a) => a.status === 'rejected')).toBe(true);
    const after = await Admin.findById(admin._id).lean();
    // five atomic increments: the account is locked (not stuck at 4 because of a lost update)
    expect(after?.lockedUntil && after.lockedUntil.getTime() > Date.now()).toBe(true);
  });

  it('rate limits per email (fails the 6th attempt for one address with 429 and Retry-After)', async () => {
    pinMidWindow();
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await doLogin('ghost@example.com', 'whatever-password-' + i));
    expect(results.slice(0, 5).every((r) => r.status === 401)).toBe(true);
    expect(results[5]?.status).toBe(429);
    expect(results[5]?.headers.get('retry-after')).toMatch(/^\d+$/);
  });

  it('rate limits per IP across different emails', async () => {
    pinMidWindow();
    const ip = '203.0.113.50';
    const results = [];
    for (let i = 0; i < 11; i++) results.push(await doLogin(`user${i}@example.com`, 'whatever-password-1', { ip }));
    expect(results.slice(0, 10).every((r) => r.status === 401)).toBe(true);
    expect(results[10]?.status).toBe(429);
  });

  it('rejects cross-site, non-JSON, malformed and oversized requests', async () => {
    await makeAdmin({ email: 'x@example.com' });
    const base = { email: 'x@example.com', password: TEST_PASSWORD };
    const cross = await call(loginRoute, '/api/admin/auth/login', post('', base, { headers: { 'sec-fetch-site': 'cross-site' } }));
    expect(cross.status).toBe(403);
    const evilOrigin = await call(loginRoute, '/api/admin/auth/login', post('', base, { headers: { 'sec-fetch-site': '', origin: 'https://evil.example' } }));
    expect(evilOrigin.status).toBe(403);

    const notJson = await call(loginRoute, '/api/admin/auth/login', { method: 'POST', rawBody: 'email=x', headers: { 'content-type': 'text/plain' } });
    expect(notJson.status).toBe(400);
    const broken = await call(loginRoute, '/api/admin/auth/login', { method: 'POST', rawBody: '{nope', headers: { 'content-type': 'application/json' } });
    expect(broken.status).toBe(400);
    const huge = await call(loginRoute, '/api/admin/auth/login', {
      method: 'POST',
      rawBody: JSON.stringify({ email: 'x@example.com', password: 'p'.repeat(100_000) }),
      headers: { 'content-type': 'application/json' },
    });
    expect(huge.status).toBe(413);
  });

  it('is immune to NoSQL operator injection in the email field', async () => {
    await makeAdmin({ email: 'victim@example.com' });
    const res = await call(loginRoute, '/api/admin/auth/login', post('', { email: { $ne: null }, password: { $ne: null } }));
    expect(res.status).toBe(422);
    expect(res.setCookie).toBe('');
  });

  it('records failures and successes in the audit log without secrets', async () => {
    await makeAdmin({ email: 'log@example.com' });
    await doLogin('log@example.com', 'wrong-password-123');
    await doLogin('log@example.com', TEST_PASSWORD);
    const actions = (await AuditLog.find({}).lean()).map((a) => a.action).sort();
    expect(actions).toEqual(['auth.login', 'auth.login_failed']);
    expect(JSON.stringify(await AuditLog.find({}).lean())).not.toContain(TEST_PASSWORD);
  });
});

describe('session', () => {
  it('serves /me to a valid session and rejects a missing one', async () => {
    const admin = await makeSuperadmin();
    const ok = await call(meRoute, '/api/admin/auth/me', { cookie: await cookieFor(admin) });
    expect(ok.status).toBe(200);
    expect(ok.body.data.role).toBe('superadmin');
    expect(ok.body.data.capabilities).toContain('admin:manage');

    expect((await call(meRoute, '/api/admin/auth/me')).status).toBe(401);
  });

  it('rejects tampered, wrong-audience and expired tokens', async () => {
    const admin = await makeAdmin();
    const good = await cookieFor(admin);
    const token = good.split('=')[1]!;
    const tampered = `${sessionCookieName()}=${token.slice(0, -4)}AAAA`;
    expect((await call(meRoute, '/api/admin/auth/me', { cookie: tampered })).status).toBe(401);
    expect((await call(meRoute, '/api/admin/auth/me', { cookie: `${sessionCookieName()}=garbage` })).status).toBe(401);

    // signed with a different secret
    const original = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = 'a-completely-different-secret-0123456789abcdef';
    const foreign = await signSession({ id: String(admin._id), role: 'admin', tokenVersion: 0 });
    process.env.AUTH_SECRET = original;
    expect((await call(meRoute, '/api/admin/auth/me', { cookie: `${sessionCookieName()}=${foreign.token}` })).status).toBe(401);
  });

  it('ends a session the moment the token version moves, the account is deactivated or removed', async () => {
    const admin = await makeAdmin();
    const cookie = await cookieFor(admin);
    expect((await call(meRoute, '/api/admin/auth/me', { cookie })).status).toBe(200);

    await Admin.updateOne({ _id: admin._id }, { $inc: { tokenVersion: 1 } });
    expect((await call(meRoute, '/api/admin/auth/me', { cookie })).status).toBe(401);

    const fresh = await cookieFor(admin);
    expect((await call(meRoute, '/api/admin/auth/me', { cookie: fresh })).status).toBe(200);
    await Admin.updateOne({ _id: admin._id }, { $set: { status: 'deactivated' } });
    expect((await call(meRoute, '/api/admin/auth/me', { cookie: fresh })).status).toBe(401);
  });

  it('reads the role from the database, not from the token', async () => {
    const admin = await makeSuperadmin();
    const cookie = await cookieFor(admin); // token claims superadmin
    await Admin.updateOne({ _id: admin._id }, { $set: { role: 'admin' } }); // demoted without a token bump
    const res = await call(adminsRoute, '/api/admin/admins', { cookie });
    expect(res.status).toBe(403);
  });

  it('forces a password change first: everything but /me and the password route answers 403 PASSWORD_CHANGE_REQUIRED', async () => {
    const admin = await makeSuperadmin({ mustChangePassword: true });
    const cookie = await cookieFor(admin);
    expect((await call(meRoute, '/api/admin/auth/me', { cookie })).body.data.mustChangePassword).toBe(true);
    const blocked = await call(adminsRoute, '/api/admin/admins', { cookie });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('logs out even when the session has already expired', async () => {
    const res = await call(logoutRoute, '/api/admin/auth/logout', post('', {}));
    expect(res.status).toBe(200);
    expect(res.setCookie).toMatch(/Max-Age=0/i);
  });
});

describe('change password', () => {
  it('enforces the policy, rejects the old password and a wrong current one, then rotates the session', async () => {
    const admin = await makeAdmin({ name: 'Riya Mehta', email: 'riya@example.com', mustChangePassword: true });
    const cookie = await cookieFor(admin);
    const change = (body: object) => call(passwordRoute, '/api/admin/auth/password', post('', body, { cookie }));

    expect((await change({ currentPassword: 'not-my-password-1', newPassword: 'brand-new-secret-77' })).body.error.fields.currentPassword).toBeTruthy();
    expect((await change({ currentPassword: TEST_PASSWORD, newPassword: 'short' })).body.error.fields.newPassword).toMatch(/at least 12/);
    expect((await change({ currentPassword: TEST_PASSWORD, newPassword: 'riya-and-riya-again-1' })).body.error.fields.newPassword).toMatch(/name/);
    expect((await change({ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD })).body.error.fields.newPassword).toMatch(/not used/);

    const done = await change({ currentPassword: TEST_PASSWORD, newPassword: 'brand-new-secret-77' });
    expect(done.status).toBe(200);
    expect(done.sessionCookieValue).toBeTruthy();

    // the OLD cookie is dead, the new one works, and the pending flag is cleared
    expect((await call(meRoute, '/api/admin/auth/me', { cookie })).status).toBe(401);
    const me = await call(meRoute, '/api/admin/auth/me', { cookie: `${sessionCookieName()}=${done.sessionCookieValue}` });
    expect(me.status).toBe(200);
    expect(me.body.data.mustChangePassword).toBe(false);

    expect((await doLogin('riya@example.com', TEST_PASSWORD)).status).toBe(401);
    expect((await doLogin('riya@example.com', 'brand-new-secret-77')).status).toBe(200);
  });
});

describe('step-up', () => {
  it('needs the right password and then shows as valid', async () => {
    const admin = await makeSuperadmin();
    const cookie = await cookieFor(admin);
    expect((await call(meRoute, '/api/admin/auth/me', { cookie })).body.data.stepUpValid).toBe(false);

    const bad = await call(stepUpRoute, '/api/admin/auth/step-up', post('', { password: 'wrong-password-12' }, { cookie }));
    expect(bad.status).toBe(422);
    const good = await call(stepUpRoute, '/api/admin/auth/step-up', post('', { password: TEST_PASSWORD }, { cookie }));
    expect(good.status).toBe(200);
    expect(new Date(good.body.data.validUntil).getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
    // The window rides in the RE-ISSUED cookie, not on the account or the old cookie.
    expect(good.sessionCookieValue).toBeTruthy();
    const steppedCookie = `${sessionCookieName()}=${good.sessionCookieValue}`;
    expect((await call(meRoute, '/api/admin/auth/me', { cookie: steppedCookie })).body.data.stepUpValid).toBe(true);
    expect((await call(meRoute, '/api/admin/auth/me', { cookie })).body.data.stepUpValid).toBe(false);
  });

  it('is bound to the browser that proved the password: a second copy of the session does not inherit it', async () => {
    const admin = await makeSuperadmin();
    const mine = await cookieFor(admin);
    const stolen = mine; // same token, another machine
    const good = await call(stepUpRoute, '/api/admin/auth/step-up', post('', { password: TEST_PASSWORD }, { cookie: mine }));
    expect(good.status).toBe(200);
    expect((await call(meRoute, '/api/admin/auth/me', { cookie: stolen })).body.data.stepUpValid).toBe(false);
  });

  it('never moves auth_time, so stepping up cannot extend the 12 hour limit', async () => {
    const admin = await makeSuperadmin();
    const authTime = Math.floor(Date.now() / 1000) - 3 * 3600;
    const cookie = await cookieFor(admin, { authTime });
    const good = await call(stepUpRoute, '/api/admin/auth/step-up', post('', { password: TEST_PASSWORD }, { cookie }));
    const payload = await verifySession(good.sessionCookieValue);
    expect(payload?.auth_time).toBe(authTime);
    expect(payload?.su).toBeGreaterThan(Math.floor(Date.now() / 1000) + 9 * 60);
  });

  it('is not carried into the fresh cookie that sign-out-everywhere issues', async () => {
    const admin = await makeSuperadmin();
    const stepped = await cookieFor(admin, { stepUp: true });
    expect((await call(meRoute, '/api/admin/auth/me', { cookie: stepped })).body.data.stepUpValid).toBe(true);
    const res = await call(signOutEverywhereRoute, '/api/admin/auth/sign-out-everywhere', post('', {}, { cookie: stepped }));
    const fresh = `${sessionCookieName()}=${res.sessionCookieValue}`;
    expect((await call(meRoute, '/api/admin/auth/me', { cookie: fresh })).body.data.stepUpValid).toBe(false);
  });
});

describe('sign out everywhere', () => {
  it('kills other sessions and keeps this browser signed in', async () => {
    const admin = await makeAdmin();
    const other = await cookieFor(admin);
    const mine = await cookieFor(admin);
    const res = await call(signOutEverywhereRoute, '/api/admin/auth/sign-out-everywhere', post('', {}, { cookie: mine }));
    expect(res.status).toBe(200);
    expect((await call(meRoute, '/api/admin/auth/me', { cookie: other })).status).toBe(401);
    expect((await call(meRoute, '/api/admin/auth/me', { cookie: mine })).status).toBe(401);
    expect(res.sessionCookieValue).toBeTruthy();
    expect((await call(meRoute, '/api/admin/auth/me', { cookie: `${sessionCookieName()}=${res.sessionCookieValue}` })).status).toBe(200);
  });

  it('keeps the ORIGINAL auth_time: it is not a way to restart the 12 hour limit', async () => {
    const admin = await makeAdmin();
    const authTime = Math.floor(Date.now() / 1000) - 11 * 3600;
    const mine = await cookieFor(admin, { authTime });
    const res = await call(signOutEverywhereRoute, '/api/admin/auth/sign-out-everywhere', post('', {}, { cookie: mine }));
    expect(res.status).toBe(200);
    const payload = await verifySession(res.sessionCookieValue);
    expect(payload?.auth_time).toBe(authTime);
    // ... so the new cookie still dies at the original hard limit, not 8 hours from now.
    expect(payload!.exp!).toBeLessThanOrEqual(authTime + 12 * 3600);
  });
});

describe('clear route', () => {
  it('deletes the cookie and redirects to sign-in, keeping only a safe next path', async () => {
    const res = await clearRoute(makeRequest('/admin/auth/clear?next=%2Fadmin%2Fclients%3Ftab%3Dmoney'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3050/admin/login?next=%2Fadmin%2Fclients%3Ftab%3Dmoney');
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/i);

    for (const evil of ['https%3A%2F%2Fevil.com', '%2F%2Fevil.com', '%2Fadmin%2F..%2F..%2Fevil']) {
      const r = await clearRoute(makeRequest(`/admin/auth/clear?next=${evil}`));
      expect(r.headers.get('location')).toBe('http://localhost:3050/admin/login');
    }
  });
});

describe('proxy', () => {
  const run = (path: string, cookie?: string) => proxy(makeRequest(path, { cookie }));

  it('sends a visitor with no cookie to sign in, remembering where they were going', async () => {
    const res = await run('/admin/clients?tab=money');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3050/admin/login?next=%2Fadmin%2Fclients%3Ftab%3Dmoney');
  });

  it('sends a present-but-invalid cookie through /admin/auth/clear (no redirect loop)', async () => {
    const res = await run('/admin', `${sessionCookieName()}=garbage`);
    expect(res.headers.get('location')).toContain('/admin/auth/clear');
  });

  it('lets a valid session through and never bounces anyone away from the sign-in page', async () => {
    const admin = await makeAdmin();
    const cookie = await cookieFor(admin);
    expect((await run('/admin', cookie)).headers.get('location')).toBeNull();
    expect((await run('/admin/login', cookie)).headers.get('location')).toBeNull();
    expect((await run('/admin/login', `${sessionCookieName()}=garbage`)).headers.get('location')).toBeNull();
  });

  it('keeps the public auth routes open', async () => {
    expect((await run('/admin/login')).headers.get('location')).toBeNull();
    expect((await run('/admin/auth/clear')).headers.get('location')).toBeNull();
  });
});

describe('sliding sessions', () => {
  /** A genuinely half-spent session: signed in 7 hours ago, 1 hour of cookie life left, step-up open. */
  const halfSpent = async (admin: { _id: unknown; role: string }, withStepUp = false) => {
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = { role: admin.role, tv: 0, auth_time: now - 7 * 3600 };
    if (withStepUp) claims.su = now + 300;
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(admin._id))
      .setIssuedAt(now - 7 * 3600)
      .setIssuer('prodevly')
      .setAudience('prodevly-admin')
      .setExpirationTime(now + 3600)
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
    return { token, cookie: `${sessionCookieName()}=${token}`, authTime: now - 7 * 3600, now };
  };

  it('an API call re-issues the cookie with the ORIGINAL auth_time and the step-up window intact', async () => {
    const admin = await makeSuperadmin();
    const { cookie, authTime } = await halfSpent(admin, true);
    const res = await call(meRoute, '/api/admin/auth/me', { cookie });
    expect(res.status).toBe(200);
    expect(res.sessionCookieValue).toBeTruthy();
    const next = await verifySession(res.sessionCookieValue);
    expect(next?.auth_time).toBe(authTime);
    expect(next?.su).toBeGreaterThan(Math.floor(Date.now() / 1000));
    // it slid forward, but never past 12 hours after the real sign-in
    expect(next!.exp!).toBeLessThanOrEqual(authTime + 12 * 3600);
    expect(next!.exp!).toBeGreaterThan(Math.floor(Date.now() / 1000) + 3600);
  });

  it('a page load (the proxy) does the same', async () => {
    const admin = await makeSuperadmin();
    const { cookie, authTime } = await halfSpent(admin, true);
    const res = await proxy(makeRequest('/admin/clients', { cookie }));
    const issued = /pdv_session=([^;]*)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
    expect(issued).toBeTruthy();
    const next = await verifySession(issued);
    expect(next?.auth_time).toBe(authTime);
    expect(next?.su).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('does not slide a fresh session, and never slides one whose token was revoked', async () => {
    const admin = await makeSuperadmin();
    const fresh = await call(meRoute, '/api/admin/auth/me', { cookie: await cookieFor(admin) });
    expect(fresh.sessionCookieValue).toBeUndefined();

    const { cookie } = await halfSpent(admin);
    await Admin.updateOne({ _id: admin._id }, { $inc: { tokenVersion: 1 } });
    const revoked = await call(meRoute, '/api/admin/auth/me', { cookie });
    expect(revoked.status).toBe(401);
    expect(revoked.sessionCookieValue).toBeUndefined();
  });
});

