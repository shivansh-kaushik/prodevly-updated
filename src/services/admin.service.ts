import { Types, type ClientSession } from 'mongoose';
import { mongoose, connectToDatabase, withTransaction } from '@/lib/db/mongoose';
import { assertCapability, assertStepUp } from '@/lib/auth/guard';
import { hashPassword } from '@/lib/auth/password';
import { checkPasswordPolicy } from '@/lib/auth/password-policy';
import { normaliseGrants, type AdminRole, type Capability } from '@/config/capabilities';
import { conflict, forbidden, lastSuperadmin, notFound, selfAction, validationFailed } from '@/lib/api/errors';
import { parseObjectId } from '@/lib/validation/common';
import { escapeRegex } from '@/lib/admin/search-params';
import type { CreateAdminInput, UpdateAdminInput } from '@/lib/validation/admin';
import { Admin, Counter, Task, TeamRole, type AdminDoc } from '@/models';
import type { AdminProfile } from '@/models/admin.model';
import type { SessionUser } from '@/types/session';
import { audit, diffFields, type AuditActor } from './audit.service';
import { toAdminDTO, type AdminDTO } from './serialize';

/**
 * Admin management. Hard rules (docs/CONTRACT.md section 6), all enforced HERE and
 * again in the route layer:
 *
 * - Only superadmins manage admins (`admin:manage` is never grantable).
 * - Nobody removes, demotes or changes the role or grants of their own account.
 * - There is always at least one active superadmin. The check runs in the same
 *   transaction as the write, behind a write lock on `counters/superadmin-guard`,
 *   so two superadmins acting at the same moment conflict, one retries, and the
 *   retry fails the check. Without that lock both would read "2 superadmins left"
 *   and both succeed, leaving none.
 * - "Delete" means deactivate: the account, its work and its audit trail stay,
 *   and every session ends on the next request (token version bump).
 * - Creating a superadmin, demoting or removing one, changing grants and resetting
 *   a password need a recent step-up (the person re-entered their own password).
 */

export interface ServiceMeta {
  ipHash?: string;
  userAgent?: string;
  requestId?: string;
}

const actorOf = (admin: SessionUser): AuditActor => ({ id: admin.id, name: admin.name, role: admin.role });
const snapshot = (admin: SessionUser) => ({ id: new Types.ObjectId(admin.id), name: admin.name });
/** `id` must already be normalised with `parseObjectId` (lowercase), as must `actor.id`. */
const isSelf = (actor: SessionUser, id: string) => actor.id.toLowerCase() === id;

/** Passwords are checked against the policy with the TARGET's name and email. */
function assertPasswordAcceptable(password: string, who: { email: string; name: string }, field = 'password') {
  const reason = checkPasswordPolicy(password, who);
  if (reason) throw validationFailed({ [field]: reason });
}

/**
 * Re-checks, inside the transaction, that the acting admin is still an active
 * superadmin. The route authenticated them a moment ago; this closes the gap in
 * which they could have been demoted or removed by someone else.
 */
async function assertActorStillSuperadmin(actor: SessionUser, session: ClientSession): Promise<void> {
  // A WRITE, not a read: a plain read under snapshot isolation is write-skew. Two superadmins
  // could each read the other as "still a superadmin" while demoting each other. Touching the
  // actor's own document makes the two transactions conflict, so one retries and re-checks.
  const result = await Admin.updateOne(
    {
      _id: new Types.ObjectId(actor.id),
      status: 'active',
      role: 'superadmin',
      tokenVersion: actor.tokenVersion,
    },
    { $currentDate: { updatedAt: true } },
    { session, timestamps: false },
  );
  if (result.matchedCount !== 1) throw forbidden('Your access changed. Please sign in again.');
}

/**
 * The "never zero superadmins" guard. Call inside a transaction, before the write that could remove one.
 * Exported for tests only: with the actor re-check in front of it, a real caller who is still a
 * superadmin always counts as "another", so this is defence in depth that tests drive directly.
 */
