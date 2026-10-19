import { mongoose, withTransaction } from '@/lib/db/mongoose';
import { RATE_LIMITS } from '@/config/rate-limits';
import { unauthorized, validationFailed, conflict } from '@/lib/api/errors';
import { enforceRateLimit, refundRateLimit } from '@/lib/api/rate-limit';
import { fakeVerify, hashPassword, verifyPassword } from '@/lib/auth/password';
import { checkPasswordPolicy } from '@/lib/auth/password-policy';
import { signSession } from '@/lib/auth/token';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Admin } from '@/models';
import { audit, SYSTEM_ACTOR, type AuditActor } from './audit.service';
import { toAdminDTO, type AdminDTO } from './serialize';

/** One message for every failure: unknown email, wrong password, locked, deactivated. Saying which is handing out half the credential. */
const REJECTION = 'That email and password do not match. Please try again.';

/** Five misses is more than a tired person mistypes and far fewer than a guessing attack needs. */
export const LOCK_AFTER_FAILURES = 5;
export const LOCK_DURATION_MS = 15 * 60_000;
export const STEP_UP_DURATION_MS = 10 * 60_000;

export interface AuthMeta {
  ipHash: string;
  userAgent?: string;
  requestId?: string;
}

export interface SignedIn {
  admin: AdminDTO;
  token: string;
  maxAgeSeconds: number;
}

/**
 * Sign in. Defences, because this endpoint is permanently under automated attack:
 *
 * 1. Two rate-limit buckets (per IP in the route, per email here), both failing
 *    closed. The per-email bucket is a deliberate trade: it caps guesses against one
 *    account no matter how many IPs the attacker rotates, at the price that someone
 *    who knows an address can keep that person waiting out the window. It is NOT keyed
 *    on (email, ip) (that would let a botnet guess without limit) and a successful
 *    sign-in gives its hit back. `admin:reset-password` clears it for a locked-out owner.
 * 2. Per-account lockout using an ATOMIC `$inc` (the counter cannot lose updates
 *    under concurrent guesses), which also survives a limiter outage.
 * 3. Constant-ish timing: unknown, locked and deactivated accounts burn a real
 *    bcrypt comparison, so they cannot be told apart with a stopwatch.
 */
export async function login(email: string, password: string, meta: AuthMeta): Promise<SignedIn> {
  await enforceRateLimit('admin:login:email', email, RATE_LIMITS.adminLoginEmail, REJECTION);
  await connectToDatabase();

  const admin = await Admin.findOne({ email }).select('+passwordHash');
  const now = Date.now();

  if (!admin || admin.status !== 'active' || (admin.lockedUntil && admin.lockedUntil.getTime() > now)) {
    await fakeVerify();
    await audit({
      actor: SYSTEM_ACTOR,
      action: 'auth.login_failed',
      entity: { type: 'admin', id: admin ? String(admin._id) : null },
      summary: !admin ? 'Unknown account' : admin.status !== 'active' ? 'Deactivated account' : 'Locked account',
      meta,
    });
    throw unauthorized(REJECTION);
  }

  if (!(await verifyPassword(password, admin.passwordHash))) {
    const updated = await Admin.findOneAndUpdate(
      { _id: admin._id },
      { $inc: { failedLoginAttempts: 1 } },
      { returnDocument: 'after' },
    ).lean();
    // Decide the lock from the RETURNED value, never from a stale read.
    if (updated && updated.failedLoginAttempts >= LOCK_AFTER_FAILURES) {
      await Admin.updateOne(
        { _id: admin._id, failedLoginAttempts: mongoose.trusted({ $gte: LOCK_AFTER_FAILURES }) },
        { $set: { lockedUntil: new Date(now + LOCK_DURATION_MS), failedLoginAttempts: 0 } },
      );
    }
    await audit({
      actor: SYSTEM_ACTOR,
      action: 'auth.login_failed',
      entity: { type: 'admin', id: String(admin._id), label: admin.name },
      summary: 'Wrong password',
      meta,
    });
    throw unauthorized(REJECTION);
  }

  // Pinned to the state the password was verified against: if the password changed, the account
  // was deactivated or sessions were revoked while bcrypt ran, this matches nothing and no session is minted.
  const signedIn = await Admin.findOneAndUpdate(
    { _id: admin._id, status: 'active', tokenVersion: admin.tokenVersion },
    {
      $set: { failedLoginAttempts: 0, lastLoginAt: new Date(now), lastLoginIpHash: meta.ipHash },
      $unset: { lockedUntil: 1 },
    },
    { returnDocument: 'after' },
  ).lean();
  if (!signedIn) throw unauthorized(REJECTION);
  // The person proved the password, so this hit was not a guess.
  await refundRateLimit('admin:login:email', email, RATE_LIMITS.adminLoginEmail);

  const { token, maxAgeSeconds } = await signSession({
    id: String(signedIn._id),
    role: signedIn.role,
    tokenVersion: signedIn.tokenVersion,
  });
  await audit({
    actor: { id: String(signedIn._id), name: signedIn.name, role: signedIn.role },
    action: 'auth.login',
    entity: { type: 'admin', id: String(signedIn._id), label: signedIn.name },
    meta,
  });
  return { admin: toAdminDTO(signedIn), token, maxAgeSeconds };
}

