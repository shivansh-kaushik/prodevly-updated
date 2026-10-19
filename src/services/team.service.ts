import { Types } from 'mongoose';
import { EMPLOYMENT_TYPES } from '@/config/statuses';
import { connectToDatabase, withTransaction } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { forbidden, notFound, validationFailed } from '@/lib/api/errors';
import { escapeRegex } from '@/lib/admin/search-params';
import { todayDateOnly } from '@/lib/dates/date-only';
import { fieldErrors, parseObjectId } from '@/lib/validation/common';
import { OWN_PROFILE_FIELDS, ownProfileSchema, type OwnProfileInput } from '@/lib/validation/team';
import { Admin, Task, TeamRole, WorkLog, type AdminDoc, type TeamRoleDoc } from '@/models';
import type { SessionUser } from '@/types/session';
import type { ServiceMeta } from './admin.service';
import { audit, diffFields } from './audit.service';
import { getSettings } from './settings.service';

/**
 * The team directory and a person's own profile.
 *
 * PAY NEVER APPEARS HERE. Pay profiles live in their own collection and their own service
 * (`pay-profile.service.ts`); nothing in this file imports them, so a directory or workload read
 * cannot carry a rate, a basis or a payout note, whatever the viewer holds.
 */

const DAY = 86_400_000;

/** An inclusive range of calendar dates (UTC midnight), as `Period` carries them. */
export interface DateRange {
  from: Date;
  to: Date;
}

export interface TeamMemberDTO {
  id: string;
  name: string;
  email: string;
  status: AdminDoc['status'];
  jobRole: { id: string; name: string; archived: boolean } | null;
  designation: string | null;
  employmentType: string | null;
  skills: string[];
  weeklyCapacityHours: number | null;
  /** Assigned and not done or cancelled. */
  openTasks: number;
  /** Open tasks whose due date has passed. */
  overdueTasks: number;
  /** Sum of the estimates on open tasks (tasks without an estimate add nothing). */
  openEstimateMinutes: number;
  /** Work logged in the period. */
  loggedMinutes: number;
  /** Logged time against the capacity of the period so far, only for active people with a weekly capacity. */
  utilisationPercent: number | null;
}

export const TEAM_SORT_KEYS = ['name', 'jobRole', 'openTasks', 'loggedMinutes', 'utilisation'] as const;
export type TeamSortKey = (typeof TEAM_SORT_KEYS)[number];

export interface TeamSearch {
  q?: string;
  /** Defaults to active people. */
  status?: 'active' | 'deactivated' | 'all';
  /** A job role id, or "none" for people without one. */
  jobRole?: string;
  employmentType?: (typeof EMPLOYMENT_TYPES)[number];
  sort?: TeamSortKey;
  dir?: 'asc' | 'desc';
}

/** The most rows one directory read returns. A studio team is small; this only bounds a runaway. */
const MAX_ROWS = 500;

export interface TaskLoad {
  open: number;
  overdue: number;
  estimateMinutes: number;
}

type MemberRow = Pick<AdminDoc, '_id' | 'name' | 'email' | 'status' | 'profile'>;

/**
 * Open tasks and logged minutes per admin. NOT checked against a viewer: the callers (this file and
 * the team dashboard) each check `team:view` first. Aggregation pipelines are not sanitised, so every
 * value in them is a constant or a Date we built.
 */