export async function assertAnotherSuperadminRemains(targetId: string, session: ClientSession): Promise<void> {
  // The write lock: concurrent transactions touching this document conflict and one retries.
  await Counter.updateOne({ _id: 'superadmin-guard' }, { $inc: { seq: 1 } }, { upsert: true, session });
  const others = await Admin.countDocuments({
    role: 'superadmin',
    status: 'active',
    _id: mongoose.trusted({ $ne: new Types.ObjectId(targetId) }),
  }).session(session);
  if (others < 1) throw lastSuperadmin();
}

async function loadTarget(id: string, session: ClientSession): Promise<AdminDoc> {
  const target = await Admin.findById(parseObjectId(id)).session(session).lean();
  if (!target) throw notFound('We could not find that admin');
  return target;
}

/**
 * Cheap pre-read so the expensive bcrypt hash happens BEFORE the transaction opens
 * (a transaction holding locks for ~250 ms of hashing invites write conflicts). The
 * policy check is repeated inside the transaction against the fresh document.
 */
async function readPasswordTarget(id: string, status: 'active' | 'deactivated') {
  await connectToDatabase();
  const target = await Admin.findById(id).select('email name status').lean();
  if (!target) throw notFound('We could not find that admin');
  if (target.status !== status) {
    throw conflict(status === 'active' ? 'Reactivate this account instead' : 'That account is already active');
  }
  return target;
}

export async function listAdmins(): Promise<AdminDTO[]> {
  await connectToDatabase();
  const docs = await Admin.find({}).sort({ status: 1, name: 1 }).lean();
  return docs.map(toAdminDTO);
}

export interface AdminSearch {
  q?: string;
  status?: 'active' | 'deactivated';
  role?: AdminRole;
  sort?: 'name' | 'lastLoginAt' | 'createdAt';
  dir?: 'asc' | 'desc';
}

/** The admin list with filters. A team is small, so this is not paginated. */
export async function searchAdmins(params: AdminSearch = {}): Promise<AdminDTO[]> {
  await connectToDatabase();
  const filter: Record<string, unknown> = {};
  if (params.status) filter.status = params.status;
  if (params.role) filter.role = params.role;
  if (params.q) {
    const re = new RegExp(escapeRegex(params.q.slice(0, 80)), 'i');
    filter.$or = [{ name: re }, { email: re }];
  }
  const sortKey = params.sort ?? 'name';
  const dir = (params.dir ?? (sortKey === 'name' ? 'asc' : 'desc')) === 'asc' ? 1 : -1;
  // `name` is the tiebreaker, unless it is already the sort key (a second `name` key would overwrite it).
  const docs = await Admin.find(filter).sort(sortKey === 'name' ? { name: dir } : { [sortKey]: dir, name: 1 }).lean();
  return docs.map(toAdminDTO);
}

export async function getAdminById(id: string): Promise<AdminDTO> {
  await connectToDatabase();
  const doc = await Admin.findById(parseObjectId(id)).lean();
  if (!doc) throw notFound('We could not find that admin');
  return toAdminDTO(doc);
}

/** Open tasks assigned to an admin, shown in the remove dialog so they can be reassigned. */
export async function listOpenTasksFor(id: string) {
  await connectToDatabase();
  const adminId = new Types.ObjectId(parseObjectId(id));
  const tasks = await Task.find({
    assignees: mongoose.trusted({ $elemMatch: { kind: 'admin', id: adminId } }),
    status: mongoose.trusted({ $nin: ['done', 'cancelled'] }),
  })
    .select('ref title status projectId')
    .sort({ updatedAt: -1 })
    .lean();
  return tasks.map((t) => ({ id: String(t._id), ref: t.ref, title: t.title, status: t.status, projectId: String(t.projectId) }));
}