/**
 * Change the signed-in admin's own password. Ends EVERY other session (token
 * version bump) and returns a fresh token so the current browser stays signed in.
 */
export async function changeOwnPassword(
  adminId: string,
  currentPassword: string,
  newPassword: string,
  meta: AuthMeta,
): Promise<SignedIn> {
  await enforceRateLimit('admin:password', adminId, RATE_LIMITS.passwordChange);
  await connectToDatabase();

  const admin = await Admin.findById(adminId).select('+passwordHash');
  if (!admin || admin.status !== 'active') throw unauthorized();

  if (!(await verifyPassword(currentPassword, admin.passwordHash))) {
    throw validationFailed({ currentPassword: 'That is not your current password' });
  }
  const reason = checkPasswordPolicy(newPassword, { email: admin.email, name: admin.name });
  if (reason) throw validationFailed({ newPassword: reason });
  if (await verifyPassword(newPassword, admin.passwordHash)) {
    throw validationFailed({ newPassword: 'Pick a password you have not used here before' });
  }

  // Hash BEFORE the transaction (bcrypt is slow), sign the token AFTER it commits.
  const passwordHash = await hashPassword(newPassword);
  const updated = await withTransaction(async (session) => {
    const doc = await Admin.findOneAndUpdate(
      { _id: admin._id, status: 'active', tokenVersion: admin.tokenVersion },
      {
        $set: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: false, failedLoginAttempts: 0 },
        $unset: { lockedUntil: 1 },
        $inc: { tokenVersion: 1 },
      },
      { returnDocument: 'after', session },
    ).lean();
    if (!doc) throw conflict('Your account changed while you were doing that. Please try again.');
    const actor: AuditActor = { id: String(doc._id), name: doc.name, role: doc.role };
    await audit(
      { actor, action: 'auth.password_changed', entity: { type: 'admin', id: String(doc._id), label: doc.name }, meta },
      session,
    );
    return doc;
  });

  const { token, maxAgeSeconds } = await signSession({
    id: String(updated._id),
    role: updated.role,
    tokenVersion: updated.tokenVersion,
  });
  return { admin: toAdminDTO(updated), token, maxAgeSeconds };
}

export interface SteppedUp {
  validUntil: string;
  /** A re-issued cookie value carrying the step-up window. Only THIS browser gets it. */
  token: string;
  maxAgeSeconds: number;
}

/**
 * Re-enter the password to unlock sensitive actions for 10 minutes. The window lives
 * in the session cookie (the `su` claim), not on the account, so it applies to the
 * browser that proved the password and to no other copy of the session. `authTime`
 * is carried over unchanged: stepping up never extends the 12 h hard limit.
 */
export async function stepUp(
  adminId: string,
  password: string,
  authTime: number,
  meta: AuthMeta,
): Promise<SteppedUp> {
  await enforceRateLimit('admin:step-up', adminId, RATE_LIMITS.stepUp);
  await connectToDatabase();

  const admin = await Admin.findById(adminId).select('+passwordHash name role status tokenVersion');
  if (!admin || admin.status !== 'active') throw unauthorized();
  if (!(await verifyPassword(password, admin.passwordHash))) {
    throw validationFailed({ password: 'That is not your password' });
  }

  await withTransaction(async (session) => {
    // Pinned to the token version, so a session revoked mid-request cannot mint a step-up.
    const still = await Admin.exists({ _id: admin._id, status: 'active', tokenVersion: admin.tokenVersion }).session(session);
    if (!still) throw unauthorized();
    await audit(
      {
        actor: { id: String(admin._id), name: admin.name, role: admin.role },
        action: 'auth.step_up',
        entity: { type: 'admin', id: String(admin._id), label: admin.name },
        meta,
      },
      session,
    );
  });

  const untilSeconds = Math.floor(Date.now() / 1000) + Math.floor(STEP_UP_DURATION_MS / 1000);
  const { token, maxAgeSeconds } = await signSession(
    { id: String(admin._id), role: admin.role, tokenVersion: admin.tokenVersion },
    { authTime, stepUpUntil: untilSeconds },
  );
  return { validUntil: new Date(untilSeconds * 1000).toISOString(), token, maxAgeSeconds };
}

/**
 * Ends every session this admin holds except the current browser, which gets a fresh
 * token. The fresh token keeps the ORIGINAL `auth_time`: this must not be a way to
 * restart the 12 h hard limit. It does not carry the step-up window.
 */
export async function signOutEverywhere(adminId: string, authTime: number, meta: AuthMeta): Promise<SignedIn> {
  const updated = await withTransaction(async (session) => {
    const doc = await Admin.findOneAndUpdate(
      { _id: adminId, status: 'active' },
      { $inc: { tokenVersion: 1 } },
      { returnDocument: 'after', session },
    ).lean();
    if (!doc) throw unauthorized();
    await audit(
      {
        actor: { id: String(doc._id), name: doc.name, role: doc.role },
        action: 'auth.sign_out_everywhere',
        entity: { type: 'admin', id: String(doc._id), label: doc.name },
        meta,
      },
      session,
    );
    return doc;
  });
  const { token, maxAgeSeconds } = await signSession(
    { id: String(updated._id), role: updated.role, tokenVersion: updated.tokenVersion },
    { authTime },
  );
  return { admin: toAdminDTO(updated), token, maxAgeSeconds };
}
