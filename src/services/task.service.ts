import { Types, type ClientSession } from 'mongoose';
import { mongoose, connectToDatabase, withTransaction } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { conflict, hasLinkedRecords, linkMismatch, notFound, validationFailed } from '@/lib/api/errors';
import { escapeRegex } from '@/lib/admin/search-params';
import { formatDateOnly, parseDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { TASK_STATUSES, type PRIORITIES, type TaskStatus } from '@/config/statuses';
import { parseObjectId } from '@/lib/validation/common';
import type {
  AssigneeRef,
  ChangeStatusInput,
  CreateTaskInput,
  ReorderInput,
  SetAssigneesInput,
  UpdateTaskInput,
} from '@/lib/validation/task';
import {
  Admin,
  ClientPayment,
  Expense,
  Project,
  Task,
  ThirdParty,
  ThirdPartyPayout,
  WorkLog,
  WorkOrder,
  type ProjectDoc,
  type TaskDoc,
} from '@/models';
import type { TaskAssignee } from '@/models/task.model';
import type { SessionUser } from '@/types/session';
import type { ServiceMeta } from './admin.service';
import { audit, diffFields, type AuditActor, type AuditInput } from './audit.service';
import { nextTaskRef } from './refs';
import { getSettings } from './settings.service';

/**
 * Tasks. A task belongs to one project, and its client is DERIVED from that project on the
 * server (never taken from the request). Every audited change runs in a transaction with its audit
 * entry. `loggedMinutes` is a cache of the work logs; the work-log service keeps it in step.
 *
 * Who may do what (docs/plan section 1): admins and superadmins view, create, edit, assign, move
 * and cancel any task (`task:view`, `task:edit`); only superadmins delete one for good
 * (`task:delete`), and only when nothing links to it.
 */
export type { ServiceMeta };

export const CLOSED_STATUSES: readonly TaskStatus[] = ['done', 'cancelled'];
export const OPEN_STATUSES: readonly TaskStatus[] = TASK_STATUSES.filter((s) => !CLOSED_STATUSES.includes(s));
export const isOpenStatus = (status: TaskStatus) => !CLOSED_STATUSES.includes(status);

const oid = (id: string) => new Types.ObjectId(id);
const snapshot = (v: SessionUser) => ({ id: oid(v.id), name: v.name });
const actorOf = (v: SessionUser): AuditActor => ({ id: v.id, name: v.name, role: v.role });
const ymd = (d?: Date | null) => (d ? formatDateOnly(d) : null);

// ---------------------------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------------------------

export interface TaskAssigneeDTO {
  kind: TaskAssignee['kind'];
  id: string;
  name: string;
  assignedAt: string | null;
}

export interface TaskProjectDTO {
  id: string;
  ref: string;
  name: string;
  clientId: string;
  clientName: string;
  archived: boolean;
}

export interface TaskListItemDTO {
  id: string;
  ref: string;
  title: string;
  status: TaskStatus;
  priority: (typeof PRIORITIES)[number];
  /** "YYYY-MM-DD", a calendar date. */
  dueOn: string | null;
  /** Open and past its due date, in the organisation's time zone. */
  overdue: boolean;
  estimateMinutes: number | null;
  loggedMinutes: number;
  assignees: TaskAssigneeDTO[];
  project: TaskProjectDTO;
  order: number;
  archived: boolean;
  updatedAt: string;
}

export interface TaskStatusHistoryDTO {
  from: TaskStatus | null;
  to: TaskStatus;
  at: string;
  by: string;
  note: string | null;
}

export interface TaskDTO extends TaskListItemDTO {
  description: string | null;
  labels: string[];
  startedAt: string | null;
  completedAt: string | null;
  statusHistory: TaskStatusHistoryDTO[];
  createdBy: string | null;
  createdAt: string;
}

/** One of MY open tasks, with whether I was put on it since my last visit. */
export interface MyTaskDTO extends TaskListItemDTO {
  assignedAt: string | null;
  isNew: boolean;
}

type ProjectBrief = Pick<ProjectDoc, '_id' | 'ref' | 'name' | 'clientId' | 'clientName' | 'archivedAt'>;

export async function projectBriefs(ids: Types.ObjectId[], session?: ClientSession): Promise<Map<string, TaskProjectDTO>> {
  const unique = [...new Set(ids.map(String))].map(oid);
  const out = new Map<string, TaskProjectDTO>();
  if (unique.length === 0) return out;
  const rows: ProjectBrief[] = await Project.find({ _id: mongoose.trusted({ $in: unique }) })
    .select('ref name clientId clientName archivedAt')
    .session(session ?? null)
    .lean();
  for (const p of rows) {
    out.set(String(p._id), { id: String(p._id), ref: p.ref, name: p.name, clientId: String(p.clientId), clientName: p.clientName, archived: Boolean(p.archivedAt) });
  }
  return out;
}

const UNKNOWN_PROJECT = (id: Types.ObjectId): TaskProjectDTO => ({ id: String(id), ref: '', name: 'Unknown project', clientId: '', clientName: '', archived: false });

function toListItem(t: TaskDoc, projects: Map<string, TaskProjectDTO>, today: Date): TaskListItemDTO {
  return {
    id: String(t._id),
    ref: t.ref,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueOn: ymd(t.dueOn),
    overdue: Boolean(t.dueOn && isOpenStatus(t.status) && t.dueOn.getTime() < today.getTime()),
    estimateMinutes: t.estimateMinutes ?? null,
    loggedMinutes: t.loggedMinutes ?? 0,
    assignees: (t.assignees ?? []).map((a) => ({ kind: a.kind, id: String(a.id), name: a.name, assignedAt: a.assignedAt ? a.assignedAt.toISOString() : null })),
    project: projects.get(String(t.projectId)) ?? UNKNOWN_PROJECT(t.projectId),
    order: t.order ?? 0,
    archived: Boolean(t.archivedAt),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function toTaskDTO(t: TaskDoc, projects: Map<string, TaskProjectDTO>, today: Date): TaskDTO {
  return {
    ...toListItem(t, projects, today),
    description: t.description ?? null,
    labels: t.labels ?? [],
    startedAt: t.startedAt ? t.startedAt.toISOString() : null,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    statusHistory: (t.statusHistory ?? []).map((h) => ({ from: h.from ?? null, to: h.to, at: h.at.toISOString(), by: h.by?.name ?? 'Unknown', note: h.note ?? null })),
    createdBy: t.createdBy?.name ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}

async function today(): Promise<Date> {
  return todayDateOnly(new Date(), (await getSettings()).timezone);
}

async function dtoFor(task: TaskDoc, session?: ClientSession): Promise<TaskDTO> {
  return toTaskDTO(task, await projectBriefs([task.projectId], session), await today());
}

// ---------------------------------------------------------------------------------------------
// Loading and shared rules
// ---------------------------------------------------------------------------------------------

async function loadTask(id: string, session: ClientSession): Promise<TaskDoc> {
  const task = await Task.findById(id).session(session).lean();
  if (!task) throw notFound('We could not find that task');
  return task;
}

function assertNotArchived(task: TaskDoc): void {
  if (task.archivedAt) throw conflict('This task is archived. Restore it before changing it.');
}

async function loadOpenProject(id: string, session: ClientSession): Promise<ProjectDoc> {
  const project = await Project.findById(id).session(session).lean();
  if (!project) throw validationFailed({ projectId: 'That project does not exist' });
  if (project.archivedAt) throw conflict('That project is archived. Restore it before adding or moving tasks into it.', { projectId: 'This project is archived' });
  return project;
}

/** Where a task lands when it joins a column: the bottom. */
async function endOfColumn(projectId: Types.ObjectId, status: TaskStatus, session: ClientSession): Promise<number> {
  const last = await Task.findOne({ projectId, status, archivedAt: null }).sort({ order: -1 }).select('order').session(session).lean();
  return (last?.order ?? 0) + 1;
}

/** True when a work log or any money record points at the task: it can then neither move project nor be deleted. */
async function hasLinks(taskId: Types.ObjectId, session: ClientSession): Promise<boolean> {
  const checks = await Promise.all([
    WorkLog.exists({ taskId }).session(session),
    ClientPayment.exists({ taskId }).session(session),
    ThirdPartyPayout.exists({ taskId }).session(session),
    WorkOrder.exists({ taskId }).session(session),
    Expense.exists({ taskId }).session(session),
  ]);
  return checks.some(Boolean);
}

const norm = (id: string) => id.toLowerCase();

/**
 * Turns requested assignees into stored ones. Names always come from the record, never the request.
 * Someone already on the task is kept as they are (even if they have since been deactivated);
 * only NEWLY added people must be active admins or active third parties.
 */
async function resolveAssignees(
  refs: readonly AssigneeRef[],
  existing: readonly TaskAssignee[],
  now: Date,
  session: ClientSession,
): Promise<TaskAssignee[]> {
  const seen = new Set<string>();
  const out: TaskAssignee[] = [];
  for (const ref of refs) {
    if (!/^[a-f\d]{24}$/i.test(ref.id)) throw validationFailed({ assignees: 'One of those people is not valid' });
    const id = norm(ref.id);
    const key = `${ref.kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const kept = existing.find((e) => e.kind === ref.kind && String(e.id) === id);
    if (kept) {
      out.push(kept);
      continue;
    }
    if (ref.kind === 'admin') {
      const admin = await Admin.findOne({ _id: oid(id), status: 'active' }).select('name').session(session).lean();
      if (!admin) throw validationFailed({ assignees: 'One of those people is not an active admin' });
      out.push({ kind: 'admin', id: admin._id, name: admin.name, assignedAt: now });
    } else {
      const party = await ThirdParty.findOne({ _id: oid(id), status: 'active', archivedAt: null }).select('name').session(session).lean();
      if (!party) throw validationFailed({ assignees: 'One of those third parties is not active' });
      out.push({ kind: 'thirdParty', id: party._id, name: party.name, assignedAt: now });
    }
  }
  return out;
}

function auditBase(viewer: SessionUser, task: Pick<TaskDoc, '_id' | 'ref' | 'title' | 'projectId' | 'clientId'>, meta: ServiceMeta) {
  return {
    actor: actorOf(viewer),
    entity: { type: 'task', id: String(task._id), ref: task.ref, label: task.title },
    context: { clientId: String(task.clientId), projectId: String(task.projectId), taskId: String(task._id) },
    meta,
  } satisfies Omit<AuditInput, 'action'>;
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

export const TASK_SORTS = ['updatedAt', 'dueOn', 'createdAt', 'title', 'ref'] as const;
export type TaskSort = (typeof TASK_SORTS)[number];

export interface TaskFilter {
  q?: string;
  /** A status, or `open` for everything not done or cancelled. */
  status?: TaskStatus | 'open';
  priority?: (typeof PRIORITIES)[number];
  projectId?: string;
  clientId?: string;
  assignee?: { kind: TaskAssignee['kind']; id: string } | 'unassigned';
  /** Open and past due. Ignored when `status` is already done or cancelled. */
  overdue?: boolean;
  /** Only archived tasks. By default they are left out. */
  archived?: boolean;
}

export interface TaskSearch extends TaskFilter {
  sort?: TaskSort;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

/**
 * The filter as a raw aggregation `$match`. Built ONLY from parsed values (ids become ObjectIds,
 * search text is escaped), because aggregation stages are not sanitised by Mongoose.
 */
function rawMatch(f: TaskFilter, today: Date): Record<string, unknown> {
  const m: Record<string, unknown> = {};
  m.archivedAt = f.archived ? { $ne: null } : null;
  const closed = f.status === 'done' || f.status === 'cancelled';
  if (f.status === 'open') m.status = { $nin: [...CLOSED_STATUSES] };
  else if (f.status) m.status = f.status;
  if (f.priority) m.priority = f.priority;
  if (f.projectId) m.projectId = oid(parseObjectId(f.projectId));
  if (f.clientId) m.clientId = oid(parseObjectId(f.clientId));
  if (f.assignee === 'unassigned') m['assignees.0'] = { $exists: false };
  else if (f.assignee) m.assignees = { $elemMatch: { kind: f.assignee.kind, id: oid(parseObjectId(f.assignee.id)) } };
  if (f.overdue && !closed) {
    m.dueOn = { $lt: today };
    if (!f.status) m.status = { $nin: [...CLOSED_STATUSES] };
  }
  const q = f.q?.trim().slice(0, 80);
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    m.$or = [{ title: re }, { ref: re }];
  }
  return m;
}

export interface TaskPage {
  items: TaskListItemDTO[];
  total: number;
  page: number;
  pageSize: number;
}

/** The task list: filtered, sorted and paged. Undated tasks sort last whichever way the due date runs. */
export async function searchTasks(viewer: SessionUser, params: TaskSearch = {}): Promise<TaskPage> {
  assertCapability(viewer, 'task:view');
  await connectToDatabase();
  const day = await today();
  const pageSize = Math.min(Math.max(params.pageSize ?? 25, 1), 100);
  const page = Math.max(params.page ?? 1, 1);
  const dir = (params.dir ?? (params.sort === 'title' || params.sort === 'ref' ? 'asc' : 'desc')) === 'asc' ? 1 : -1;
  const sort = params.sort && (TASK_SORTS as readonly string[]).includes(params.sort) ? params.sort : 'updatedAt';

  const sortStage: Record<string, 1 | -1> = sort === 'dueOn' ? { _due: dir } : { [sort]: dir };
  sortStage._id = 1;

  const [result] = await Task.aggregate<{ rows: TaskDoc[]; total: Array<{ n: number }> }>([
    { $match: rawMatch(params, day) },
    {
      $facet: {
        rows: [
          { $addFields: { _due: { $ifNull: ['$dueOn', dir === 1 ? new Date('9999-12-31') : new Date('1000-01-01')] } } },
          { $sort: sortStage },
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
        ],
        total: [{ $count: 'n' }],
      },
    },
  ]);
  const rows = result?.rows ?? [];
  const projects = await projectBriefs(rows.map((r) => r.projectId));
  return { items: rows.map((r) => toListItem(r, projects, day)), total: result?.total[0]?.n ?? 0, page, pageSize };
}

export interface BoardColumn {
  status: TaskStatus;
  total: number;
  tasks: TaskListItemDTO[];
}

/**
 * The board: one column per status. Each column shows its first `perColumn` tasks (board order
 * for open columns, most recently changed for done and cancelled) and its true total, so a long
 * column says "showing 30 of 120" instead of silently truncating.
 */
export async function getBoard(
  viewer: SessionUser,
  filter: Omit<TaskFilter, 'status' | 'archived' | 'overdue'> = {},
  perColumn = 30,
): Promise<BoardColumn[]> {
  assertCapability(viewer, 'task:view');
  await connectToDatabase();
  const day = await today();
  const limit = Math.min(Math.max(perColumn, 1), 100);
  const facets: Record<string, object[]> = {};
  for (const status of TASK_STATUSES) {
    const closed = !isOpenStatus(status);
    facets[status] = [
      { $match: { status } },
      { $sort: closed ? { updatedAt: -1, _id: 1 } : { order: 1, updatedAt: -1, _id: 1 } },
      { $limit: limit },
    ];
  }
  const [result] = await Task.aggregate<Record<string, TaskDoc[]> & { counts: Array<{ _id: TaskStatus; n: number }> }>([
    { $match: rawMatch(filter, day) },
    { $facet: { ...facets, counts: [{ $group: { _id: '$status', n: { $sum: 1 } } }] } },
  ]);
  const all = TASK_STATUSES.flatMap((s) => result?.[s] ?? []);
  const projects = await projectBriefs(all.map((t) => t.projectId));
  const totals = new Map((result?.counts ?? []).map((c) => [c._id, c.n]));
  return TASK_STATUSES.map((status) => ({
    status,
    total: totals.get(status) ?? 0,
    tasks: (result?.[status] ?? []).map((t) => toListItem(t, projects, day)),
  }));
}

export async function getTask(viewer: SessionUser, id: string): Promise<TaskDTO> {
  assertCapability(viewer, 'task:view');
  await connectToDatabase();
  const task = await Task.findById(parseObjectId(id)).lean();
  if (!task) throw notFound('We could not find that task');
  return dtoFor(task);
}

/** A project's name for a picker that shows the current filter or default. Null when it does not exist. */
export async function getProjectLabel(viewer: SessionUser, projectId: string): Promise<{ id: string; label: string; ref: string } | null> {
  assertCapability(viewer, 'task:view');
  await connectToDatabase();
  const brief = (await projectBriefs([oid(parseObjectId(projectId))])).get(parseObjectId(projectId));
  return brief ? { id: brief.id, label: brief.name, ref: brief.ref } : null;
}

/** Open tasks assigned to the signed-in admin, soonest due first. `since` is their last visit to My work. */
export async function listMyTasks(viewer: SessionUser, options: { since?: Date | null } = {}): Promise<{ tasks: MyTaskDTO[]; newCount: number }> {
  assertCapability(viewer, 'task:view');
  await connectToDatabase();
  const day = await today();
  const me = oid(viewer.id);
  const rows = await Task.find({
    archivedAt: null,
    status: mongoose.trusted({ $nin: [...CLOSED_STATUSES] }),
    assignees: mongoose.trusted({ $elemMatch: { kind: 'admin', id: me } }),
  })
    .sort({ updatedAt: -1 })
    .limit(200)
    .lean();
  const projects = await projectBriefs(rows.map((r) => r.projectId));
  const since = options.since ?? null;
  const tasks = rows.map((r): MyTaskDTO => {
    const mine = r.assignees.find((a) => a.kind === 'admin' && a.id.equals(me));
    const assignedAt = mine?.assignedAt ?? null;
    return { ...toListItem(r, projects, day), assignedAt: assignedAt ? assignedAt.toISOString() : null, isNew: Boolean(since && assignedAt && assignedAt.getTime() > since.getTime()) };
  });
  // Soonest due first, undated last; ties keep the most recently touched first.
  tasks.sort((a, b) => (a.dueOn ?? '9999-12-31').localeCompare(b.dueOn ?? '9999-12-31'));
  return { tasks, newCount: tasks.filter((t) => t.isNew).length };
}

/** How many open tasks were assigned to this admin after `since` (for a sidebar badge). */
export async function countNewlyAssigned(viewer: SessionUser, since: Date | null): Promise<number> {
  if (!since) return 0;
  await connectToDatabase();
  return Task.countDocuments({
    archivedAt: null,
    status: mongoose.trusted({ $nin: [...CLOSED_STATUSES] }),
    assignees: mongoose.trusted({ $elemMatch: { kind: 'admin', id: oid(viewer.id), assignedAt: { $gt: since } } }),
  });
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

export async function createTask(viewer: SessionUser, input: CreateTaskInput, meta: ServiceMeta = {}): Promise<TaskDTO> {
  assertCapability(viewer, 'task:edit');
  const projectId = parseObjectId(input.projectId);
  const status = input.status ?? 'todo';
  const dueOn = input.dueOn ? parseDateOnly(input.dueOn) : undefined;
  if (input.dueOn && !dueOn) throw validationFailed({ dueOn: 'Enter a valid date' });

  return withTransaction(async (session) => {
    const project = await loadOpenProject(projectId, session);
    // The client is whoever owns the project. A request that names a different one is wrong, not "fixed".
    if (input.clientId && norm(input.clientId) !== String(project.clientId)) {
      throw linkMismatch('That client does not own this project', { clientId: 'This project belongs to a different client' });
    }
    const now = new Date();
    const assignees = await resolveAssignees(input.assignees ?? [], [], now, session);
    const ref = await nextTaskRef(project.ref, session);
    const by = snapshot(viewer);
    const [created] = await Task.create(
      [
        {
          ref,
          projectId: project._id,
          clientId: project.clientId,
          title: input.title,
          description: input.description || undefined,
          status,
          priority: input.priority ?? 'medium',
          assignees,
          estimateMinutes: input.estimateMinutes ?? undefined,
          dueOn: dueOn ?? undefined,
          startedAt: status === 'in_progress' ? now : undefined,
          order: await endOfColumn(project._id, status, session),
          labels: input.labels ?? [],
          loggedMinutes: 0,
          statusHistory: [{ from: null, to: status, at: now, by }],
          createdBy: by,
        },
      ],
      { session },
    );
    if (!created) throw new Error('Task was not created');
    await audit(
      {
        ...auditBase(viewer, created, meta),
        action: 'task.create',
        summary: `Created in ${project.ref}`,
        changes: [
          { path: 'status', after: status },
          ...(assignees.length ? [{ path: 'assignees', after: assignees.map((a) => a.name) }] : []),
        ],
      },
      session,
    );
    return dtoFor(created.toObject(), session);
  });
}

const TRACKED = ['ref', 'projectId', 'clientId', 'title', 'description', 'priority', 'estimateMinutes', 'dueOn', 'labels'] as const;
const trackable = (t: TaskDoc): Record<string, unknown> => ({
  ref: t.ref,
  projectId: String(t.projectId),
  clientId: String(t.clientId),
  title: t.title,
  description: t.description ?? null,
  priority: t.priority,
  estimateMinutes: t.estimateMinutes ?? null,
  dueOn: ymd(t.dueOn),
  labels: t.labels ?? [],
});

export async function updateTask(viewer: SessionUser, id: string, patch: UpdateTaskInput, meta: ServiceMeta = {}): Promise<TaskDTO> {
  assertCapability(viewer, 'task:edit');
  id = parseObjectId(id);
  const dueOn = patch.dueOn ? parseDateOnly(patch.dueOn) : patch.dueOn;
  if (patch.dueOn && !dueOn) throw validationFailed({ dueOn: 'Enter a valid date' });

  return withTransaction(async (session) => {
    const task = await loadTask(id, session);
    assertNotArchived(task);
    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};

    if (patch.projectId !== undefined && parseObjectId(patch.projectId) !== String(task.projectId)) {
      if (await hasLinks(task._id, session)) {
        throw hasLinkedRecords('This task already has time logged or money recorded against it, so it cannot move to another project.');
      }
      const target = await loadOpenProject(parseObjectId(patch.projectId), session);
      set.projectId = target._id;
      set.clientId = target.clientId; // derived from the new project
      set.ref = await nextTaskRef(target.ref, session); // the reference carries the project's, so it follows
      set.order = await endOfColumn(target._id, task.status, session);
    }
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.description !== undefined) {
      if (patch.description) set.description = patch.description;
      else unset.description = 1;
    }
    if (patch.priority !== undefined) set.priority = patch.priority;
    if (patch.estimateMinutes !== undefined) {
      if (patch.estimateMinutes === null) unset.estimateMinutes = 1;
      else set.estimateMinutes = patch.estimateMinutes;
    }
    if (patch.dueOn !== undefined) {
      if (dueOn) set.dueOn = dueOn;
      else unset.dueOn = 1;
    }
    if (patch.labels !== undefined) set.labels = patch.labels;

    // Work out what would change BEFORE writing: a request that changes nothing writes nothing (no
    // updatedAt bump, no audit entry), so every write that does happen is one the log explains.
    const prospective = { ...task, ...set } as TaskDoc;
    for (const key of Object.keys(unset)) delete (prospective as unknown as Record<string, unknown>)[key];
    const changes = diffFields(trackable(task), trackable(prospective), TRACKED);
    if (changes.length === 0) return dtoFor(task, session);

    set.updatedBy = snapshot(viewer);
    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length) update.$unset = unset;
    const after = await Task.findOneAndUpdate({ _id: task._id }, update, { returnDocument: 'after', session, runValidators: true }).lean();
    if (!after) throw notFound('We could not find that task');
    await audit({ ...auditBase(viewer, after, meta), action: 'task.update', changes }, session);
    return dtoFor(after, session);
  });
}

/**
 * Moves a task to another status. Rules: moving AWAY from done or cancelled (a reopen) needs a
 * note, and so does cancelling. `startedAt` is set on the first move to in progress and kept;
 * `completedAt` is set on done and cleared when the task leaves done. Every move is kept in
 * `statusHistory`. The task lands at the bottom of its new column.
 */
export async function changeTaskStatus(viewer: SessionUser, id: string, input: ChangeStatusInput, meta: ServiceMeta = {}): Promise<TaskDTO> {
  assertCapability(viewer, 'task:edit');
  id = parseObjectId(id);
  if (!(TASK_STATUSES as readonly string[]).includes(input.status)) throw validationFailed({ status: 'Pick a status' });

  return withTransaction(async (session) => {
    const task = await loadTask(id, session);
    assertNotArchived(task);
    const from = task.status;
    const to = input.status;
    if (from === to) throw validationFailed({ status: 'The task is already in that status' });
    const reopening = !isOpenStatus(from);
    const note = input.note?.trim() || undefined;
    if (!note && reopening) throw validationFailed({ note: 'Say why you are reopening this task' });
    if (!note && to === 'cancelled') throw validationFailed({ note: 'Say why you are cancelling this task' });

    const now = new Date();
    const by = snapshot(viewer);
    const set: Record<string, unknown> = { status: to, updatedBy: by, order: await endOfColumn(task.projectId, to, session) };
    const unset: Record<string, 1> = {};
    if (to === 'in_progress' && !task.startedAt) set.startedAt = now;
    if (to === 'done') set.completedAt = now;
    else if (task.completedAt) unset.completedAt = 1;

    const update: Record<string, unknown> = { $set: set, $push: { statusHistory: { from, to, at: now, by, note } } };
    if (Object.keys(unset).length) update.$unset = unset;
    // Guarded on the status we read, so two people moving the same card cannot both "win".
    const after = await Task.findOneAndUpdate({ _id: task._id, status: from }, update, { returnDocument: 'after', session, runValidators: true }).lean();
    if (!after) throw conflict('Someone else just changed this task. Reload and try again.');

    await audit(
      {
        ...auditBase(viewer, after, meta),
        action: 'task.status',
        summary: note,
        changes: [{ path: 'status', before: from, after: to }],
      },
      session,
    );
    return dtoFor(after, session);
  });
}

/** Cancelling is a status move that must say why. */
export function cancelTask(viewer: SessionUser, id: string, note: string, meta: ServiceMeta = {}): Promise<TaskDTO> {
  return changeTaskStatus(viewer, id, { status: 'cancelled', note }, meta);
}

/**
 * Replaces who is on the task. New people must be active admins or active third parties; names
 * come from the records. Each person added or removed is its own audit entry, with the task,
 * project and client in context. No change means no write and no audit entry.
 */
export async function setAssignees(viewer: SessionUser, id: string, input: SetAssigneesInput, meta: ServiceMeta = {}): Promise<TaskDTO> {
  assertCapability(viewer, 'task:edit');
  id = parseObjectId(id);

  return withTransaction(async (session) => {
    const task = await loadTask(id, session);
    assertNotArchived(task);
    const now = new Date();
    const next = await resolveAssignees(input.assignees, task.assignees ?? [], now, session);
    const keyOf = (a: Pick<TaskAssignee, 'kind' | 'id'>) => `${a.kind}:${String(a.id)}`;
    const before = new Set((task.assignees ?? []).map(keyOf));
    const after = new Set(next.map(keyOf));
    const added = next.filter((a) => !before.has(keyOf(a)));
    const removed = (task.assignees ?? []).filter((a) => !after.has(keyOf(a)));
    if (added.length === 0 && removed.length === 0) return dtoFor(task, session);

    const updated = await Task.findOneAndUpdate({ _id: task._id }, { $set: { assignees: next, updatedBy: snapshot(viewer) } }, { returnDocument: 'after', session }).lean();
    if (!updated) throw notFound('We could not find that task');
    for (const a of added) {
      await audit({ ...auditBase(viewer, updated, meta), action: 'task.assign', summary: `Assigned ${a.name}`, changes: [{ path: 'assignees', after: { kind: a.kind, id: String(a.id), name: a.name } }] }, session);
    }
    for (const a of removed) {
      await audit({ ...auditBase(viewer, updated, meta), action: 'task.unassign', summary: `Removed ${a.name}`, changes: [{ path: 'assignees', before: { kind: a.kind, id: String(a.id), name: a.name } }] }, session);
    }
    return dtoFor(updated, session);
  });
}

/**
 * Sets the order of a board column. `orderedIds` lists the column top to bottom; tasks of the
 * column that are not listed keep their relative order after those. Every id must belong to this
 * project and status (a task cannot be smuggled into another column through here).
 */
export async function reorderTasks(viewer: SessionUser, input: ReorderInput, meta: ServiceMeta = {}): Promise<{ orderedIds: string[] }> {
  assertCapability(viewer, 'task:edit');
  const projectId = parseObjectId(input.projectId);

  return withTransaction(async (session) => {
    const project = await Project.findById(projectId).session(session).lean();
    if (!project) throw notFound('We could not find that project');
    const requested = [...new Set(input.orderedIds.map(parseObjectId))];
    const column = await Task.find({ projectId: project._id, status: input.status, archivedAt: null })
      .sort({ order: 1, createdAt: 1 })
      .select('_id order')
      .session(session)
      .lean();
    const members = new Map(column.map((t) => [String(t._id), t.order ?? 0]));
    if (requested.some((rid) => !members.has(rid))) {
      throw linkMismatch('Some of those tasks are not in this column', { orderedIds: 'Reload the board and try again' });
    }
    const listed = new Set(requested);
    const finalOrder = [...requested, ...column.map((t) => String(t._id)).filter((tid) => !listed.has(tid))];
    const ops = finalOrder.flatMap((tid, i) => (members.get(tid) === i + 1 ? [] : [{ updateOne: { filter: { _id: oid(tid) }, update: { $set: { order: i + 1 } } } }]));
    if (ops.length > 0) {
      // A shuffle is not an edit: it must not push every card to the top of "recently updated".
      await Task.bulkWrite(ops, { session, timestamps: false });
      await audit(
        {
          actor: actorOf(viewer),
          action: 'task.reorder',
          entity: { type: 'project', id: String(project._id), ref: project.ref, label: project.name },
          summary: `Reordered ${ops.length} ${ops.length === 1 ? 'task' : 'tasks'} in ${input.status.replaceAll('_', ' ')}`,
          context: { clientId: String(project.clientId), projectId: String(project._id) },
          meta,
        },
        session,
      );
    }
    return { orderedIds: finalOrder };
  });
}

/** Archive instead of delete: the task and its time stay, and it leaves lists, boards and dashboards. */
export async function archiveTask(viewer: SessionUser, id: string, meta: ServiceMeta = {}): Promise<TaskDTO> {
  assertCapability(viewer, 'task:edit');
  id = parseObjectId(id);
  return withTransaction(async (session) => {
    const task = await loadTask(id, session);
    if (task.archivedAt) throw conflict('That task is already archived');
    const after = await Task.findOneAndUpdate({ _id: task._id }, { $set: { archivedAt: new Date(), archivedBy: snapshot(viewer), updatedBy: snapshot(viewer) } }, { returnDocument: 'after', session }).lean();
    if (!after) throw notFound('We could not find that task');
    await audit({ ...auditBase(viewer, after, meta), action: 'task.archive', changes: [{ path: 'archived', before: false, after: true }] }, session);
    return dtoFor(after, session);
  });
}

export async function restoreTask(viewer: SessionUser, id: string, meta: ServiceMeta = {}): Promise<TaskDTO> {
  assertCapability(viewer, 'task:edit');
  id = parseObjectId(id);
  return withTransaction(async (session) => {
    const task = await loadTask(id, session);
    if (!task.archivedAt) throw conflict('That task is not archived');
    const project = await Project.findById(task.projectId).select('archivedAt').session(session).lean();
    if (project?.archivedAt) throw conflict('Restore the project first: it is archived.');
    const after = await Task.findOneAndUpdate(
      { _id: task._id },
      { $unset: { archivedAt: 1, archivedBy: 1 }, $set: { updatedBy: snapshot(viewer), order: await endOfColumn(task.projectId, task.status, session) } },
      { returnDocument: 'after', session },
    ).lean();
    if (!after) throw notFound('We could not find that task');
    await audit({ ...auditBase(viewer, after, meta), action: 'task.restore', changes: [{ path: 'archived', before: true, after: false }] }, session);
    return dtoFor(after, session);
  });
}

/**
 * Permanent delete: superadmins only, and only when nothing links to the task (no work log, no
 * payment, payout, work order or expense). Anything else is archived instead.
 */
export async function deleteTask(viewer: SessionUser, id: string, meta: ServiceMeta = {}): Promise<{ id: string }> {
  assertCapability(viewer, 'task:delete');
  id = parseObjectId(id);
  return withTransaction(async (session) => {
    const task = await loadTask(id, session);
    if (await hasLinks(task._id, session)) throw hasLinkedRecords('This task has time logged or money recorded against it, so it cannot be deleted. Archive it instead.');
    const result = await Task.deleteOne({ _id: task._id }, { session });
    // The delete is a write on the task: a work log being added at the same moment conflicts with it and one of them retries.
    if (result.deletedCount !== 1) throw notFound('We could not find that task');
    await audit({ ...auditBase(viewer, task, meta), action: 'task.delete', summary: `Deleted ${task.ref}`, changes: [{ path: 'status', before: task.status }] }, session);
    return { id };
  });
}