export async function createAdmin(actor: SessionUser, input: CreateAdminInput, meta: ServiceMeta = {}): Promise<AdminDTO> {
  assertCapability(actor, 'admin:manage');
  if (input.role === 'superadmin') assertStepUp(actor);

  let grants: Capability[] = [];
  if (input.grants.length > 0) {
    if (input.role === 'superadmin') throw validationFailed({ grants: 'Superadmins already have full access' });
    assertStepUp(actor);
    try {
      grants = normaliseGrants(input.role, input.grants);
    } catch (e) {
      throw validationFailed({ grants: e instanceof Error ? e.message : 'Invalid grants' });
    }
  }
  assertPasswordAcceptable(input.password, { email: input.email, name: input.name });

  const passwordHash = await hashPassword(input.password);
  return withTransaction(async (session) => {
    await assertActorStillSuperadmin(actor, session);
    const profile = await normaliseProfile(input.profile, session);
    const [created] = await Admin.create(
      [
        {
          name: input.name,
          email: input.email,
          passwordHash,
          role: input.role,
          grants,
          status: 'active',
          mustChangePassword: true,
          passwordChangedAt: new Date(),
          profile,
          createdBy: snapshot(actor),
        },
      ],
      { session },
    );
    if (!created) throw new Error('Admin was not created');
    await audit(
      {
        actor: actorOf(actor),
        action: 'admin.create',
        entity: { type: 'admin', id: String(created._id), label: created.name },
        summary: `Created ${created.role} ${created.email}`,
        changes: [
          { path: 'role', after: created.role },
          { path: 'grants', after: created.grants },
        ],
        meta,
      },
      session,
    );
    return toAdminDTO(created);
  });
}

async function normaliseProfile(profile: CreateAdminInput['profile'], session: ClientSession): Promise<AdminProfile> {
  const out: AdminProfile = { skills: profile?.skills ?? [] };
  if (!profile) return out;
  if (profile.phone) out.phone = profile.phone;
  if (profile.designation) out.designation = profile.designation;
  if (profile.employmentType) out.employmentType = profile.employmentType;
  if (profile.weeklyCapacityHours) out.weeklyCapacityHours = profile.weeklyCapacityHours;
  if (profile.jobRoleId) {
    const exists = await TeamRole.exists({ _id: profile.jobRoleId, archivedAt: null }).session(session);
    if (!exists) throw validationFailed({ 'profile.jobRoleId': 'Pick a job role that is in use' });
    out.jobRoleId = new Types.ObjectId(profile.jobRoleId);
  }
  return out;
}

