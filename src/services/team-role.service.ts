import { Types, type ClientSession } from 'mongoose';
import { connectToDatabase, mongoose, withTransaction } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { conflict, hasLinkedRecords, notFound, validationFailed } from '@/lib/api/errors';
import { parseObjectId } from '@/lib/validation/common';
import type { TeamRoleCreateInput, TeamRoleUpdateInput } from '@/lib/validation/team';
import { Admin, TeamRole, type TeamRoleDoc } from '@/models';
import type { SessionUser } from '@/types/session';
import type { ServiceMeta } from './admin.service';
import { audit, diffFields, type AuditActor } from './audit.service';

/**
 * The job-role catalogue (Frontend developer, Project manager...). A job role is a label and
 * grants no access. Reading it needs `team:view` (the directory shows it); changing it needs
 * `settings:edit`. Names are unique ignoring case, a role someone holds can be archived but not
 * deleted, and the seed adds none.
 */

export interface TeamRoleDTO {
  id: string;
  name: string;
  description: string | null;
  order: number;
  archived: boolean;
  archivedAt: string | null;
  /** Everyone whose profile points here, removed accounts included. This is what blocks a delete. */
  memberCount: number;
  /** Active accounts only. */
  activeMemberCount: number;
}

const actorOf = (admin: SessionUser): AuditActor => ({ id: admin.id, name: admin.name, role: admin.role });
const snapshot = (admin: SessionUser) => ({ id: new Types.ObjectId(admin.id), name: admin.name });

const isDuplicateKey = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 11000;
const NAME_TAKEN = 'This name is already in use';

function toDTO(role: TeamRoleDoc, counts?: { all: number; active: number }): TeamRoleDTO {
  return {
    id: String(role._id),
    name: role.name,
    description: role.description ?? null,
    order: role.order,
    archived: Boolean(role.archivedAt),
    archivedAt: role.archivedAt ? role.archivedAt.toISOString() : null,
    memberCount: counts?.all ?? 0,
    activeMemberCount: counts?.active ?? 0,
  };
}

/** One pass over the admins: how many hold each role, in total and among active accounts. */
async function memberCounts(session?: ClientSession): Promise<Map<string, { all: number; active: number }>> {
  const rows = await Admin.aggregate<{ _id: Types.ObjectId; all: number; active: number }>(
    [
      { $match: { 'profile.jobRoleId': { $ne: null } } },
      {
        $group: {
          _id: '$profile.jobRoleId',
          all: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
        },
      },
    ],
    { session },
  );
  return new Map(rows.map((r) => [String(r._id), { all: r.all, active: r.active }]));
}

async function listDTOs(options: { includeArchived: boolean }, session?: ClientSession): Promise<TeamRoleDTO[]> {
  const query = TeamRole.find(options.includeArchived ? {} : { archivedAt: null });
  if (session) query.session(session);
  const [docs, counts] = await Promise.all([query.sort({ order: 1, nameLower: 1 }).lean(), memberCounts(session)]);
  const rows = docs.map((d) => toDTO(d, counts.get(String(d._id))));
  // Archived roles sit below the live ones, in the same relative order.
  return [...rows.filter((r) => !r.archived), ...rows.filter((r) => r.archived)];
}

/** Active roles first (in their set order), then archived ones. */
export async function listTeamRoles(viewer: SessionUser, options: { includeArchived?: boolean } = {}): Promise<TeamRoleDTO[]> {
  assertCapability(viewer, 'team:view');
  await connectToDatabase();
  return listDTOs({ includeArchived: options.includeArchived ?? true });
}