export async function loadWorkload(range: DateRange, today: Date, adminIds?: Types.ObjectId[]) {
  const [taskRows, logRows] = await Promise.all([
    Task.aggregate<{ _id: Types.ObjectId; open: number; overdue: number; estimate: number }>([
      { $match: { archivedAt: null, status: { $nin: ['done', 'cancelled'] } } },
      {
        // One entry per admin per task, even if the task lists someone twice.
        $project: {
          dueOn: 1,
          estimateMinutes: 1,
          admins: {
            $setUnion: [
              { $map: { input: { $filter: { input: '$assignees', as: 'a', cond: { $eq: ['$$a.kind', 'admin'] } } }, as: 'a', in: '$$a.id' } },
              [],
            ],
          },
        },
      },
      { $unwind: '$admins' },
      ...(adminIds ? [{ $match: { admins: { $in: adminIds } } }] : []),
      {
        $group: {
          _id: '$admins',
          open: { $sum: 1 },
          overdue: { $sum: { $cond: [{ $and: [{ $eq: [{ $type: '$dueOn' }, 'date'] }, { $lt: ['$dueOn', today] }] }, 1, 0] } },
          estimate: { $sum: { $ifNull: ['$estimateMinutes', 0] } },
        },
      },
    ]),
    WorkLog.aggregate<{ _id: Types.ObjectId; minutes: number; name: string }>([
      { $match: { workedOn: { $gte: range.from, $lte: range.to }, ...(adminIds ? { adminId: { $in: adminIds } } : {}) } },
      { $sort: { workedOn: 1 } },
      { $group: { _id: '$adminId', minutes: { $sum: '$minutes' }, name: { $last: '$adminName' } } },
    ]),
  ]);
  return {
    tasks: new Map<string, TaskLoad>(taskRows.map((r) => [String(r._id), { open: r.open, overdue: r.overdue, estimateMinutes: r.estimate }])),
    minutes: new Map<string, { minutes: number; name: string }>(logRows.map((r) => [String(r._id), { minutes: r.minutes, name: r.name }])),
  };
}

/**
 * The minutes a person could have worked in the part of the period that has happened: weekly capacity
 * times the days from the later of the period start and the day they joined, to the earlier of the
 * period end and today. A future period has no capacity yet, so it has no utilisation either.
 */
export function capacityMinutes(weeklyHours: number, range: DateRange, today: Date, joinedOn?: Date | null): number {
  const joined = joinedOn ? Math.floor(joinedOn.getTime() / DAY) * DAY : Number.NEGATIVE_INFINITY;
  const start = Math.max(range.from.getTime(), joined);
  const end = Math.min(range.to.getTime(), today.getTime());
  if (end < start) return 0;
  const days = Math.round((end - start) / DAY) + 1;
  return Math.round((weeklyHours * 60 * days) / 7);
}

/** One decimal, only when there is a capacity to divide by (never NaN or Infinity). */
export function utilisationOf(loggedMinutes: number, capacity: number): number | null {
  return capacity > 0 ? Math.round((loggedMinutes / capacity) * 1000) / 10 : null;
}

function toMember(
  admin: MemberRow,
  roles: Map<string, TeamRoleDoc>,
  workload: Awaited<ReturnType<typeof loadWorkload>>,
  range: DateRange,
  today: Date,
): TeamMemberDTO {
  const id = String(admin._id);
  const profile = admin.profile ?? { skills: [] };
  const role = profile.jobRoleId ? roles.get(String(profile.jobRoleId)) : undefined;
  const load = workload.tasks.get(id);
  const loggedMinutes = workload.minutes.get(id)?.minutes ?? 0;
  const capacity = admin.status === 'active' && profile.weeklyCapacityHours ? capacityMinutes(profile.weeklyCapacityHours, range, today, profile.joinedOn) : 0;
  return {
    id,
    name: admin.name,
    email: admin.email,
    status: admin.status,
    // A role that no longer exists (deleted after being assigned) reads as "no job role", never an error.
    jobRole: role ? { id: String(role._id), name: role.name, archived: Boolean(role.archivedAt) } : null,
    designation: profile.designation ?? null,
    employmentType: profile.employmentType ?? null,
    skills: profile.skills ?? [],
    weeklyCapacityHours: profile.weeklyCapacityHours ?? null,
    openTasks: load?.open ?? 0,
    overdueTasks: load?.overdue ?? 0,
    openEstimateMinutes: load?.estimateMinutes ?? 0,
    loggedMinutes,
    utilisationPercent: utilisationOf(loggedMinutes, capacity),
  };
}