export async function updateAdmin(
  actor: SessionUser,
  id: string,
  patch: UpdateAdminInput,
  meta: ServiceMeta = {},
): Promise<AdminDTO> {
  assertCapability(actor, 'admin:manage');
  id = parseObjectId(id);
  const self = isSelf(actor, id);
  if (self && (patch.role !== undefined || patch.grants !== undefined)) {
    throw selfAction('You cannot change your own role or access');
  }

  return withTransaction(async (session) => {
    await assertActorStillSuperadmin(actor, session);
    const target = await loadTarget(id, session);
    if (target.status !== 'active' && (patch.role !== undefined || patch.grants !== undefined)) {
      throw conflict('Reactivate this account before changing its access');
    }

    const set: Record<string, unknown> = {};
    const inc: Record<string, number> = {};
    const unset: Record<string, 1> = {};
    let newRole: AdminRole = target.role;

    if (patch.name !== undefined) set.name = patch.name;

    if (patch.role !== undefined && patch.role !== target.role) {
      assertStepUp(actor); // creating a superadmin or demoting one
      if (target.role === 'superadmin') await assertAnotherSuperadminRemains(id, session);
      newRole = patch.role;
      set.role = newRole;
      inc.tokenVersion = 1; // role change ends the person's sessions
      // Grants belong to the old role's baseline; start clean.
      set.grants = [];
    }

    if (patch.grants !== undefined) {
      assertStepUp(actor);
      if (newRole === 'superadmin' && patch.grants.length > 0) {
        throw validationFailed({ grants: 'Superadmins already have full access' });
      }
      try {
        set.grants = normaliseGrants(newRole, patch.grants);
      } catch (e) {
        throw validationFailed({ grants: e instanceof Error ? e.message : 'Invalid grants' });
      }
    }

    if (patch.profile) {
      for (const [key, value] of Object.entries(patch.profile)) {
        if (value === undefined) continue;
        if (key === 'jobRoleId') {
          const exists = await TeamRole.exists({ _id: value as string, archivedAt: null }).session(session);
          if (!exists) throw validationFailed({ 'profile.jobRoleId': 'Pick a job role that is in use' });
        }
        set[`profile.${key}`] = value;
      }
    }

    const update: Record<string, unknown> = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(inc).length) update.$inc = inc;
    if (Object.keys(unset).length) update.$unset = unset;
    const after = await Admin.findOneAndUpdate({ _id: target._id }, update, {
      returnDocument: 'after',
      session,
      runValidators: true,
    }).lean();
    if (!after) throw notFound('We could not find that admin');

    await audit(
      {
        actor: actorOf(actor),
        action: 'admin.update',
        entity: { type: 'admin', id: String(after._id), label: after.name },
        changes: diffFields(
          target as unknown as Record<string, unknown>,
          after as unknown as Record<string, unknown>,
          ['name', 'role', 'grants', 'profile.phone', 'profile.designation', 'profile.employmentType', 'profile.skills', 'profile.jobRoleId', 'profile.weeklyCapacityHours'],
        ),
        meta,
      },
      session,
    );
    return toAdminDTO(after);
  });
}

/** A superadmin sets a new temporary password; the person must change it on next sign-in. */
export async function resetPassword(
  actor: SessionUser,
  id: string,
  newPassword: string,
  meta: ServiceMeta = {},
): Promise<AdminDTO> {
  assertCapability(actor, 'admin:manage');
  id = parseObjectId(id);
  if (isSelf(actor, id)) throw selfAction('Use "Change password" for your own account');
  assertStepUp(actor);

  const pre = await readPasswordTarget(id, 'active');
  assertPasswordAcceptable(newPassword, pre, 'newPassword');
  const passwordHash = await hashPassword(newPassword);

  return withTransaction(async (session) => {
    await assertActorStillSuperadmin(actor, session);
    const target = await loadTarget(id, session);
    if (target.status !== 'active') throw conflict('Reactivate this account instead');
    assertPasswordAcceptable(newPassword, { email: target.email, name: target.name }, 'newPassword');

    const after = await Admin.findOneAndUpdate(
      { _id: target._id },
      {
        $set: {
          passwordHash,
          passwordChangedAt: new Date(),
          mustChangePassword: true,
          failedLoginAttempts: 0,
        },
        $unset: { lockedUntil: 1 },
        $inc: { tokenVersion: 1 },
      },
      { returnDocument: 'after', session },
    ).lean();
    if (!after) throw notFound('We could not find that admin');
    await audit(
      {
        actor: actorOf(actor),
        action: 'admin.reset_password',
        entity: { type: 'admin', id: String(after._id), label: after.name },
        meta,
      },
      session,
    );
    return toAdminDTO(after);
  });
}

