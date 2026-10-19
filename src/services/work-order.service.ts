import { Types, type ClientSession, type PipelineStage } from 'mongoose';
import { mongoose, connectToDatabase, withTransaction } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { conflict, linkMismatch, notFound, validationFailed } from '@/lib/api/errors';
import { escapeRegex, pageMeta, type PageMeta } from '@/lib/admin/search-params';
import { formatDateOnly, parseDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { formatMinor } from '@/lib/money/minor';
import { parseObjectId, fieldErrors } from '@/lib/validation/common';
import {
  CURRENT_STATUSES,
  WORK_ORDER_SORTS,
  WORK_ORDER_TRANSITIONS,
  createWorkOrderSchema,
  updateWorkOrderSchema,
  workOrderStatusSchema,
  type CreateWorkOrderInput,
  type UpdateWorkOrderInput,
  type WorkOrderFilter,
  type WorkOrderSort,
  type WorkOrderStatus,
  type WorkOrderStatusInput,
} from '@/lib/validation/work-order';
import { Project, Task, ThirdParty, ThirdPartyPayout, WorkOrder, type ProjectDoc, type TaskDoc, type WorkOrderDoc } from '@/models';
import type { SessionUser } from '@/types/session';
import type { ServiceMeta } from './admin.service';
import { audit, diffFields, type AuditActor } from './audit.service';
import { nextRef } from './refs';
import { getSettings, loadSettings } from './settings.service';
import { projectBriefs, type TaskProjectDTO } from './task.service';

/**
 * Work orders: what we agreed to pay a third party for a client's project (and optionally one task).
 *
 * Who may do what (docs/plan section 1): `payout:view` reads, `payout:record` creates, edits and moves
 * them. The CLIENT is derived from the project on the server; a request that names another is refused
 * as LINK_MISMATCH. `paidMinor` and `dueMinor` are caches of the linked payouts, in the work order's own
 * currency (a payout must match it), and are rewritten from the payouts in the SAME transaction as
 * every payout write (`refreshWorkOrderSums`, called by the payout service). A status change, a payout
 * write and an edit all WRITE the work order document first, so two of them at once conflict, one
 * retries, and the retry re-reads the truth.
 */
export type { ServiceMeta };

const oid = (id: string) => new Types.ObjectId(id);
const snapshot = (v: SessionUser) => ({ id: oid(v.id), name: v.name });
const actorOf = (v: SessionUser): AuditActor => ({ id: v.id, name: v.name, role: v.role });
const ymd = (d?: Date | null) => (d ? formatDateOnly(d) : null);

/** "USD 1,000.00" for messages. */
export const fmtMoney = (amountMinor: number, currency: string) => formatMinor(amountMinor, currency, currency === 'INR' ? 'en-IN' : 'en-US');

export const isCurrentStatus = (s: WorkOrderStatus) => CURRENT_STATUSES.includes(s);

// ---------------------------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------------------------

export interface WorkOrderListItemDTO {
  id: string;
  ref: string;
  title: string;
  thirdPartyId: string;
  thirdPartyName: string;
  clientId: string;
  clientName: string;
  projectId: string;
  projectRef: string;
  projectName: string;
  taskId: string | null;
  taskRef: string | null;
  taskTitle: string | null;
  agreed: { amountMinor: number; currency: string };
  /** Sum of paid payouts, in the work order's currency. A cache the payout service keeps. */
  paidMinor: number;
  /** Sum of payouts that are due, in the work order's currency. */
  dueMinor: number;
  /** Agreed less paid less due: what is still to be recorded. Negative when more than the agreed amount is on record. */
  balanceMinor: number;
  /** "YYYY-MM-DD" */
  dueOn: string | null;
  /** Still open or delivered and past its due date, in the organisation's time zone. */
  overdue: boolean;
  status: WorkOrderStatus;
  updatedAt: string;
}

export interface WorkOrderDTO extends WorkOrderListItemDTO {
  scope: string | null;
  statusHistory: Array<{ from: WorkOrderStatus | null; to: WorkOrderStatus; at: string; by: string; note: string | null }>;
  createdBy: string | null;
  createdAt: string;
}

export interface LinkBriefs {
  projects: Map<string, TaskProjectDTO>;
  tasks: Map<string, { ref: string; title: string }>;
}

/** Names for the project and task ids on a page of records, in two queries. */
export async function loadLinkBriefs(projectIds: Types.ObjectId[], taskIds: Array<Types.ObjectId | undefined>, session?: ClientSession): Promise<LinkBriefs> {
  const projects = await projectBriefs(projectIds, session);
  const wanted = [...new Set(taskIds.filter((t): t is Types.ObjectId => Boolean(t)).map(String))].map(oid);
  const tasks = new Map<string, { ref: string; title: string }>();
  if (wanted.length > 0) {
    const rows = await Task.find({ _id: mongoose.trusted({ $in: wanted }) })
      .select('ref title')
      .session(session ?? null)
      .lean();
    for (const t of rows) tasks.set(String(t._id), { ref: t.ref, title: t.title });
  }
  return { projects, tasks };
}

const UNKNOWN: TaskProjectDTO = { id: '', ref: '', name: 'Unknown project', clientId: '', clientName: '', archived: false };

function toListItem(w: WorkOrderDoc, briefs: LinkBriefs, today: Date): WorkOrderListItemDTO {
  const project = briefs.projects.get(String(w.projectId)) ?? { ...UNKNOWN, id: String(w.projectId), clientId: String(w.clientId) };
  const task = w.taskId ? briefs.tasks.get(String(w.taskId)) : undefined;
  return {
    id: String(w._id),
    ref: w.ref,
    title: w.title,
    thirdPartyId: String(w.thirdPartyId),
    thirdPartyName: w.thirdPartyName,
    clientId: String(w.clientId),
    clientName: project.clientName,
    projectId: String(w.projectId),
    projectRef: project.ref,
    projectName: project.name,
    taskId: w.taskId ? String(w.taskId) : null,
    taskRef: task?.ref ?? null,
    taskTitle: task?.title ?? null,
    agreed: { amountMinor: w.agreed.amountMinor, currency: w.agreed.currency },
    paidMinor: w.paidMinor ?? 0,
    dueMinor: w.dueMinor ?? 0,
    balanceMinor: w.agreed.amountMinor - (w.paidMinor ?? 0) - (w.dueMinor ?? 0),
    dueOn: ymd(w.dueOn),
    overdue: Boolean(w.dueOn && isCurrentStatus(w.status) && w.dueOn.getTime() < today.getTime()),
    status: w.status,
    updatedAt: w.updatedAt.toISOString(),
  };
}

function toDTO(w: WorkOrderDoc, briefs: LinkBriefs, today: Date): WorkOrderDTO {
  return {
    ...toListItem(w, briefs, today),
    scope: w.scope ?? null,
    statusHistory: (w.statusHistory ?? []).map((h) => ({ from: h.from ?? null, to: h.to, at: h.at.toISOString(), by: h.by?.name ?? 'Unknown', note: h.note ?? null })),
    createdBy: w.createdBy?.name ?? null,
    createdAt: w.createdAt.toISOString(),
  };
}

async function today(): Promise<Date> {
  return todayDateOnly(new Date(), (await getSettings()).timezone);
}

async function dtoFor(w: WorkOrderDoc, session?: ClientSession): Promise<WorkOrderDTO> {
  const briefs = await loadLinkBriefs([w.projectId], [w.taskId], session);
  return toDTO(w, briefs, await today());
}

// ---------------------------------------------------------------------------------------------
// Shared rules (the payout service uses these too)
// ---------------------------------------------------------------------------------------------

/** A project new money can be recorded against: it must exist and must not be archived. */
export async function loadOpenProject(id: string, session: ClientSession): Promise<ProjectDoc> {
  const project = await Project.findById(id).session(session).lean();
  if (!project) throw validationFailed({ projectId: 'That project does not exist' });
  if (project.archivedAt) {
    throw conflict('That project is archived. Restore it before recording money against it.', { projectId: 'This project is archived' });
  }
  return project;
}

/**
 * The task a NEW money link names: it must exist, belong to the project (LINK_MISMATCH otherwise) and
 * not be cancelled or archived. The task document is TOUCHED so a task move or delete running at the
 * same moment conflicts with this write instead of slipping past it.
 */
export async function claimTask(
  taskId: string,
  project: Pick<ProjectDoc, '_id'>,
  session: ClientSession,
  options: { requireOpen?: boolean } = {},
): Promise<TaskDoc> {
  const task = await Task.findById(parseObjectId(taskId)).session(session).lean();
  if (!task) throw validationFailed({ taskId: 'That task does not exist' });
  if (String(task.projectId) !== String(project._id)) {
    throw linkMismatch('That task belongs to a different project', { taskId: 'This task is not in the chosen project' });
  }
  if (options.requireOpen !== false && (task.status === 'cancelled' || task.archivedAt)) {
    throw conflict('That task is cancelled or archived, so no new money can be linked to it.', { taskId: 'This task is cancelled or archived' });
  }
  await Task.updateOne({ _id: task._id }, { $currentDate: { updatedAt: true } }, { session, timestamps: false });
  return task;
}

/** Writes the work order (a no-op change to `updatedAt`) so concurrent writers on it conflict and one retries. */
export async function touchWorkOrder(id: Types.ObjectId, session: ClientSession): Promise<WorkOrderDoc> {
  const wo = await WorkOrder.findOneAndUpdate({ _id: id }, { $currentDate: { updatedAt: true } }, { returnDocument: 'after', session, timestamps: false }).lean();
  if (!wo) throw notFound('We could not find that work order');
  return wo;
}

/**
 * Rewrites `paidMinor` and `dueMinor` from the payouts that refer to the work order. Called inside the
 * transaction of every payout write, AFTER that write, so the sums include it. Void payouts count for
 * nothing. Returns the new sums.
 */
export async function refreshWorkOrderSums(workOrderId: Types.ObjectId, session: ClientSession): Promise<{ paidMinor: number; dueMinor: number }> {
  const rows = await ThirdPartyPayout.aggregate<{ _id: 'paid' | 'due'; total: number }>([
    { $match: { workOrderId, status: { $in: ['paid', 'due'] } } },
    { $group: { _id: '$status', total: { $sum: '$amount.amountMinor' } } },
  ]).session(session);
  const by = new Map(rows.map((r) => [r._id, r.total]));
  const sums = { paidMinor: by.get('paid') ?? 0, dueMinor: by.get('due') ?? 0 };
  const result = await WorkOrder.updateOne({ _id: workOrderId }, { $set: sums, $currentDate: { updatedAt: true } }, { session, timestamps: false });
  if (result.matchedCount !== 1) throw notFound('We could not find that work order');
  return sums;
}

/** A pre-computed warning, never an error: money that is on record can exceed what was agreed. */
export function overrunWarning(wo: Pick<WorkOrderDoc, 'agreed' | 'paidMinor' | 'dueMinor'>, extraMinor = 0): string | null {
  const committed = (wo.paidMinor ?? 0) + (wo.dueMinor ?? 0) + extraMinor;
  if (committed <= wo.agreed.amountMinor) return null;
  const { currency } = wo.agreed;
  return `That is ${fmtMoney(committed - wo.agreed.amountMinor, currency)} more than the ${fmtMoney(wo.agreed.amountMinor, currency)} agreed on this work order.`;
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/**
 * Pages a raw aggregation: a count, then the clamped page. `nullable` puts records WITHOUT that field last
 * whichever way the sort runs. Aggregation stages are not sanitised by Mongoose, so every `$match`
 * handed in is built from parsed values only (ObjectIds, Dates, escaped patterns).
 */
export async function pagedAggregate<T>(
  run: (pipeline: PipelineStage[]) => Promise<unknown[]>,
  match: Record<string, unknown>,
  sort: { key: string; dir: 1 | -1; nullable?: boolean },
  paging: { page: number; pageSize: number },
): Promise<{ rows: T[]; meta: PageMeta }> {
  const counted = (await run([{ $match: match }, { $count: 'n' }])) as Array<{ n: number }>;
  const meta = pageMeta(paging.page, paging.pageSize, counted[0]?.n ?? 0);
  const stages: PipelineStage[] = [{ $match: match }];
  const sortStage: Record<string, 1 | -1> = {};
  if (sort.nullable) {
    stages.push({ $addFields: { _sortKey: { $ifNull: [`$${sort.key}`, sort.dir === 1 ? new Date('9999-12-31') : new Date('1000-01-01')] } } });
    sortStage._sortKey = sort.dir;
  } else {
    sortStage[sort.key] = sort.dir;
  }
  sortStage._id = 1;
  stages.push({ $sort: sortStage }, { $skip: (meta.page - 1) * paging.pageSize }, { $limit: paging.pageSize });
  return { rows: (await run(stages)) as T[], meta };
}

export interface WorkOrderSearch extends WorkOrderFilter {
  sort?: WorkOrderSort;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

function rawMatch(f: WorkOrderFilter): Record<string, unknown> {
  const m: Record<string, unknown> = {};
  if (f.status === 'current') m.status = { $in: [...CURRENT_STATUSES] };
  else if (f.status) m.status = f.status;
  if (f.thirdPartyId) m.thirdPartyId = oid(parseObjectId(f.thirdPartyId));
  if (f.projectId) m.projectId = oid(parseObjectId(f.projectId));
  if (f.clientId) m.clientId = oid(parseObjectId(f.clientId));
  const q = f.q?.trim().slice(0, 80);
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    m.$or = [{ title: re }, { ref: re }, { thirdPartyName: re }];
  }
  return m;
}

/** The work-order list: filtered, sorted and paged. Needs `payout:view`. */
export async function searchWorkOrders(viewer: SessionUser, params: WorkOrderSearch = {}): Promise<{ items: WorkOrderListItemDTO[]; meta: PageMeta }> {
  assertCapability(viewer, 'payout:view');
  await connectToDatabase();
  const sort = params.sort && WORK_ORDER_SORTS.includes(params.sort) ? params.sort : 'updatedAt';
  const defaultDir = sort === 'ref' || sort === 'title' || sort === 'dueOn' ? 'asc' : 'desc';
  const dir = (params.dir ?? defaultDir) === 'asc' ? 1 : -1;
  const pageSize = Math.min(Math.max(params.pageSize ?? 25, 1), 100);
  const { rows, meta } = await pagedAggregate<WorkOrderDoc>((p) => WorkOrder.aggregate(p), rawMatch(params), { key: sort, dir, nullable: sort === 'dueOn' }, { page: Math.max(params.page ?? 1, 1), pageSize });
  const briefs = await loadLinkBriefs(rows.map((r) => r.projectId), rows.map((r) => r.taskId));
  const day = await today();
  return { items: rows.map((r) => toListItem(r, briefs, day)), meta };
}

export async function getWorkOrder(viewer: SessionUser, id: string): Promise<WorkOrderDTO> {
  assertCapability(viewer, 'payout:view');
  await connectToDatabase();
  const wo = await WorkOrder.findById(parseObjectId(id)).lean();
  if (!wo) throw notFound('We could not find that work order');
  return dtoFor(wo);
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

function auditBase(viewer: SessionUser, wo: Pick<WorkOrderDoc, '_id' | 'ref' | 'title' | 'clientId' | 'projectId' | 'taskId'>, meta: ServiceMeta) {
  return {
    actor: actorOf(viewer),
    entity: { type: 'workOrder', id: String(wo._id), ref: wo.ref, label: wo.title },
    context: { clientId: String(wo.clientId), projectId: String(wo.projectId), ...(wo.taskId ? { taskId: String(wo.taskId) } : {}) },
    meta,
  };
}

function parseDay(value: string, field: string): Date {
  const d = parseDateOnly(value);
  if (!d) throw validationFailed({ [field]: 'Enter a valid date' });
  return d;
}

export async function createWorkOrder(viewer: SessionUser, input: CreateWorkOrderInput, meta: ServiceMeta = {}): Promise<WorkOrderDTO> {
  assertCapability(viewer, 'payout:record');
  const parsed = createWorkOrderSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const body = parsed.data;
  const thirdPartyId = parseObjectId(body.thirdPartyId);
  const projectId = parseObjectId(body.projectId);
  const dueOn = body.dueOn ? parseDay(body.dueOn, 'dueOn') : undefined;

  return withTransaction(async (session) => {
    const party = await ThirdParty.findById(thirdPartyId).session(session).lean();
    if (!party || party.archivedAt || party.status !== 'active') {
      throw validationFailed({ thirdPartyId: 'Pick a third party that is active and not archived' });
    }
    const project = await loadOpenProject(projectId, session);
    // The client is whoever owns the project. A request that names a different one is wrong, not "fixed".
    if (body.clientId && parseObjectId(body.clientId) !== String(project.clientId)) {
      throw linkMismatch('That client does not own this project', { clientId: 'This project belongs to a different client' });
    }
    const task = body.taskId ? await claimTask(body.taskId, project, session) : undefined;

    const settings = await loadSettings(session);
    if (!settings.enabledCurrencies.includes(body.currency)) {
      throw validationFailed({ currency: `${body.currency} is not turned on. A superadmin can enable it in Settings.` });
    }

    // A concurrent archive of the third party writes the same document, so one of the two retries.
    await ThirdParty.updateOne({ _id: party._id }, { $currentDate: { updatedAt: true } }, { session, timestamps: false });

    const now = new Date();
    const by = snapshot(viewer);
    const [created] = await WorkOrder.create(
      [
        {
          ref: await nextRef('workOrder', session),
          thirdPartyId: party._id,
          thirdPartyName: party.name,
          clientId: project.clientId,
          projectId: project._id,
          taskId: task?._id,
          title: body.title,
          scope: body.scope || undefined,
          agreed: { amountMinor: body.amountMinor, currency: body.currency },
          dueOn,
          status: 'open',
          statusHistory: [{ from: null, to: 'open', at: now, by }],
          paidMinor: 0,
          dueMinor: 0,
          createdBy: by,
        },
      ],
      { session },
    );
    if (!created) throw new Error('Work order was not created');
    await audit(
      {
        ...auditBase(viewer, created, meta),
        action: 'workOrder.create',
        summary: `${fmtMoney(body.amountMinor, body.currency)} for ${party.name} on ${project.ref}`,
        changes: [
          { path: 'thirdParty', after: party.name },
          { path: 'agreed.amountMinor', after: body.amountMinor },
          { path: 'agreed.currency', after: body.currency },
        ],
      },
      session,
    );
    return dtoFor(created.toObject(), session);
  });
}

const TRACKED = ['title', 'scope', 'agreed.amountMinor', 'agreed.currency', 'dueOn', 'taskId'] as const;
const trackable = (w: WorkOrderDoc): Record<string, unknown> => ({
  title: w.title,
  scope: w.scope ?? null,
  agreed: { amountMinor: w.agreed.amountMinor, currency: w.agreed.currency },
  dueOn: ymd(w.dueOn),
  taskId: w.taskId ? String(w.taskId) : null,
});

export async function updateWorkOrder(
  viewer: SessionUser,
  id: string,
  patch: UpdateWorkOrderInput,
  meta: ServiceMeta = {},
): Promise<{ workOrder: WorkOrderDTO; warnings: string[] }> {
  assertCapability(viewer, 'payout:record');
  id = parseObjectId(id);
  const parsed = updateWorkOrderSchema.safeParse(patch);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const body = parsed.data;
  const dueOn = body.dueOn ? parseDay(body.dueOn, 'dueOn') : body.dueOn;

  return withTransaction(async (session) => {
    const wo = await touchWorkOrder(oid(id), session);
    if (!isCurrentStatus(wo.status)) throw conflict(`This work order is ${wo.status}. Reopen it before editing.`);

    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    if (body.title !== undefined) set.title = body.title;
    if (body.scope !== undefined) {
      if (body.scope) set.scope = body.scope;
      else unset.scope = 1;
    }
    if (body.dueOn !== undefined) {
      if (dueOn) set.dueOn = dueOn;
      else unset.dueOn = 1;
    }

    const linked = await ThirdPartyPayout.countDocuments({ workOrderId: wo._id, status: mongoose.trusted({ $ne: 'void' }) }).session(session);
    if (body.currency !== undefined && body.currency !== wo.agreed.currency) {
      if (linked > 0) {
        throw conflict('Payouts are already recorded in this currency, so it cannot change. Cancel the work order and raise a new one.', { currency: 'Payouts exist in the current currency' });
      }
      const settings = await loadSettings(session);
      if (!settings.enabledCurrencies.includes(body.currency)) {
        throw validationFailed({ currency: `${body.currency} is not turned on. A superadmin can enable it in Settings.` });
      }
      set['agreed.currency'] = body.currency;
    }
    if (body.amountMinor !== undefined) set['agreed.amountMinor'] = body.amountMinor;
    if (body.taskId !== undefined && (body.taskId ? parseObjectId(body.taskId) : null) !== (wo.taskId ? String(wo.taskId) : null)) {
      if (linked > 0) {
        throw conflict('Payouts already carry this task, so it cannot change.', { taskId: 'Payouts are linked to the current task' });
      }
      if (body.taskId) {
        const project = await Project.findById(wo.projectId).session(session).lean();
        if (!project) throw notFound('We could not find that project');
        set.taskId = (await claimTask(body.taskId, project, session))._id;
      } else {
        unset.taskId = 1;
      }
    }

    const prospective = { ...wo, ...Object.fromEntries(Object.entries(set).filter(([k]) => !k.includes('.'))) } as WorkOrderDoc;
    prospective.agreed = {
      amountMinor: (set['agreed.amountMinor'] as number | undefined) ?? wo.agreed.amountMinor,
      currency: (set['agreed.currency'] as string | undefined) ?? wo.agreed.currency,
    };
    for (const key of Object.keys(unset)) delete (prospective as unknown as Record<string, unknown>)[key];
    const changes = diffFields(trackable(wo), trackable(prospective), TRACKED);
    if (changes.length === 0) return { workOrder: await dtoFor(wo, session), warnings: [] };

    set.updatedBy = snapshot(viewer);
    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length) update.$unset = unset;
    const after = await WorkOrder.findOneAndUpdate({ _id: wo._id }, update, { returnDocument: 'after', session, runValidators: true }).lean();
    if (!after) throw notFound('We could not find that work order');
    await audit({ ...auditBase(viewer, after, meta), action: 'workOrder.update', changes }, session);

    const warning = body.amountMinor !== undefined ? overrunWarning(after) : null;
    return { workOrder: await dtoFor(after, session), warnings: warning ? [warning] : [] };
  });
}

/**
 * Moves a work order along: open, delivered, closed or cancelled. Cancelling and reopening need a note.
 * A work order cannot be cancelled while a payout that is PAID refers to it (void that payout first, or
 * close the work order), and not while one is still DUE (void or pay it): a cancelled work order has
 * nothing outstanding.
 */
export async function changeWorkOrderStatus(viewer: SessionUser, id: string, input: WorkOrderStatusInput, meta: ServiceMeta = {}): Promise<WorkOrderDTO> {
  assertCapability(viewer, 'payout:record');
  id = parseObjectId(id);
  const parsed = workOrderStatusSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const to = parsed.data.status;
  const note = parsed.data.note?.trim() || undefined;

  return withTransaction(async (session) => {
    // The first write: a payout being recorded at the same moment conflicts here, and the retry sees it.
    const wo = await touchWorkOrder(oid(id), session);
    const from = wo.status;
    if (from === to) throw validationFailed({ status: 'The work order is already in that status' });
    if (!WORK_ORDER_TRANSITIONS[from].includes(to)) throw validationFailed({ status: `A ${from} work order cannot move to ${to}` });
    if (to === 'cancelled' && !note) throw validationFailed({ note: 'Say why you are cancelling this work order' });
    if (to === 'open' && !note) throw validationFailed({ note: 'Say why you are reopening this work order' });

    if (to === 'cancelled') {
      const paid = await ThirdPartyPayout.countDocuments({ workOrderId: wo._id, status: 'paid' }).session(session);
      if (paid > 0) {
        throw conflict('Payouts have already been paid against this work order, so it cannot be cancelled. Close it instead, or void those payouts first.', { status: 'Paid payouts refer to this work order' });
      }
      const due = await ThirdPartyPayout.countDocuments({ workOrderId: wo._id, status: 'due' }).session(session);
      if (due > 0) {
        throw conflict('Payouts are still due against this work order. Void or pay them before cancelling it.', { status: 'Due payouts refer to this work order' });
      }
    }

    const at = new Date();
    const by = snapshot(viewer);
    const after = await WorkOrder.findOneAndUpdate(
      { _id: wo._id, status: from },
      { $set: { status: to, updatedBy: by }, $push: { statusHistory: { from, to, at, by, note } } },
      { returnDocument: 'after', session, runValidators: true },
    ).lean();
    if (!after) throw conflict('Someone else just changed this work order. Reload and try again.');

    await audit({ ...auditBase(viewer, after, meta), action: 'workOrder.status', summary: note, changes: [{ path: 'status', before: from, after: to }] }, session);
    return dtoFor(after, session);
  });
}
