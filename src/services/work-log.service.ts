import { Types, type ClientSession } from 'mongoose';
import { mongoose, connectToDatabase, withTransaction } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { conflict, entryLocked, forbidden, linkMismatch, notFound, validationFailed } from '@/lib/api/errors';
import { formatDateOnly, parseDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { formatDuration } from '@/lib/admin/format';
import { parseObjectId } from '@/lib/validation/common';
import { MAX_DAY_MINUTES, MAX_LOG_MINUTES, MIN_LOG_MINUTES, type CreateWorkLogInput, type UpdateWorkLogInput } from '@/lib/validation/work-log';
import { Admin, Counter, Project, Task, TeamPayout, WorkLog, type WorkLogDoc } from '@/models';
import type { SessionUser } from '@/types/session';
import type { ServiceMeta } from './admin.service';
import { audit, diffFields, type AuditActor } from './audit.service';
import { getSettings } from './settings.service';
import { projectBriefs } from './task.service';

/**
 * Time logged against tasks. Rules (docs/plan section 6):
 *
 * - An entry is 5 to 720 whole minutes with a note, dated to a calendar day that is not in the
 *   future in the organisation's zone. One person's total for one day cannot pass 16 hours.
 * - Project and client are DERIVED from the task. No time on cancelled or archived tasks, or on
 *   archived projects.
 * - Admins create entries for themselves (`worklog:own`). They edit or delete their OWN entries
 *   for `settings.workLogEditWindowDays` after logging them; after that only a holder of
 *   `worklog:editAll` (superadmins) may. An entry covered by a paid team payout is locked for
 *   everyone (ENTRY_LOCKED).
 * - `task.loggedMinutes` is a cache. It is recomputed from the logs in the SAME transaction as
 *   every create, edit and delete, so it always equals the sum.
 */
const DAY_MS = 86_400_000;
const oid = (id: string) => new Types.ObjectId(id);
const norm = (id: string) => id.toLowerCase();
const actorOf = (v: SessionUser): AuditActor => ({ id: v.id, name: v.name, role: v.role });
const ymd = (d: Date) => formatDateOnly(d);

export interface WorkLogDTO {
  id: string;
  adminId: string;
  adminName: string;
  task: { id: string; ref: string; title: string; status: string };
  project: { id: string; ref: string; name: string };
  clientId: string;
  clientName: string;
  /** "YYYY-MM-DD". */
  workedOn: string;
  minutes: number;
  note: string;
  billable: boolean;
  /** Covered by a paid team payout: nobody can change it. */
  locked: boolean;
  /** Whether THIS viewer may edit or delete it right now. */
  canEdit: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

export type WorkLogAccess = { canEdit: true } | { canEdit: false; reason: 'not_yours' | 'locked' | 'window_closed' };

/**
 * Whether a viewer may change an entry right now. The order matters: someone who has no business
 * with the entry is told "not yours" before anything about it (such as that it is locked) is revealed.
 */
export function workLogAccess(viewer: Pick<SessionUser, 'id' | 'capabilities'>, log: Pick<WorkLogDoc, 'adminId' | 'lockedByPayoutId' | 'createdAt'>, windowDays: number, now = new Date()): WorkLogAccess {
  const editAll = viewer.capabilities.has('worklog:editAll');
  const mine = viewer.capabilities.has('worklog:own') && String(log.adminId) === norm(viewer.id);
  if (!editAll && !mine) return { canEdit: false, reason: 'not_yours' };
  if (log.lockedByPayoutId) return { canEdit: false, reason: 'locked' };
  if (!editAll && now.getTime() - log.createdAt.getTime() > windowDays * DAY_MS) return { canEdit: false, reason: 'window_closed' };
  return { canEdit: true };
}

function assertMayModify(access: WorkLogAccess, windowDays: number): void {
  if (access.canEdit) return;
  if (access.reason === 'not_yours') throw forbidden('You can only change your own time entries');
  if (access.reason === 'locked') throw entryLocked('A paid payout already covers this entry, so it can no longer be changed');
  throw forbidden(`You can change your own entries for ${windowDays} ${windowDays === 1 ? 'day' : 'days'} after logging them. Ask a superadmin to change this one.`);
}

function checkMinutes(minutes: number): void {
  if (!Number.isInteger(minutes) || minutes < MIN_LOG_MINUTES || minutes > MAX_LOG_MINUTES) {
    throw validationFailed({ minutes: `Log between ${MIN_LOG_MINUTES} minutes and 12 hours, in whole minutes` });
  }
}

function checkNote(note: string): string {
  const trimmed = note.trim();
  if (trimmed.length < 3 || trimmed.length > 500) throw validationFailed({ note: 'Say what you did, in 3 to 500 characters' });
  return trimmed;
}

function parseWorkedOn(value: string, today: Date): Date {
  const date = parseDateOnly(value);
  if (!date) throw validationFailed({ workedOn: 'Enter a valid date' });
  if (date.getTime() > today.getTime()) throw validationFailed({ workedOn: 'You cannot log time for a future date' });
  return date;
}

/**
 * The `Counter` document that stands for one person's day. Everything that must conflict with a write to that day touches
 * this one key: the team payout service does it for every day of a period it locks, so the key is built here, once.
 */
export function workLogDayLockKey(adminId: Types.ObjectId | string, workedOn: Date): string {
  return `worklog-day:${String(adminId)}:${ymd(workedOn)}`;
}

/**
 * Serialises everyone writing to one person's day. Concurrent transactions each see a total under
 * the cap and would both commit; touching one shared document per (person, day) makes them
 * conflict so the loser retries and sees the winner's entry.
 */
export async function lockWorkLogDay(adminId: Types.ObjectId | string, workedOn: Date, session: ClientSession): Promise<void> {
  await Counter.updateOne({ _id: workLogDayLockKey(adminId, workedOn) }, { $inc: { seq: 1 } }, { upsert: true, session });
}

async function dayMinutes(adminId: Types.ObjectId, workedOn: Date, session: ClientSession, excludeId?: Types.ObjectId): Promise<number> {
  const match: Record<string, unknown> = { adminId, workedOn };
  if (excludeId) match._id = { $ne: excludeId };
  const [row] = await WorkLog.aggregate<{ minutes: number }>([{ $match: match }, { $group: { _id: null, minutes: { $sum: '$minutes' } } }]).session(session);
  return row?.minutes ?? 0;
}

function assertWithinDayCap(already: number, adding: number, workedOn: Date): void {
  if (already + adding > MAX_DAY_MINUTES) {
    throw validationFailed({
      minutes: `That would make ${formatDuration(already + adding)} on ${ymd(workedOn)}, and the most one person can log in a day is 16 hours (${formatDuration(already)} already logged)`,
    });
  }
}

/** A paid payout locks the logs it covers; a log added or moved INTO a covered period would escape that lock. */
async function assertNotInPaidPeriod(adminId: Types.ObjectId, workedOn: Date, session: ClientSession): Promise<void> {
  const covered = await TeamPayout.exists({
    adminId,
    status: 'paid',
    periodFrom: mongoose.trusted({ $lte: workedOn }),
    periodTo: mongoose.trusted({ $gte: workedOn }),
  }).session(session);
  if (covered) throw entryLocked('A paid payout already covers that date, so time cannot be added to it');
}

/** Recomputes the task's cached total from its logs. Call in the same transaction as the log write. */
export async function syncLoggedMinutes(taskId: Types.ObjectId, session: ClientSession): Promise<number> {
  const [row] = await WorkLog.aggregate<{ minutes: number }>([{ $match: { taskId } }, { $group: { _id: null, minutes: { $sum: '$minutes' } } }]).session(session);
  const total = row?.minutes ?? 0;
  // timestamps off: a cache refresh is not an edit of the task.
  await Task.updateOne({ _id: taskId }, { $set: { loggedMinutes: total } }, { session, timestamps: false });
  return total;
}

// ---------------------------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------------------------

async function taskBriefs(ids: Types.ObjectId[]): Promise<Map<string, { ref: string; title: string; status: string }>> {
  const unique = [...new Set(ids.map(String))].map(oid);
  if (unique.length === 0) return new Map();
  const rows = await Task.find({ _id: mongoose.trusted({ $in: unique }) }).select('ref title status').lean();
  return new Map(rows.map((t) => [String(t._id), { ref: t.ref, title: t.title, status: t.status }]));
}

async function toDTOs(viewer: SessionUser, logs: WorkLogDoc[], windowDays: number, now: Date): Promise<WorkLogDTO[]> {
  const [tasks, projects] = await Promise.all([taskBriefs(logs.map((l) => l.taskId)), projectBriefs(logs.map((l) => l.projectId))]);
  return logs.map((l) => {
    const t = tasks.get(String(l.taskId));
    const p = projects.get(String(l.projectId));
    return {
      id: String(l._id),
      adminId: String(l.adminId),
      adminName: l.adminName,
      task: { id: String(l.taskId), ref: t?.ref ?? '', title: t?.title ?? 'Deleted task', status: t?.status ?? '' },
      project: { id: String(l.projectId), ref: p?.ref ?? '', name: p?.name ?? 'Unknown project' },
      clientId: String(l.clientId),
      clientName: p?.clientName ?? '',
      workedOn: ymd(l.workedOn),
      minutes: l.minutes,
      note: l.note,
      billable: l.billable,
      locked: Boolean(l.lockedByPayoutId),
      canEdit: workLogAccess(viewer, l, windowDays, now).canEdit,
      createdAt: l.createdAt.toISOString(),
    };
  });
}

async function oneDTO(viewer: SessionUser, log: WorkLogDoc, windowDays: number): Promise<WorkLogDTO> {
  const [dto] = await toDTOs(viewer, [log], windowDays, new Date());
  if (!dto) throw new Error('Work log could not be mapped');
  return dto;
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

export async function createWorkLog(viewer: SessionUser, input: CreateWorkLogInput, meta: ServiceMeta = {}): Promise<WorkLogDTO> {
  assertCapability(viewer, 'worklog:own');
  const taskId = parseObjectId(input.taskId);
  checkMinutes(input.minutes);
  const note = checkNote(input.note);
  const settings = await getSettings();
  const workedOn = parseWorkedOn(input.workedOn, todayDateOnly(new Date(), settings.timezone));
  const adminId = oid(viewer.id);

  return withTransaction(async (session) => {
    const task = await Task.findById(taskId).session(session).lean();
    if (!task) throw validationFailed({ taskId: 'That task does not exist' });
    if (task.archivedAt) throw conflict('That task is archived, so no time can be logged on it', { taskId: 'This task is archived' });
    if (task.status === 'cancelled') throw conflict('That task is cancelled, so no time can be logged on it', { taskId: 'This task is cancelled' });
    const project = await Project.findById(task.projectId).session(session).lean();
    if (!project) throw notFound('We could not find the project this task belongs to');
    if (project.archivedAt) throw conflict('That project is archived, so no time can be logged on it', { taskId: 'This project is archived' });

    // Project and client come from the task. A request that names others is wrong, not "fixed".
    if (input.projectId && norm(input.projectId) !== String(task.projectId)) {
      throw linkMismatch('That project does not own this task', { projectId: 'This task belongs to a different project' });
    }
    if (input.clientId && norm(input.clientId) !== String(task.clientId)) {
      throw linkMismatch('That client does not own this task', { clientId: 'This task belongs to a different client' });
    }

    await assertNotInPaidPeriod(adminId, workedOn, session);
    await lockWorkLogDay(adminId, workedOn, session);
    assertWithinDayCap(await dayMinutes(adminId, workedOn, session), input.minutes, workedOn);

    const [created] = await WorkLog.create(
      [
        {
          adminId,
          adminName: viewer.name,
          taskId: task._id,
          projectId: task.projectId,
          clientId: task.clientId,
          workedOn,
          minutes: input.minutes,
          note,
          billable: input.billable ?? project.contract?.pricingModel === 'hourly',
        },
      ],
      { session },
    );
    if (!created) throw new Error('Work log was not created');
    await syncLoggedMinutes(task._id, session);
    await audit(
      {
        actor: actorOf(viewer),
        action: 'workLog.create',
        entity: { type: 'workLog', id: String(created._id), ref: task.ref, label: task.title },
        summary: `Logged ${formatDuration(created.minutes)} on ${ymd(workedOn)}`,
        changes: [
          { path: 'minutes', after: created.minutes },
          { path: 'workedOn', after: ymd(workedOn) },
          { path: 'billable', after: created.billable },
        ],
        context: { clientId: String(task.clientId), projectId: String(task.projectId), taskId: String(task._id) },
        meta,
      },
      session,
    );
    return oneDTO(viewer, created.toObject(), settings.workLogEditWindowDays);
  });
}

const TRACKED = ['workedOn', 'minutes', 'note', 'billable'] as const;
const trackable = (l: WorkLogDoc): Record<string, unknown> => ({ workedOn: ymd(l.workedOn), minutes: l.minutes, note: l.note, billable: l.billable });

async function loadLog(id: string, session: ClientSession): Promise<WorkLogDoc> {
  const log = await WorkLog.findById(id).session(session).lean();
  if (!log) throw notFound('We could not find that time entry');
  return log;
}

function assertAnyWorkLogCapability(viewer: SessionUser): void {
  if (!viewer.capabilities.has('worklog:own') && !viewer.capabilities.has('worklog:editAll')) assertCapability(viewer, 'worklog:own');
}

export async function updateWorkLog(viewer: SessionUser, id: string, patch: UpdateWorkLogInput, meta: ServiceMeta = {}): Promise<WorkLogDTO> {
  assertAnyWorkLogCapability(viewer);
  id = parseObjectId(id);
  if (patch.minutes !== undefined) checkMinutes(patch.minutes);
  const note = patch.note !== undefined ? checkNote(patch.note) : undefined;
  const settings = await getSettings();
  const today = todayDateOnly(new Date(), settings.timezone);
  const newDate = patch.workedOn !== undefined ? parseWorkedOn(patch.workedOn, today) : undefined;

  return withTransaction(async (session) => {
    const log = await loadLog(id, session);
    assertMayModify(workLogAccess(viewer, log, settings.workLogEditWindowDays), settings.workLogEditWindowDays);

    const workedOn = newDate ?? log.workedOn;
    const minutes = patch.minutes ?? log.minutes;
    const set: Record<string, unknown> = {};
    if (newDate && newDate.getTime() !== log.workedOn.getTime()) set.workedOn = newDate;
    if (patch.minutes !== undefined && patch.minutes !== log.minutes) set.minutes = patch.minutes;
    if (note !== undefined && note !== log.note) set.note = note;
    if (patch.billable !== undefined && patch.billable !== log.billable) set.billable = patch.billable;
    if (Object.keys(set).length === 0) return oneDTO(viewer, log, settings.workLogEditWindowDays);

    if (set.workedOn || set.minutes) {
      if (set.workedOn) await assertNotInPaidPeriod(log.adminId, workedOn, session);
      await lockWorkLogDay(log.adminId, workedOn, session);
      assertWithinDayCap(await dayMinutes(log.adminId, workedOn, session, log._id), minutes, workedOn);
    }

    // Guarded on "not locked" so a payout that locks the entry between our read and write wins.
    const after = await WorkLog.findOneAndUpdate({ _id: log._id, lockedByPayoutId: null }, { $set: set }, { returnDocument: 'after', session, runValidators: true }).lean();
    if (!after) throw entryLocked('A paid payout already covers this entry, so it can no longer be changed');
    await syncLoggedMinutes(log.taskId, session);

    const task = await Task.findById(log.taskId).select('ref title').session(session).lean();
    await audit(
      {
        actor: actorOf(viewer),
        action: 'workLog.update',
        entity: { type: 'workLog', id: String(log._id), ref: task?.ref, label: task?.title },
        summary: String(log.adminId) === norm(viewer.id) ? undefined : `Changed ${log.adminName}'s entry`,
        changes: diffFields(trackable(log), trackable(after), TRACKED),
        context: { clientId: String(log.clientId), projectId: String(log.projectId), taskId: String(log.taskId) },
        meta,
      },
      session,
    );
    return oneDTO(viewer, after, settings.workLogEditWindowDays);
  });
}

export async function deleteWorkLog(viewer: SessionUser, id: string, meta: ServiceMeta = {}): Promise<{ id: string }> {
  assertAnyWorkLogCapability(viewer);
  id = parseObjectId(id);
  const settings = await getSettings();

  return withTransaction(async (session) => {
    const log = await loadLog(id, session);
    assertMayModify(workLogAccess(viewer, log, settings.workLogEditWindowDays), settings.workLogEditWindowDays);
    const result = await WorkLog.deleteOne({ _id: log._id, lockedByPayoutId: null }, { session });
    if (result.deletedCount !== 1) throw entryLocked('A paid payout already covers this entry, so it can no longer be removed');
    await syncLoggedMinutes(log.taskId, session);
    const task = await Task.findById(log.taskId).select('ref title').session(session).lean();
    await audit(
      {
        actor: actorOf(viewer),
        action: 'workLog.delete',
        entity: { type: 'workLog', id: String(log._id), ref: task?.ref, label: task?.title },
        summary: `Removed ${formatDuration(log.minutes)} on ${ymd(log.workedOn)}${String(log.adminId) === norm(viewer.id) ? '' : ` logged by ${log.adminName}`}`,
        changes: [{ path: 'minutes', before: log.minutes }, { path: 'workedOn', before: ymd(log.workedOn) }, { path: 'note', before: log.note }],
        context: { clientId: String(log.clientId), projectId: String(log.projectId), taskId: String(log.taskId) },
        meta,
      },
      session,
    );
    return { id };
  });
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/** What this viewer may read: everyone's logs with `worklog:viewAll`, else only their own with `worklog:own`. */
function scopeFor(viewer: SessionUser): { all: boolean } {
  if (viewer.capabilities.has('worklog:viewAll')) return { all: true };
  assertCapability(viewer, 'worklog:own');
  return { all: false };
}

export interface WorkLogFilter {
  adminId?: string;
  projectId?: string;
  clientId?: string;
  taskId?: string;
  /** "YYYY-MM-DD", inclusive. */
  from?: string;
  to?: string;
  billable?: boolean;
}

export interface WorkLogTotals {
  minutes: number;
  billableMinutes: number;
  entries: number;
  people: number;
}

export interface WorkLogPage {
  items: WorkLogDTO[];
  total: number;
  page: number;
  pageSize: number;
  /** Across EVERY entry that matches the filters, not just this page. */
  totals: WorkLogTotals;
}

/** Built only from parsed values (ids become ObjectIds, dates are parsed): aggregation stages are not sanitised. */
function rawMatch(viewer: SessionUser, f: WorkLogFilter): Record<string, unknown> {
  const m: Record<string, unknown> = {};
  const { all } = scopeFor(viewer);
  if (!all) m.adminId = oid(viewer.id);
  else if (f.adminId) m.adminId = oid(parseObjectId(f.adminId));
  if (f.projectId) m.projectId = oid(parseObjectId(f.projectId));
  if (f.clientId) m.clientId = oid(parseObjectId(f.clientId));
  if (f.taskId) m.taskId = oid(parseObjectId(f.taskId));
  const from = f.from ? parseDateOnly(f.from) : null;
  const to = f.to ? parseDateOnly(f.to) : null;
  if (f.from && !from) throw validationFailed({ from: 'Enter a valid date' });
  if (f.to && !to) throw validationFailed({ to: 'Enter a valid date' });
  if (from || to) m.workedOn = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  if (f.billable !== undefined) m.billable = f.billable;
  return m;
}

export async function listWorkLogs(viewer: SessionUser, params: WorkLogFilter & { page?: number; pageSize?: number } = {}): Promise<WorkLogPage> {
  const match = rawMatch(viewer, params);
  await connectToDatabase();
  const settings = await getSettings();
  const pageSize = Math.min(Math.max(params.pageSize ?? 25, 1), 100);
  const page = Math.max(params.page ?? 1, 1);
  const [result] = await WorkLog.aggregate<{
    rows: WorkLogDoc[];
    totals: Array<{ minutes: number; billableMinutes: number; entries: number; people: Types.ObjectId[] }>;
  }>([
    { $match: match },
    {
      $facet: {
        rows: [{ $sort: { workedOn: -1, createdAt: -1, _id: 1 } }, { $skip: (page - 1) * pageSize }, { $limit: pageSize }],
        totals: [
          {
            $group: {
              _id: null,
              minutes: { $sum: '$minutes' },
              billableMinutes: { $sum: { $cond: ['$billable', '$minutes', 0] } },
              entries: { $sum: 1 },
              people: { $addToSet: '$adminId' },
            },
          },
        ],
      },
    },
  ]);
  const t = result?.totals[0];
  return {
    items: await toDTOs(viewer, result?.rows ?? [], settings.workLogEditWindowDays, new Date()),
    total: t?.entries ?? 0,
    page,
    pageSize,
    totals: { minutes: t?.minutes ?? 0, billableMinutes: t?.billableMinutes ?? 0, entries: t?.entries ?? 0, people: t?.people.length ?? 0 },
  };
}

/** The entries on one task, newest first: everyone's for `worklog:viewAll`, else only the viewer's own. */
export async function listTaskWorkLogs(viewer: SessionUser, taskId: string): Promise<{ logs: WorkLogDTO[]; scope: 'all' | 'own' }> {
  const { all } = scopeFor(viewer);
  const tid = oid(parseObjectId(taskId));
  await connectToDatabase();
  const settings = await getSettings();
  const filter: Record<string, unknown> = { taskId: tid };
  if (!all) filter.adminId = oid(viewer.id);
  const rows = await WorkLog.find(filter).sort({ workedOn: -1, createdAt: -1 }).limit(300).lean();
  return { logs: await toDTOs(viewer, rows, settings.workLogEditWindowDays, new Date()), scope: all ? 'all' : 'own' };
}

/** The signed-in person's logged total for one day, so a form can warn above 12 hours. */
export async function getDayTotal(viewer: SessionUser, date: string): Promise<{ date: string; minutes: number }> {
  assertCapability(viewer, 'worklog:own');
  const day = parseDateOnly(date);
  if (!day) throw validationFailed({ date: 'Enter a valid date' });
  await connectToDatabase();
  const [row] = await WorkLog.aggregate<{ minutes: number }>([{ $match: { adminId: oid(viewer.id), workedOn: day } }, { $group: { _id: null, minutes: { $sum: '$minutes' } } }]);
  return { date: ymd(day), minutes: row?.minutes ?? 0 };
}

/** The most recent entries by one person (My work). Always the viewer's own. */
export async function listMyRecentWorkLogs(viewer: SessionUser, limit = 10): Promise<WorkLogDTO[]> {
  assertCapability(viewer, 'worklog:own');
  await connectToDatabase();
  const settings = await getSettings();
  const rows = await WorkLog.find({ adminId: oid(viewer.id) }).sort({ workedOn: -1, createdAt: -1 }).limit(Math.min(Math.max(limit, 1), 50)).lean();
  return toDTOs(viewer, rows, settings.workLogEditWindowDays, new Date());
}

/** Names for the person and project filters on the all-logs page, so the pickers can show what is selected. */
export async function getFilterLabels(
  viewer: SessionUser,
  ids: { adminId?: string; projectId?: string },
): Promise<{ person: { id: string; label: string } | null; project: { id: string; label: string; ref: string } | null }> {
  assertCapability(viewer, 'worklog:viewAll');
  await connectToDatabase();
  const adminId = ids.adminId ? parseObjectId(ids.adminId) : null;
  const projectId = ids.projectId ? parseObjectId(ids.projectId) : null;
  const [admin, projects] = await Promise.all([
    adminId ? Admin.findById(adminId).select('name').lean() : null,
    projectId ? projectBriefs([oid(projectId)]) : new Map(),
  ]);
  const project = projectId ? projects.get(projectId) : undefined;
  return {
    person: admin ? { id: String(admin._id), label: admin.name } : null,
    project: project ? { id: project.id, label: project.name, ref: project.ref } : null,
  };
}
