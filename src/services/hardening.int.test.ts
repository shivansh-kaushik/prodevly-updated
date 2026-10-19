import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as loginRoute } from '@/app/api/admin/auth/login/route';
import { GET as meRoute } from '@/app/api/admin/auth/me/route';
import { POST as passwordRoute } from '@/app/api/admin/auth/password/route';
import { POST as stepUpRoute } from '@/app/api/admin/auth/step-up/route';
import { POST as createRoute, GET as listRoute } from '@/app/api/admin/admins/route';
import { GET as getOneRoute, PATCH as updateRoute } from '@/app/api/admin/admins/[id]/route';
import { POST as deactivateRoute } from '@/app/api/admin/admins/[id]/deactivate/route';
import { POST as reactivateRoute } from '@/app/api/admin/admins/[id]/reactivate/route';
import { POST as resetRoute } from '@/app/api/admin/admins/[id]/reset-password/route';
import { POST as revokeRoute } from '@/app/api/admin/admins/[id]/revoke-sessions/route';
import { RATE_LIMITS } from '@/config/rate-limits';
import { checkRateLimit, enforceRateLimit } from '@/lib/api/rate-limit';
import { loadSessionUser } from '@/lib/auth/authenticate';
import { sessionCookieName, sessionCookieOptions } from '@/lib/auth/token';
import { mongoose, withTransaction } from '@/lib/db/mongoose';
import { parseObjectId } from '@/lib/validation/common';
import { Admin, AuditLog, RateLimit } from '@/models';
import {
  assertAnotherSuperadminRemains,
  createAdmin,
  deactivateAdmin,
  reactivateAdmin,
  resetPassword,
  revokeSessions,
  updateAdmin,
} from '@/services/admin.service';
import { changeOwnPassword, login, signOutEverywhere, stepUp } from '@/services/auth.service';
import { breakGlassReset } from '@/services/break-glass.service';
import { setupTestDb } from '@/test/db';
import { call, cookieFor, makeAdmin, makeSuperadmin, sessionFor, TEST_PASSWORD } from '@/test/factories';

setupTestDb();
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const META = { ipHash: 'x', userAgent: 'test' };
const post = (body: unknown, extra: object = {}) => ({ method: 'POST', body, ...extra });
const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; status?: number; message?: string };
  }
  throw new Error('expected the call to be rejected');
};
/** An admin whose id has at least one hex LETTER, so upper-casing it really changes the string. */
async function superadminWithLetters() {
  for (let i = 0; i < 40; i++) {
    const sa = await makeSuperadmin();
    if (/[a-f]/.test(String(sa._id))) return sa;
  }
  throw new Error('no id with letters in 40 tries');
}
/** Pins the clock in the MIDDLE of a 15-minute window so fixed-window limiter tests cannot straddle a boundary. */
function pinMidWindow() {
  const window = 15 * 60_000;
  const start = Math.floor(Date.now() / window) * window;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(start + 7 * 60_000);
  return start + 7 * 60_000;
}

describe('ids have one spelling', () => {
  it('parseObjectId returns the lowercase form', () => {
    expect(parseObjectId('5F3A9C0B1D2E4F6A8B7C9D0E')).toBe('5f3a9c0b1d2e4f6a8b7c9d0e');
    expect(() => parseObjectId('not-an-id')).toThrow();
  });

  it('an UPPERCASE id cannot dodge SELF_ACTION in any management service', async () => {
    const me = await superadminWithLetters();
    await makeSuperadmin(); // a second superadmin, so the last-superadmin guard is not what stops us
    const sa = await sessionFor(me, { stepUp: true });
    const id = String(me._id).toUpperCase();
    expect(id).not.toBe(String(me._id));

    expect((await rejects(updateAdmin(sa, id, { role: 'admin' }))).code).toBe('SELF_ACTION');
    expect((await rejects(updateAdmin(sa, id, { grants: ['payment:view'] }))).code).toBe('SELF_ACTION');
    expect((await rejects(resetPassword(sa, id, 'another-long-passphrase-5'))).code).toBe('SELF_ACTION');
    expect((await rejects(revokeSessions(sa, id))).code).toBe('SELF_ACTION');
    expect((await rejects(deactivateAdmin(sa, id, 'bye bye'))).code).toBe('SELF_ACTION');
    const after = await Admin.findById(me._id).lean();
    expect(after).toMatchObject({ role: 'superadmin', status: 'active', tokenVersion: 0 });
  });

  it('... and the same through the HTTP routes', async () => {
    const me = await superadminWithLetters();
    await makeSuperadmin();
    const cookie = await cookieFor(me, { stepUp: true });
    const id = String(me._id).toUpperCase();
    const patch = await call(updateRoute, `/api/admin/admins/${id}`, { method: 'PATCH', body: { role: 'admin' }, cookie }, { id });
    expect(patch.body.error.code).toBe('SELF_ACTION');
    const deact = await call(deactivateRoute, `/api/admin/admins/${id}/deactivate`, post({ reason: 'bye bye' }, { cookie }), { id });
    expect(deact.body.error.code).toBe('SELF_ACTION');
    const revoke = await call(revokeRoute, `/api/admin/admins/${id}/revoke-sessions`, post({}, { cookie }), { id });
    expect(revoke.body.error.code).toBe('SELF_ACTION');
  });
});