const ID = /^[a-f\d]{24}$/i;

/** The directory: people with job role, skills, capacity, open tasks and hours logged in the range. Needs `team:view`. No pay data. */
export async function searchTeam(viewer: SessionUser, range: DateRange, params: TeamSearch = {}, now = new Date()): Promise<TeamMemberDTO[]> {
  assertCapability(viewer, 'team:view');
  await connectToDatabase();

  const filter: Record<string, unknown> = {};
  const status = params.status ?? 'active';
  if (status !== 'all') filter.status = status;
  if (params.jobRole === 'none') filter['profile.jobRoleId'] = null;
  else if (params.jobRole) {
    if (!ID.test(params.jobRole)) throw validationFailed({ jobRole: 'Invalid job role' });
    filter['profile.jobRoleId'] = new Types.ObjectId(params.jobRole.toLowerCase());
  }
  if (params.employmentType) {
    if (!(EMPLOYMENT_TYPES as readonly string[]).includes(params.employmentType)) throw validationFailed({ employmentType: 'Invalid employment type' });
    filter['profile.employmentType'] = params.employmentType;
  }
  if (params.q) {
    const re = new RegExp(escapeRegex(params.q.slice(0, 80)), 'i');
    filter.$or = [{ name: re }, { email: re }, { 'profile.designation': re }, { 'profile.skills': re }];
  }

  const { timezone } = await getSettings();
  const today = todayDateOnly(now, timezone);
  const [admins, roles, workload] = await Promise.all([
    Admin.find(filter).select('name email status profile').limit(MAX_ROWS).lean(),
    TeamRole.find({}).lean(),
    loadWorkload(range, today),
  ]);
  const roleMap = new Map(roles.map((r) => [String(r._id), r]));
  const rows = admins.map((a) => toMember(a, roleMap, workload, range, today));

  const dir = (params.dir ?? (params.sort && params.sort !== 'name' && params.sort !== 'jobRole' ? 'desc' : 'asc')) === 'asc' ? 1 : -1;
  const byName = (a: TeamMemberDTO, b: TeamMemberDTO) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  const key = (m: TeamMemberDTO): number | string => {
    switch (params.sort) {
      case 'jobRole': return m.jobRole?.name.toLowerCase() ?? '￿'; // people without a role sort last
      case 'openTasks': return m.openTasks;
      case 'loggedMinutes': return m.loggedMinutes;
      case 'utilisation': return m.utilisationPercent ?? -1;
      default: return m.name.toLowerCase();
    }
  };
  return rows.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    const order = typeof ka === 'string' || typeof kb === 'string' ? String(ka).localeCompare(String(kb), 'en') : ka - kb;
    return order !== 0 ? order * dir : byName(a, b);
  });
}

/** One person's directory entry (the later person page reads this). Needs `team:view`. */
export async function getTeamMember(viewer: SessionUser, id: string, range: DateRange, now = new Date()): Promise<TeamMemberDTO> {
  assertCapability(viewer, 'team:view');
  const adminId = new Types.ObjectId(parseObjectId(id));
  await connectToDatabase();
  const { timezone } = await getSettings();
  const today = todayDateOnly(now, timezone);
  const [admin, roles, workload] = await Promise.all([
    Admin.findById(adminId).select('name email status profile').lean(),
    TeamRole.find({}).lean(),
    loadWorkload(range, today, [adminId]),
  ]);
  if (!admin) throw notFound('We could not find that person');
  return toMember(admin, new Map(roles.map((r) => [String(r._id), r])), workload, range, today);
}

// ---------------------------------------------------------------------------------------------
// Own profile
// ---------------------------------------------------------------------------------------------

export interface OwnProfileDTO {
  /** Editable by the person. */
  phone: string | null;
  designation: string | null;
  skills: string[];
  /** Set by a superadmin; shown read-only. */
  jobRole: string | null;
  employmentType: string | null;
  weeklyCapacityHours: number | null;
}