export async function createTeamRole(viewer: SessionUser, input: TeamRoleCreateInput, meta: ServiceMeta = {}): Promise<TeamRoleDTO> {
  assertCapability(viewer, 'settings:edit');
  const name = input.name;
  const nameLower = name.toLowerCase();

  try {
    return await withTransaction(async (session) => {
      const clash = await TeamRole.findOne({ nameLower }).select('archivedAt').session(session).lean();
      if (clash) {
        throw conflict(
          clash.archivedAt ? 'An archived job role already has this name. Restore it instead.' : 'A job role with this name already exists',
          { name: NAME_TAKEN },
        );
      }
      const last = await TeamRole.findOne({}).sort({ order: -1 }).select('order').session(session).lean();
      const [created] = await TeamRole.create(
        [{ name, description: input.description || undefined, order: (last?.order ?? -1) + 1, createdBy: snapshot(viewer) }],
        { session },
      );
      if (!created) throw new Error('Job role was not created');
      await audit(
        {
          actor: actorOf(viewer),
          action: 'teamRole.create',
          entity: { type: 'teamRole', id: String(created._id), label: created.name },
          changes: [{ path: 'name', after: created.name }],
          meta,
        },
        session,
      );
      return toDTO(created.toObject());
    });
  } catch (e) {
    // Two people adding the same name at the same moment: the unique index decides, and says it nicely.
    if (isDuplicateKey(e)) throw conflict('A job role with this name already exists', { name: NAME_TAKEN });
    throw e;
  }
}

export async function updateTeamRole(viewer: SessionUser, id: string, patch: TeamRoleUpdateInput, meta: ServiceMeta = {}): Promise<TeamRoleDTO> {
  assertCapability(viewer, 'settings:edit');
  id = parseObjectId(id);
  if (Object.keys(patch).length === 0) throw validationFailed({ _: 'Nothing to update' });

  try {
    return await withTransaction(async (session) => {
      const before = await TeamRole.findById(id).session(session).lean();
      if (!before) throw notFound('We could not find that job role');

      const set: Record<string, unknown> = { updatedBy: snapshot(viewer) };
      const unset: Record<string, 1> = {};
      if (patch.name !== undefined && patch.name !== before.name) {
        const nameLower = patch.name.toLowerCase();
        // A rename that only changes the case of its own name is fine; any OTHER role with the name is not.
        const clash = await TeamRole.findOne({ nameLower, _id: mongoose.trusted({ $ne: before._id }) }).select('_id').session(session).lean();
        if (clash) throw conflict('A job role with this name already exists', { name: NAME_TAKEN });
        set.name = patch.name;
        set.nameLower = nameLower; // update queries skip the model's pre-validate hook, so it is set here
      }
      if (patch.description !== undefined && (patch.description || null) !== (before.description ?? null)) {
        if (patch.description) set.description = patch.description;
        else unset.description = 1;
      }
      if (Object.keys(set).length === 1 && Object.keys(unset).length === 0) {
        const counts = await memberCounts(session);
        return toDTO(before, counts.get(String(before._id))); // nothing changed: no write, no audit noise
      }

      const update: Record<string, unknown> = { $set: set };
      if (Object.keys(unset).length) update.$unset = unset;
      const after = await TeamRole.findOneAndUpdate({ _id: before._id }, update, { returnDocument: 'after', session, runValidators: true }).lean();
      if (!after) throw notFound('We could not find that job role');
      await audit(
        {
          actor: actorOf(viewer),
          action: 'teamRole.update',
          entity: { type: 'teamRole', id: String(after._id), label: after.name },
          changes: diffFields(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, ['name', 'description']),
          meta,
        },
        session,
      );
      const counts = await memberCounts(session);
      return toDTO(after, counts.get(String(after._id)));
    });
  } catch (e) {
    if (isDuplicateKey(e)) throw conflict('A job role with this name already exists', { name: NAME_TAKEN });
    throw e;
  }
}

/** Hides a role from pickers. People who hold it keep it; nothing else changes. */
export async function archiveTeamRole(viewer: SessionUser, id: string, meta: ServiceMeta = {}): Promise<TeamRoleDTO> {
  assertCapability(viewer, 'settings:edit');
  id = parseObjectId(id);
  return withTransaction(async (session) => {
    const before = await TeamRole.findById(id).session(session).lean();
    if (!before) throw notFound('We could not find that job role');
    if (before.archivedAt) throw conflict('That job role is already archived');
    const after = await TeamRole.findOneAndUpdate(
      { _id: before._id },
      { $set: { archivedAt: new Date(), archivedBy: snapshot(viewer), updatedBy: snapshot(viewer) } },
      { returnDocument: 'after', session },
    ).lean();
    if (!after) throw notFound('We could not find that job role');
    await audit(
      {
        actor: actorOf(viewer),
        action: 'teamRole.archive',
        entity: { type: 'teamRole', id: String(after._id), label: after.name },
        changes: [{ path: 'archived', before: false, after: true }],
        meta,
      },
      session,
    );
    const counts = await memberCounts(session);
    return toDTO(after, counts.get(String(after._id)));
  });
}