describe('every admin write is same-origin only (CSRF)', () => {
  it('rejects cross-site and foreign-origin writes even with a valid cookie, and changes nothing', async () => {
    const sa = await makeSuperadmin();
    const person = await makeAdmin({ name: 'Original Name' });
    const id = String(person._id);
    const cookie = await cookieFor(sa);
    const cross = await call(updateRoute, `/api/admin/admins/${id}`, { method: 'PATCH', body: { name: 'Hacked Name' }, cookie, headers: { 'sec-fetch-site': 'cross-site' } }, { id });
    expect(cross.status).toBe(403);
    const evil = await call(updateRoute, `/api/admin/admins/${id}`, { method: 'PATCH', body: { name: 'Hacked Name' }, cookie, headers: { 'sec-fetch-site': '', origin: 'https://evil.example' } }, { id });
    expect(evil.status).toBe(403);
    expect((await Admin.findById(person._id).lean())?.name).toBe('Original Name');
    // reads are not state-changing and stay open to the browser's own navigations
    expect((await call(listRoute, '/api/admin/admins', { cookie, headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(200);
  });
});

describe('a plain admin is shut out of EVERY management route', () => {
  it('answers 403 on all eight handlers, and records nothing', async () => {
    const plain = await makeAdmin();
    const cookie = await cookieFor(plain, { stepUp: true });
    const target = await makeAdmin();
    const id = String(target._id);
    const p = { id };
    const results = await Promise.all([
      call(listRoute, '/api/admin/admins', { cookie }),
      call(createRoute, '/api/admin/admins', post({ name: 'Neha Verma', email: 'neha@example.com', role: 'admin', grants: [], password: 'silver-kettle-orbit-82' }, { cookie })),
      call(getOneRoute, `/api/admin/admins/${id}`, { cookie }, p),
      call(updateRoute, `/api/admin/admins/${id}`, { method: 'PATCH', body: { name: 'Hacked Name' }, cookie }, p),
      call(deactivateRoute, `/api/admin/admins/${id}/deactivate`, post({ reason: 'because I can' }, { cookie }), p),
      call(reactivateRoute, `/api/admin/admins/${id}/reactivate`, post({ newPassword: 'fresh-temporary-phrase-73' }, { cookie }), p),
      call(resetRoute, `/api/admin/admins/${id}/reset-password`, post({ newPassword: 'fresh-temporary-phrase-73' }, { cookie }), p),
      call(revokeRoute, `/api/admin/admins/${id}/revoke-sessions`, post({}, { cookie }), p),
    ]);
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(403));
    expect(await AuditLog.countDocuments({ action: /^admin\./ })).toBe(0);
    expect(await Admin.countDocuments({})).toBe(2);
  });
});

describe('grants reach the session', () => {
  it('/me reports role defaults plus grants (and their dependencies), and nothing else', async () => {
    const admin = await makeAdmin({ grants: ['payment:record', 'content:publish'] });
    const res = await call(meRoute, '/api/admin/auth/me', { cookie: await cookieFor(admin) });
    const caps: string[] = res.body.data.capabilities;
    expect(caps).toEqual(expect.arrayContaining(['client:view', 'payment:record', 'content:publish']));
    expect(caps).not.toContain('money:approve');
    expect(caps).not.toContain('admin:manage');
    const plain = await call(meRoute, '/api/admin/auth/me', { cookie: await cookieFor(await makeAdmin()) });
    expect(plain.body.data.capabilities).not.toContain('payment:record');
  });
});

describe('the session cookie in production', () => {
  it('is __Host- prefixed, Secure, HttpOnly, Lax, Path=/ and has no Domain', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(sessionCookieName()).toBe('__Host-pdv_session');
    expect(sessionCookieOptions(60)).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    const admin = await makeAdmin({ email: 'prod@example.com' });
    const res = await call(loginRoute, '/api/admin/auth/login', post({ email: 'prod@example.com', password: TEST_PASSWORD }));
    expect(res.status).toBe(200);
    expect(admin).toBeTruthy();
    expect(res.setCookie).toMatch(/^__Host-pdv_session=/);
    expect(res.setCookie).toMatch(/Secure/i);
    expect(res.setCookie).toMatch(/HttpOnly/i);
    expect(res.setCookie).toMatch(/Path=\//);
    expect(res.setCookie).not.toMatch(/Domain=/i);
  });
});

describe('sign-in is pinned to the state the password was verified against', () => {
  it('a session is NOT minted if the account changed while the password was being checked', async () => {
    const admin = await makeAdmin({ email: 'race@example.com' });
    const real = Admin.findOneAndUpdate.bind(Admin);
    // The success update is the first findOneAndUpdate login() makes. Change the account just before it runs.
    vi.spyOn(Admin, 'findOneAndUpdate').mockImplementationOnce(((...args: Parameters<typeof real>) => ({
      lean: async () => {
        await Admin.updateOne({ _id: admin._id }, { $inc: { tokenVersion: 1 } }); // e.g. password changed meanwhile
        return real(...args).lean();
      },
    })) as never);
    expect((await rejects(login('race@example.com', TEST_PASSWORD, META))).code).toBe('UNAUTHORIZED');
    expect(await AuditLog.countDocuments({ action: 'auth.login' })).toBe(0);
  });
});

describe('lockout', () => {
  it('four wrong passwords do not lock; the fifth locks for 15 minutes; a success clears the counter', async () => {
    const now = pinMidWindow();
    const admin = await makeAdmin({ email: 'lock@example.com' });
    for (let i = 0; i < 4; i++) await rejects(login('lock@example.com', `wrong-password-${i}-x`, META));
    let doc = await Admin.findById(admin._id).lean();
    expect(doc?.failedLoginAttempts).toBe(4);
    expect(doc?.lockedUntil).toBeUndefined();

    await rejects(login('lock@example.com', 'wrong-password-4-x', META));
    doc = await Admin.findById(admin._id).lean();
    expect(doc?.lockedUntil?.getTime()).toBe(now + 15 * 60_000);
    expect(doc?.failedLoginAttempts).toBe(0);
  });

  it('a correct sign-in resets the failure counter', async () => {
    pinMidWindow();
    const admin = await makeAdmin({ email: 'reset@example.com' });
    for (let i = 0; i < 3; i++) await rejects(login('reset@example.com', `wrong-password-${i}-x`, META));
    expect((await Admin.findById(admin._id).lean())?.failedLoginAttempts).toBe(3);
    await login('reset@example.com', TEST_PASSWORD, META);
    expect((await Admin.findById(admin._id).lean())?.failedLoginAttempts).toBe(0);
  });
});

describe('rate limiting', () => {
  it('a successful sign-in gives its hit back, so a person who signs in often is never limited', async () => {
    pinMidWindow();
    await makeAdmin({ email: 'often@example.com' });
    for (let i = 0; i < 8; i++) await login('often@example.com', TEST_PASSWORD, META);
  });

  it('wrong passwords are NOT refunded: the sixth attempt in a window is refused', async () => {
    pinMidWindow();
    await makeAdmin({ email: 'guessed@example.com' });
    for (let i = 0; i < 5; i++) await rejects(login('guessed@example.com', `wrong-password-${i}-x`, META));
    expect((await rejects(login('guessed@example.com', TEST_PASSWORD, META))).code).toBe('RATE_LIMITED');
  });

  it('never stores a raw email, admin id or IP in the limiter collection', async () => {
    pinMidWindow();
    await makeAdmin({ email: 'private.person@example.com' });
    await call(loginRoute, '/api/admin/auth/login', post({ email: 'private.person@example.com', password: 'wrong-password-12' }, { ip: '203.0.113.77' }));
    const ids = (await RateLimit.find({}).lean()).map((d) => d._id);
    expect(ids.length).toBeGreaterThanOrEqual(2); // the per-IP and the per-email window
    for (const id of ids) {
      expect(id).not.toContain('private.person');
      expect(id).not.toContain('203.0.113.77');
      expect(id).toMatch(/^admin:login:(ip|email):[0-9a-f]{32}:\d+$/);
    }
  });

  it('step-up, password change and the unknown-IP bucket each have their own quota', async () => {
    pinMidWindow();
    const admin = await makeAdmin();
    const cookie = await cookieFor(admin);
    const steps = [];
    for (let i = 0; i < 6; i++) steps.push((await call(stepUpRoute, '/api/admin/auth/step-up', post({ password: 'wrong-password-12' }, { cookie }))).status);
    expect(steps).toEqual([422, 422, 422, 422, 422, 429]);

    const other = await makeAdmin();
    const cookie2 = await cookieFor(other);
    const changes = [];
    for (let i = 0; i < 6; i++) {
      changes.push((await call(passwordRoute, '/api/admin/auth/password', post({ currentPassword: 'wrong-password-12', newPassword: 'a-brand-new-passphrase-9' }, { cookie: cookie2 }))).status);
    }
    expect(changes).toEqual([422, 422, 422, 422, 422, 429]);

    const unknown = [];
    for (let i = 0; i < 4; i++) unknown.push((await checkRateLimit('admin:login:ip', 'unknown', RATE_LIMITS.adminLoginIp)).allowed);
    expect(unknown).toEqual([true, true, true, false]); // 3, not 10
  });

  it('admin writes are limited to 120 a minute per admin', async () => {
    pinMidWindow();
    let denied = 0;
    for (let i = 0; i < 122; i++) if (!(await checkRateLimit('admin:mutation', 'someone', RATE_LIMITS.adminMutation)).allowed) denied++;
    expect(denied).toBe(2);
  });

  it('fails CLOSED (503) for sign-in and admin writes when the limiter store is down, and OPEN for the public form', async () => {
    vi.spyOn(RateLimit, 'findOneAndUpdate').mockImplementation((() => {
      throw new Error('store down');
    }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await makeAdmin({ email: 'down@example.com' });
    const res = await call(loginRoute, '/api/admin/auth/login', post({ email: 'down@example.com', password: TEST_PASSWORD }));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect((await rejects(enforceRateLimit('admin:mutation', 'x', RATE_LIMITS.adminMutation))).code).toBe('SERVICE_UNAVAILABLE');
    await expect(enforceRateLimit('lead:create', 'x', RATE_LIMITS.leadCreate)).resolves.toBeUndefined();
  });
});

describe('auth changes are audited in the same transaction', () => {
  it('a failing audit write rolls back a password change', async () => {
    const admin = await makeAdmin();
    const before = await Admin.findById(admin._id).select('+passwordHash').lean();
    vi.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('audit down'));
    await rejects(changeOwnPassword(String(admin._id), TEST_PASSWORD, 'a-brand-new-passphrase-9', META));
    const after = await Admin.findById(admin._id).select('+passwordHash').lean();
    expect(after?.passwordHash).toBe(before?.passwordHash);
    expect(after?.tokenVersion).toBe(0);
  });

  it('a failing audit write rolls back sign-out-everywhere', async () => {
    const admin = await makeAdmin();
    vi.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('audit down'));
    await rejects(signOutEverywhere(String(admin._id), Math.floor(Date.now() / 1000), META));
    expect((await Admin.findById(admin._id).lean())?.tokenVersion).toBe(0);
  });

  it('a failing audit write means no step-up window is issued', async () => {
    const admin = await makeAdmin();
    vi.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('audit down'));
    await rejects(stepUp(String(admin._id), TEST_PASSWORD, Math.floor(Date.now() / 1000), META));
    expect(await AuditLog.countDocuments({ action: 'auth.step_up' })).toBe(0);
  });

  it('each one writes its audit entry on the SAME session as the change (not merely after it)', async () => {
    const admin = await makeAdmin();
    const id = String(admin._id);
    const spy = vi.spyOn(AuditLog, 'create');
    await changeOwnPassword(id, TEST_PASSWORD, 'a-brand-new-passphrase-9', META);
    await signOutEverywhere(id, Math.floor(Date.now() / 1000), META);
    await stepUp(id, 'a-brand-new-passphrase-9', Math.floor(Date.now() / 1000), META);
    expect(spy).toHaveBeenCalledTimes(3);
    for (const [, options] of spy.mock.calls) expect((options as { session?: unknown } | undefined)?.session).toBeTruthy();
  });

  it('a revoked session cannot mint a step-up window', async () => {
    const admin = await makeAdmin();
    const slow = stepUp(String(admin._id), TEST_PASSWORD, Math.floor(Date.now() / 1000), META);
    await Admin.updateOne({ _id: admin._id }, { $inc: { tokenVersion: 1 } });
    // Either it finished before the bump (fine) or it noticed the bump and refused; never a window for a dead token.
    const outcome = await slow.then(() => 'issued', (e: { code?: string }) => e.code);
    expect(['issued', 'UNAUTHORIZED']).toContain(outcome);
  });
});

describe('the actor is re-checked INSIDE the transaction, for every management action', () => {
  it('a superadmin demoted after authenticating can finish none of them', async () => {
    const A = await makeSuperadmin();
    await makeSuperadmin();
    const sa = await sessionFor(A, { stepUp: true });
    const target = await makeAdmin();
    const gone = await makeAdmin({ status: 'deactivated' });
    await Admin.updateOne({ _id: A._id }, { $set: { role: 'admin' } }); // demoted after authenticating

    const id = String(target._id);
    const calls: Record<string, () => Promise<unknown>> = {
      create: () => createAdmin(sa, { name: 'Neha Verma', email: 'neha@example.com', role: 'admin', grants: [], password: 'silver-kettle-orbit-82' }),
      update: () => updateAdmin(sa, id, { name: 'Late Edit' }),
      reset: () => resetPassword(sa, id, 'fresh-temporary-phrase-73'),
      revoke: () => revokeSessions(sa, id),
      deactivate: () => deactivateAdmin(sa, id, 'late removal'),
      reactivate: () => reactivateAdmin(sa, String(gone._id), 'fresh-temporary-phrase-73'),
    };
    for (const [name, run] of Object.entries(calls)) {
      expect((await rejects(run())).code, name).toBe('FORBIDDEN');
    }
    expect(await Admin.countDocuments({ email: 'neha@example.com' })).toBe(0);
    expect((await Admin.findById(target._id).lean())?.status).toBe('active');
  });

  it('a superadmin whose sessions were revoked (token version moved) is refused too', async () => {
    const A = await makeSuperadmin();
    const sa = await sessionFor(A, { stepUp: true });
    await Admin.updateOne({ _id: A._id }, { $inc: { tokenVersion: 1 } });
    const target = await makeAdmin();
    expect((await rejects(resetPassword(sa, String(target._id), 'fresh-temporary-phrase-73'))).code).toBe('FORBIDDEN');
  });

  it('the loser of a mutual demotion gets FORBIDDEN, exactly, and one superadmin remains', async () => {
    for (let round = 0; round < 6; round++) {
      await Admin.deleteMany({});
      const A = await makeSuperadmin();
      const B = await makeSuperadmin();
      const [sa, sb] = [await sessionFor(A, { stepUp: true }), await sessionFor(B, { stepUp: true })];
      const results = await Promise.allSettled([
        updateAdmin(sa, String(B._id), { role: 'admin' }),
        updateAdmin(sb, String(A._id), { role: 'admin' }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((loser.reason as { code?: string }).code).toBe('FORBIDDEN');
      expect(await Admin.countDocuments({ role: 'superadmin', status: 'active' })).toBe(1);
    }
  });

  it('the last-superadmin guard itself refuses when nobody else would remain', async () => {
    const only = await makeSuperadmin();
    await makeAdmin();
    await makeSuperadmin({ status: 'deactivated' });
    const err = await rejects(withTransaction((session) => assertAnotherSuperadminRemains(String(only._id), session)));
    expect(err.code).toBe('LAST_SUPERADMIN');
    const other = await makeSuperadmin();
    await expect(withTransaction((session) => assertAnotherSuperadminRemains(String(other._id), session))).resolves.toBeUndefined();
  });
});

describe('token versions move on deactivate and reactivate', () => {
  it('deactivate then reactivate leaves no old token alive', async () => {
    const sa = await sessionFor(await makeSuperadmin(), { stepUp: true });
    const person = await makeAdmin();
    await deactivateAdmin(sa, String(person._id), 'on leave for a while');
    await reactivateAdmin(sa, String(person._id), 'fresh-temporary-phrase-73');
    const sub = String(person._id);
    expect(await loadSessionUser({ sub, tv: 0 })).toBeNull();
    expect(await loadSessionUser({ sub, tv: 1 })).toBeNull();
    expect(await loadSessionUser({ sub, tv: 2 })).not.toBeNull();
  });

  it('reactivating a SUPERADMIN without a step-up is refused', async () => {
    const sa = await sessionFor(await makeSuperadmin(), { stepUp: true });
    const other = await makeSuperadmin();
    await deactivateAdmin(sa, String(other._id), 'security review');
    const plain = await sessionFor({ _id: new Types.ObjectId(sa.id) });
    expect((await rejects(reactivateAdmin(plain, String(other._id), 'fresh-temporary-phrase-73'))).code).toBe('STEP_UP_REQUIRED');
  });
});

describe('Mongoose protections', () => {
  it('sanitizeFilter and strictQuery are switched on globally', () => {
    expect(mongoose.get('sanitizeFilter')).toBe(true);
    expect(mongoose.get('strictQuery')).toBe(true);
  });

  it('an operator object where a value belongs matches nothing instead of everything', async () => {
    await makeAdmin({ email: 'victim@example.com' });
    // sanitizeFilter turns the operator into a literal `$eq` of an object, which cannot match a string:
    // the query either finds nothing or refuses to run. It must NEVER return the victim.
    const neverMatches = async (q: PromiseLike<unknown>) => {
      try {
        return await q;
      } catch {
        return null;
      }
    };
    expect(await neverMatches(Admin.findOne({ email: { $ne: 'nobody@example.com' } }))).toBeNull();
    expect(await neverMatches(Admin.findOne({ email: { $regex: '.*' } }))).toBeNull();
    expect(await neverMatches(Admin.findOne({ email: { $gt: '' } }))).toBeNull();
    expect(await Admin.findOne({ email: 'victim@example.com' })).not.toBeNull();
  });

  it('the password hash is never selected by default', async () => {
    await makeAdmin({ email: 'hidden@example.com' });
    expect((await Admin.findOne({ email: 'hidden@example.com' }).lean()) as object).not.toHaveProperty('passwordHash');
    expect(await Admin.findOne({ email: 'hidden@example.com' }).select('+passwordHash').lean()).toHaveProperty('passwordHash');
  });
});

describe('the audit log is append-only', () => {
  const entry = { at: new Date(), actor: { id: null, name: 'Tester' }, action: 'test.thing', entity: { type: 'test' }, changes: [], context: {} };

  it('refuses every kind of rewrite, including bulkWrite', async () => {
    const [saved] = await AuditLog.create([entry]);
    const _id = saved!._id;
    await expect(AuditLog.updateMany({}, { $set: { action: 'x' } })).rejects.toThrow(/append-only/);
    await expect(AuditLog.replaceOne({ _id }, { ...entry, action: 'x' })).rejects.toThrow(/append-only/);
    await expect(AuditLog.findOneAndReplace({ _id }, { ...entry, action: 'x' })).rejects.toThrow(/append-only/);
    await expect(AuditLog.deleteOne({ _id })).rejects.toThrow(/append-only/);
    await expect(AuditLog.findOneAndDelete({ _id })).rejects.toThrow(/append-only/);
    await expect(AuditLog.bulkWrite([{ updateOne: { filter: { _id }, update: { $set: { action: 'x' } } } }])).rejects.toThrow(/append-only/);
    await expect(AuditLog.bulkWrite([{ deleteOne: { filter: { _id } } }])).rejects.toThrow(/append-only/);
    await expect(AuditLog.bulkWrite([{ replaceOne: { filter: { _id }, replacement: { ...entry } } }])).rejects.toThrow(/append-only/);
    const doc = await AuditLog.findById(_id);
    doc!.action = 'edited';
    await expect(doc!.save()).rejects.toThrow(/append-only/);
    expect((await AuditLog.findById(_id).lean())?.action).toBe('test.thing');
  });

  it('still accepts plain inserts, one by one and in bulk', async () => {
    await AuditLog.create([entry]);
    await AuditLog.bulkWrite([{ insertOne: { document: { ...entry, action: 'test.bulk' } } }]);
    expect(await AuditLog.countDocuments({})).toBe(2);
  });
});

describe('break-glass reset', () => {
  const NEW_PASSWORD = 'fresh-temporary-phrase-73';

  it('resets an active account, ends its sessions, forces a change, and audits without the password', async () => {
    const admin = await makeAdmin({ email: 'owner@example.com', name: 'Dev Owner' });
    await Admin.updateOne({ _id: admin._id }, { $set: { lockedUntil: new Date(Date.now() + 60_000), failedLoginAttempts: 3 } });
    const done = await breakGlassReset({ email: ' OWNER@example.com ', password: NEW_PASSWORD });
    expect(done).toMatchObject({ email: 'owner@example.com', reactivated: false });
    const after = await Admin.findById(admin._id).lean();
    expect(after).toMatchObject({ mustChangePassword: true, tokenVersion: 1, failedLoginAttempts: 0, status: 'active' });
    expect(after?.lockedUntil).toBeUndefined();
    expect((await login('owner@example.com', NEW_PASSWORD, META)).admin.mustChangePassword).toBe(true);
    const log = await AuditLog.findOne({ action: 'admin.reset_password' }).lean();
    expect(log?.actor.name).toBe('Break-glass script');
    expect(JSON.stringify(await AuditLog.find({}).lean())).not.toContain(NEW_PASSWORD);
  });

  it('REFUSES a deactivated account unless --reactivate is given, and leaves it untouched', async () => {
    const admin = await makeAdmin({ email: 'removed@example.com', status: 'deactivated' });
    const err = await rejects(breakGlassReset({ email: 'removed@example.com', password: NEW_PASSWORD }));
    expect(err.code).toBe('CONFLICT');
    const same = await Admin.findById(admin._id).select('+passwordHash').lean();
    const before = admin;
    expect(same?.status).toBe('deactivated');
    expect(same?.tokenVersion).toBe(before.tokenVersion);
    expect(await AuditLog.countDocuments({})).toBe(0);
  });

  it('reactivates on request: status flips, deactivation fields go, and the audit says so', async () => {
    const sa = await sessionFor(await makeSuperadmin(), { stepUp: true });
    const admin = await makeAdmin({ email: 'back@example.com' });
    await deactivateAdmin(sa, String(admin._id), 'extended leave');
    const done = await breakGlassReset({ email: 'back@example.com', password: NEW_PASSWORD, reactivate: true });
    expect(done.reactivated).toBe(true);
    const after = (await Admin.findById(admin._id).lean()) as unknown as Record<string, unknown>;
    expect(after.status).toBe('active');
    for (const gone of ['deactivatedAt', 'deactivatedBy', 'deactivationReason']) expect(after).not.toHaveProperty(gone);
    const log = await AuditLog.findOne({ action: 'admin.reactivate', 'actor.name': 'Break-glass script' }).lean();
    expect(log?.changes).toEqual([{ path: 'status', before: 'deactivated', after: 'active' }]);
  });

  it('also clears the sign-in rate-limit windows, so a locked-out owner can get back in', async () => {
    await makeAdmin({ email: 'blocked@example.com' });
    for (let i = 0; i < 5; i++) await rejects(login('blocked@example.com', `wrong-password-${i}-x`, META));
    expect((await rejects(login('blocked@example.com', TEST_PASSWORD, META))).code).toBe('RATE_LIMITED');
    await breakGlassReset({ email: 'blocked@example.com', password: NEW_PASSWORD });
    await expect(login('blocked@example.com', NEW_PASSWORD, META)).resolves.toBeTruthy();
  });

  it('applies the password policy with the person\'s own name, and reports unknown accounts', async () => {
    await makeAdmin({ email: 'kavya@example.com', name: 'Kavya Iyer' });
    expect((await rejects(breakGlassReset({ email: 'kavya@example.com', password: 'kavya-and-kavya-1234' }))).code).toBe('VALIDATION_FAILED');
    expect((await rejects(breakGlassReset({ email: 'nobody@example.com', password: NEW_PASSWORD }))).code).toBe('NOT_FOUND');
  });

  it('a failing audit write rolls the reset back', async () => {
    const admin = await makeAdmin({ email: 'atomic@example.com' });
    vi.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('audit down'));
    await rejects(breakGlassReset({ email: 'atomic@example.com', password: NEW_PASSWORD }));
    expect(await Admin.findById(admin._id).lean()).toMatchObject({ tokenVersion: 0, mustChangePassword: false });
  });
});