async function toOwnProfile(admin: Pick<AdminDoc, 'profile'>): Promise<OwnProfileDTO> {
  const profile = admin.profile ?? { skills: [] };
  const role = profile.jobRoleId ? await TeamRole.findById(profile.jobRoleId).select('name').lean() : null;
  return {
    phone: profile.phone ?? null,
    designation: profile.designation ?? null,
    skills: profile.skills ?? [],
    jobRole: role?.name ?? null,
    employmentType: profile.employmentType ?? null,
    weeklyCapacityHours: profile.weeklyCapacityHours ?? null,
  };
}

export async function getOwnProfile(viewer: SessionUser): Promise<OwnProfileDTO> {
  await connectToDatabase();
  const admin = await Admin.findById(viewer.id).select('profile').lean();
  if (!admin) throw notFound('We could not find your account');
  return toOwnProfile(admin);
}

/** Case-insensitive, trimmed, first spelling wins, empty ones dropped. */
function tidySkills(skills: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of skills) {
    const skill = raw.trim();
    const key = skill.toLowerCase();
    if (skill && !seen.has(key)) {
      seen.add(key);
      out.push(skill);
    }
  }
  return out;
}

/**
 * A person edits their own phone, title and skills, and nothing else: not job role, employment type,
 * weekly capacity (a planning figure a superadmin owns), access or pay. Anything off that list is refused
 * rather than silently ignored. The write is pinned to this account still being active at the same token
 * version, so a session that was just revoked cannot save.
 */
export async function updateOwnProfile(viewer: SessionUser, patch: OwnProfileInput, meta: ServiceMeta = {}): Promise<OwnProfileDTO> {
  const forbiddenKeys = Object.keys(patch).filter((k) => !(OWN_PROFILE_FIELDS as readonly string[]).includes(k));
  if (forbiddenKeys.length > 0) {
    throw validationFailed(Object.fromEntries(forbiddenKeys.map((k) => [k, 'You cannot change this yourself'])));
  }
  const parsed = ownProfileSchema.safeParse(patch);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const body = parsed.data;

  return withTransaction(async (session) => {
    const before = await Admin.findById(viewer.id).select('name status profile').session(session).lean();
    if (!before || before.status !== 'active') throw forbidden('Your access changed. Please sign in again.');

    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    const apply = (path: string, next: string | undefined, current: string | undefined) => {
      if (next === undefined || next === (current ?? '')) return;
      if (next === '') unset[path] = 1;
      else set[path] = next;
    };
    apply('profile.phone', body.phone, before.profile?.phone);
    apply('profile.designation', body.designation, before.profile?.designation);
    if (body.skills !== undefined) {
      const skills = tidySkills(body.skills);
      if (JSON.stringify(skills) !== JSON.stringify(before.profile?.skills ?? [])) set['profile.skills'] = skills;
    }
    if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) return toOwnProfile(before); // nothing changed: no write, no audit noise

    set.updatedBy = { id: new Types.ObjectId(viewer.id), name: viewer.name };
    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length > 0) update.$unset = unset;
    const after = await Admin.findOneAndUpdate(
      { _id: before._id, status: 'active', tokenVersion: viewer.tokenVersion },
      update,
      { returnDocument: 'after', session, runValidators: true },
    ).lean();
    if (!after) throw forbidden('Your access changed. Please sign in again.');

    await audit(
      {
        actor: { id: viewer.id, name: viewer.name, role: viewer.role },
        // Not `admin.update`: that prefix feeds the Admins dashboard's list of account-management actions,
        // and a person changing their own phone number is not one.
        action: 'teamProfile.update',
        entity: { type: 'admin', id: String(after._id), label: after.name },
        summary: 'Updated their own profile',
        changes: diffFields(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, ['profile.phone', 'profile.designation', 'profile.skills']),
        meta,
      },
      session,
    );
    return toOwnProfile(after);
  });
}