/** Sign someone out everywhere. Not for your own account: use "Sign out everywhere". */
export async function revokeSessions(actor: SessionUser, id: string, meta: ServiceMeta = {}): Promise<AdminDTO> {
  assertCapability(actor, 'admin:manage');
  id = parseObjectId(id);
  if (isSelf(actor, id)) throw selfAction('Use "Sign out everywhere" for your own account');

  return withTransaction(async (session) => {
    await assertActorStillSuperadmin(actor, session);
    const target = await loadTarget(id, session);
    const after = await Admin.findOneAndUpdate(
      { _id: target._id },
      { $inc: { tokenVersion: 1 } },
      { returnDocument: 'after', session },
    ).lean();
    if (!after) throw notFound('We could not find that admin');
    await audit(
      {
        actor: actorOf(actor),
        action: 'admin.revoke_sessions',
        entity: { type: 'admin', id: String(after._id), label: after.name },
        meta,
      },
      session,
    );
    return toAdminDTO(after);
  });
}

/** "Delete" an admin: deactivate. Their account, work logs, payouts and audit entries stay. */
export async function deactivateAdmin(
  actor: SessionUser,
  id: string,
  reason: string,
  meta: ServiceMeta = {},
): Promise<AdminDTO> {
  assertCapability(actor, 'admin:manage');
  id = parseObjectId(id);
  if (isSelf(actor, id)) throw selfAction('You cannot remove your own account');

  return withTransaction(async (session) => {
    await assertActorStillSuperadmin(actor, session);
    const target = await loadTarget(id, session);
    if (target.status !== 'active') throw conflict('That account is already deactivated');
    if (target.role === 'superadmin') {
      assertStepUp(actor); // removing a superadmin
      await assertAnotherSuperadminRemains(id, session);
    }

    const after = await Admin.findOneAndUpdate(
      { _id: target._id },
      {
        $set: {
          status: 'deactivated',
          deactivatedAt: new Date(),
          deactivatedBy: snapshot(actor),
          deactivationReason: reason,
        },
        $unset: { lockedUntil: 1 },
        $inc: { tokenVersion: 1 },
      },
      { returnDocument: 'after', session },
    ).lean();
    if (!after) throw notFound('We could not find that admin');
    await audit(
      {
        actor: actorOf(actor),
        action: 'admin.deactivate',
        entity: { type: 'admin', id: String(after._id), label: after.name },
        summary: reason,
        changes: [{ path: 'status', before: 'active', after: 'deactivated' }],
        meta,
      },
      session,
    );
    return toAdminDTO(after);
  });
}

/** Bring a deactivated account back. They must set a new password on first sign-in. */
export async function reactivateAdmin(
  actor: SessionUser,
  id: string,
  newPassword: string,
  meta: ServiceMeta = {},
): Promise<AdminDTO> {
  assertCapability(actor, 'admin:manage');
  id = parseObjectId(id);
  // Always: reactivation hands out working credentials, so it is as sensitive as a password reset.
  assertStepUp(actor);

  const pre = await readPasswordTarget(id, 'deactivated');
  assertPasswordAcceptable(newPassword, pre, 'newPassword');
  const passwordHash = await hashPassword(newPassword);

  return withTransaction(async (session) => {
    await assertActorStillSuperadmin(actor, session);
    const target = await loadTarget(id, session);
    if (target.status !== 'deactivated') throw conflict('That account is already active');
    assertPasswordAcceptable(newPassword, { email: target.email, name: target.name }, 'newPassword');

    const after = await Admin.findOneAndUpdate(
      { _id: target._id },
      {
        $set: {
          status: 'active',
          passwordHash,
          passwordChangedAt: new Date(),
          mustChangePassword: true,
          failedLoginAttempts: 0,
        },
        $unset: { deactivatedAt: 1, deactivatedBy: 1, deactivationReason: 1, lockedUntil: 1 },
        $inc: { tokenVersion: 1 },
      },
      { returnDocument: 'after', session },
    ).lean();
    if (!after) throw notFound('We could not find that admin');
    await audit(
      {
        actor: actorOf(actor),
        action: 'admin.reactivate',
        entity: { type: 'admin', id: String(after._id), label: after.name },
        changes: [{ path: 'status', before: 'deactivated', after: 'active' }],
        meta,
      },
      session,
    );
    return toAdminDTO(after);
  });
}