export async function restoreTeamRole(viewer: SessionUser, id: string, meta: ServiceMeta = {}): Promise<TeamRoleDTO> {
  assertCapability(viewer, 'settings:edit');
  id = parseObjectId(id);
  return withTransaction(async (session) => {
    const before = await TeamRole.findById(id).session(session).lean();
    if (!before) throw notFound('We could not find that job role');
    if (!before.archivedAt) throw conflict('That job role is not archived');
    const after = await TeamRole.findOneAndUpdate(
      { _id: before._id },
      { $set: { updatedBy: snapshot(viewer) }, $unset: { archivedAt: 1, archivedBy: 1 } },
      { returnDocument: 'after', session },
    ).lean();
    if (!after) throw notFound('We could not find that job role');
    await audit(
      {
        actor: actorOf(viewer),
        action: 'teamRole.restore',
        entity: { type: 'teamRole', id: String(after._id), label: after.name },
        changes: [{ path: 'archived', before: true, after: false }],
        meta,
      },
      session,
    );
    const counts = await memberCounts(session);
    return toDTO(after, counts.get(String(after._id)));
  });
}

/**
 * Permanent delete, for a role created by mistake. A role that any account (removed ones too)
 * still points at is refused with HAS_LINKED_RECORDS: archive it instead.
 */
export async function deleteTeamRole(viewer: SessionUser, id: string, meta: ServiceMeta = {}): Promise<{ id: string }> {
  assertCapability(viewer, 'settings:edit');
  id = parseObjectId(id);
  return withTransaction(async (session) => {
    const role = await TeamRole.findById(id).session(session).lean();
    if (!role) throw notFound('We could not find that job role');
    const holders = await Admin.countDocuments({ 'profile.jobRoleId': role._id }).session(session);
    if (holders > 0) {
      throw hasLinkedRecords(
        `${holders} ${holders === 1 ? 'person holds' : 'people hold'} this job role, so it cannot be deleted. Archive it instead.`,
      );
    }
    await TeamRole.deleteOne({ _id: role._id }, { session });
    await audit(
      {
        actor: actorOf(viewer),
        action: 'teamRole.delete',
        entity: { type: 'teamRole', id: String(role._id), label: role.name },
        meta,
      },
      session,
    );
    return { id: String(role._id) };
  });
}

/**
 * Saves a new order for the ACTIVE roles. The ids must be exactly the roles that are active now:
 * if someone added or archived one since the page loaded, this answers CONFLICT and the screen reloads,
 * rather than guessing where the newcomer belongs.
 */
export async function reorderTeamRoles(viewer: SessionUser, ids: string[], meta: ServiceMeta = {}): Promise<TeamRoleDTO[]> {
  assertCapability(viewer, 'settings:edit');
  const wanted = ids.map(parseObjectId);
  if (new Set(wanted).size !== wanted.length) throw validationFailed({ ids: 'Each job role can appear once' });

  return withTransaction(async (session) => {
    const active = await TeamRole.find({ archivedAt: null }).sort({ order: 1, nameLower: 1 }).session(session).lean();
    const known = new Set(active.map((r) => String(r._id)));
    if (wanted.length !== known.size || wanted.some((id) => !known.has(id))) {
      throw conflict('The list of job roles changed. Reload and try again.');
    }

    const byId = new Map(active.map((r) => [String(r._id), r]));
    const ops = wanted.flatMap((id, index) => {
      const role = byId.get(id);
      return role && role.order !== index
        ? [{ updateOne: { filter: { _id: role._id }, update: { $set: { order: index, updatedBy: snapshot(viewer) } } } }]
        : [];
    });
    if (ops.length > 0) {
      await TeamRole.bulkWrite(ops, { session });
      await audit(
        {
          actor: actorOf(viewer),
          action: 'teamRole.reorder',
          entity: { type: 'teamRole', label: 'Job roles' },
          changes: [{ path: 'order', before: active.map((r) => r.name), after: wanted.map((id) => byId.get(id)?.name) }],
          meta,
        },
        session,
      );
    }
    return listDTOs({ includeArchived: true }, session);
  });
}
