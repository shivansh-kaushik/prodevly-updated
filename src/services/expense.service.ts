import { Types, type ClientSession, type HydratedDocument } from 'mongoose';
import { BASE_CURRENCY } from '@/config/currencies';
import { EXPENSE_STATUSES, type EXPENSE_PAID_FROM, type EXPENSE_SCOPES } from '@/config/statuses';
import { humanize } from '@/lib/admin/format';
import { escapeRegex, pageMeta, type PageMeta } from '@/lib/admin/search-params';
import { conflict, forbidden, linkMismatch, notFound, validationFailed } from '@/lib/api/errors';
import { assertCapability } from '@/lib/auth/guard';
import { formatDateOnly, parseDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { connectToDatabase, mongoose, withTransaction } from '@/lib/db/mongoose';
import type { MediaDTO } from '@/lib/media/types';
import { fieldErrors, parseObjectId } from '@/lib/validation/common';
import {
  createExpenseSchema,
  markPaidSchema,
  rejectExpenseSchema,
  updateExpenseSchema,
  voidExpenseSchema,
  type CreateExpenseInput,
  type MarkPaidInput,
  type UpdateExpenseInput,
} from '@/lib/validation/expense';
import { Admin, Expense, Media, Project, Task, type ExpenseDoc, type MoneyDoc, type TaskDoc } from '@/models';
import type { SessionUser } from '@/types/session';
import type { ServiceMeta } from './admin.service';
import { audit, diffFields, type AuditActor, type AuditInput } from './audit.service';
import { resolveFx } from './fx.service';
import { canViewMedia, describeMedia } from './media.service';
import { nextFiscalRef } from './refs';
import { loadSettings, type SettingsDTO } from './settings.service';
import { projectBriefs, type TaskProjectDTO } from './task.service';

/**
 * Expenses: our own spending (docs/plan section 3, "expenses", and its Flow).
 *
 * TWO WAYS IN
 *   company-paid     recorded directly as PAID by someone with `expense:record` (needs the date it was paid and how).
 *   out of pocket    SUBMITTED by any admin (`expense:submit`) for reimbursement. The submitter is always the payer:
 *                    nobody records an out-of-pocket expense on someone else's behalf. A superadmin (`money:approve`)
 *                    then approves it (we now OWE the admin), or rejects it with a reason, and later marks it paid with
 *                    the reimbursement date, mode and bank reference. Reimbursements are never team payouts, so nothing
 *                    is counted twice.
 *
 * STATE MACHINE (every move keeps a `statusHistory` entry and one audit entry, in the same transaction)
 *   submitted -> approved | rejected | void
 *   approved  -> paid | void
 *   paid      -> void
 *   rejected, void: final (a rejected expense is replaced by a new submission).
 * A company-paid expense is born `paid`. Voiding needs `money:void` and a reason, except that a submitter may withdraw
 * their OWN expense while it is still `submitted`. Money is never deleted.
 *
 * WHO SEES WHAT
 *   `expense:view` sees every expense. A plain admin (`expense:submit` only) sees ONLY expenses they paid out of pocket;
 *   anyone else's is "not found" to them, so a receipt cannot be probed for by id. Receipts are private media.
 *
 * MONEY
 *   The amount is converted at the SPEND date with `resolveFx`; the INR value is never taken from the request. Editing
 *   the amount, currency or date re-resolves the rate unless it was typed by hand or came from the bank (see
 *   `updateExpense`). Dashboards sum `amount.inrMinor` of approved and paid expenses only.
 *
 * LINKS
 *   A project expense names its project (or just a task, which names the project); the client is derived on the server
 *   and a disagreeing id answers LINK_MISMATCH. The task is touched inside the transaction so a concurrent move or
 *   delete of it conflicts. A company expense has no client, project or task.
 */
export type { ServiceMeta };

type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
type ExpenseScope = (typeof EXPENSE_SCOPES)[number];
type PaidFrom = (typeof EXPENSE_PAID_FROM)[number];

/** Statuses that count as spent (plan section 4: "approved and paid, because the money is already spent"). */
export const SETTLED_STATUSES = ['approved', 'paid'] as const satisfies readonly ExpenseStatus[];
/** Statuses that can still change. Rejected and void are final. */
const LIVE_STATUSES = ['submitted', 'approved', 'paid'] as const satisfies readonly ExpenseStatus[];
/** The queues: an expense in one of these is waiting for someone, so the list shows it whatever the period. */
const OPEN_STATUSES = ['submitted', 'approved'] as const satisfies readonly ExpenseStatus[];

const oid = (id: string) => new Types.ObjectId(id);
const lc = (id: string | null | undefined) => (id ? id.toLowerCase() : undefined);
const str = (id?: Types.ObjectId | null) => (id ? String(id) : undefined);
const ymd = (d?: Date | null) => (d ? formatDateOnly(d) : null);
const snapshot = (v: SessionUser) => ({ id: oid(v.id), name: v.name });
const actorOf = (v: SessionUser): AuditActor => ({ id: v.id, name: v.name, role: v.role });
const short = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ---------------------------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------------------------

type Viewer = Pick<SessionUser, 'id' | 'capabilities'>;
/** Recording implies viewing (the grant dependency), so a recorder is never half-blind even if the dependency is missing from a stored grant list. */
export const canViewAllExpenses = (v: Pick<SessionUser, 'capabilities'>) => v.capabilities.has('expense:view') || v.capabilities.has('expense:record');
export const canRecordExpenses = (v: Pick<SessionUser, 'capabilities'>) => v.capabilities.has('expense:record');
export const canSubmitExpenses = (v: Pick<SessionUser, 'capabilities'>) => v.capabilities.has('expense:submit');

/** Whether the expense is the viewer's own out-of-pocket one. Ids on both sides are lowercase hex. */
export function isOwnExpense(viewer: Pick<SessionUser, 'id'>, doc: Pick<ExpenseDoc, 'paidFrom' | 'paidByAdmin'>): boolean {
  return doc.paidFrom === 'admin' && doc.paidByAdmin?.id != null && String(doc.paidByAdmin.id) === viewer.id;
}

/** The Expenses section is for anyone who can submit their own expenses or see everyone's. */
function assertCanUse(viewer: Viewer): void {
  if (!canViewAllExpenses(viewer) && !canSubmitExpenses(viewer)) throw forbidden('Your access does not allow this action');
}

export interface ExpenseAbilities {
  edit: boolean;
  /** Correct the date, mode or reference of a payment already made. */
  editPayment: boolean;
  approve: boolean;
  reject: boolean;
  markPaid: boolean;
  void: boolean;
}

/**
 * What this viewer may do to this expense right now. The service enforces the same rules when the action
 * arrives; the page uses it only to decide which buttons to show.
 */
export function expenseAbilities(viewer: Viewer, doc: Pick<ExpenseDoc, 'status' | 'paidFrom' | 'paidByAdmin'>): ExpenseAbilities {
  const live = (LIVE_STATUSES as readonly string[]).includes(doc.status);
  const withdrawable = doc.status === 'submitted' && isOwnExpense(viewer, doc) && canSubmitExpenses(viewer);
  const approves = viewer.capabilities.has('money:approve');
  return {
    // Before approval the submitter edits their own; afterwards (and for anyone else's) it takes expense:record.
    edit: (canRecordExpenses(viewer) && live) || withdrawable,
    // What was paid, when and how is a fact about the money that moved: a company payment is the recorder's to correct,
    // a reimbursement belongs to whoever paid it back (money:approve).
    editPayment: doc.status === 'paid' && (doc.paidFrom === 'admin' ? approves : canRecordExpenses(viewer)),
    approve: approves && doc.status === 'submitted',
    reject: approves && doc.status === 'submitted',
    markPaid: approves && doc.status === 'approved',
    void: live && (viewer.capabilities.has('money:void') || withdrawable),
  };
}

// ---------------------------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------------------------

export interface ExpenseAmountDTO {
  amountMinor: number;
  currency: string;
  /** The INR value every total sums. */
  inrMinor: number;
}

export type ExpenseProjectDTO = TaskProjectDTO;

export interface ExpenseListItemDTO {
  id: string;
  ref: string;
  scope: ExpenseScope;
  status: ExpenseStatus;
  category: string;
  description: string;
  payee: string | null;
  /** "YYYY-MM-DD", the day it was spent. */
  spentOn: string;
  paidOn: string | null;
  amount: ExpenseAmountDTO;
  paidFrom: PaidFrom;
  /** The admin who paid out of pocket. Null for company-paid. */
  paidBy: { id: string | null; name: string } | null;
  project: ExpenseProjectDTO | null;
  receiptCount: number;
  createdAt: string;
}

export interface ExpenseTaskDTO {
  id: string;
  ref: string;
  title: string;
}

export interface ExpenseHistoryDTO {
  from: ExpenseStatus | null;
  to: ExpenseStatus;
  at: string;
  by: string;
  note: string | null;
}

export interface ExpenseDTO extends ExpenseListItemDTO {
  task: ExpenseTaskDTO | null;
  fx: { rate: number; rateOn: string; source: MoneyDoc['fxSource'] };
  mode: string | null;
  transactionRef: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectReason: string | null;
  voidReason: string | null;
  recordedBy: string;
  /** Only the receipts this viewer may open (`receiptCount` says how many are attached). */
  receipts: MediaDTO[];
  /** Every attached receipt id, including ones this viewer cannot open, so an edit never drops a receipt it could not see. */
  receiptIds: string[];
  statusHistory: ExpenseHistoryDTO[];
  updatedAt: string;
  can: ExpenseAbilities;
}

const UNKNOWN_PROJECT = (id: Types.ObjectId): ExpenseProjectDTO => ({ id: String(id), ref: '', name: 'Unknown project', clientId: '', clientName: '', archived: false });

function toListItem(e: ExpenseDoc, projects: Map<string, ExpenseProjectDTO>): ExpenseListItemDTO {
  return {
    id: String(e._id),
    ref: e.ref,
    scope: e.scope,
    status: e.status,
    category: e.category,
    description: e.description,
    payee: e.payee ?? null,
    spentOn: formatDateOnly(e.spentOn),
    paidOn: ymd(e.paidOn),
    amount: { amountMinor: e.amount.amountMinor, currency: e.amount.currency, inrMinor: e.amount.inrMinor },
    paidFrom: e.paidFrom,
    paidBy: e.paidByAdmin ? { id: str(e.paidByAdmin.id) ?? null, name: e.paidByAdmin.name } : null,
    project: e.projectId ? (projects.get(String(e.projectId)) ?? UNKNOWN_PROJECT(e.projectId)) : null,
    receiptCount: e.receiptMediaIds?.length ?? 0,
    createdAt: e.createdAt.toISOString(),
  };
}

async function detailDTO(viewer: SessionUser, e: ExpenseDoc): Promise<ExpenseDTO> {
  const [projects, task, receipts] = await Promise.all([
    projectBriefs(e.projectId ? [e.projectId] : []),
    e.taskId ? Task.findById(e.taskId).select('ref title').lean() : Promise.resolve(null),
    describeMedia(viewer, (e.receiptMediaIds ?? []).map(String)),
  ]);
  return {
    ...toListItem(e, projects),
    task: task ? { id: String(task._id), ref: task.ref, title: task.title } : null,
    fx: { rate: e.amount.fxRate, rateOn: formatDateOnly(e.amount.fxDate), source: e.amount.fxSource },
    mode: e.mode ?? null,
    transactionRef: e.transactionRef ?? null,
    approvedBy: e.approvedBy?.name ?? null,
    approvedAt: e.approvedAt ? e.approvedAt.toISOString() : null,
    rejectReason: e.rejectReason ?? null,
    voidReason: e.voidReason ?? null,
    recordedBy: e.recordedBy.name,
    receipts,
    receiptIds: (e.receiptMediaIds ?? []).map(String),
    statusHistory: (e.statusHistory ?? []).map((h) => ({ from: h.from ?? null, to: h.to, at: h.at.toISOString(), by: h.by?.name ?? 'Unknown', note: h.note ?? null })),
    updatedAt: e.updatedAt.toISOString(),
    can: expenseAbilities(viewer, e),
  };
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

export const EXPENSE_SORTS = ['spentOn', 'createdAt', 'amount', 'status', 'ref'] as const;
export type ExpenseSort = (typeof EXPENSE_SORTS)[number];

export interface ExpenseFilter {
  /** Matched literally against the description, payee and reference. */
  q?: string;
  /** A status, or `settled` for approved and paid together. */
  status?: ExpenseStatus | 'settled';
  scope?: ExpenseScope;
  category?: string;
  projectId?: string;
  /** The admin who paid out of pocket. Only honoured for viewers who see everyone's expenses. */
  personId?: string;
  paidFrom?: PaidFrom;
  /** Date-only, inclusive, on the spend date. Ignored while looking at a queue (see `searchExpenses`). */
  range?: { from: Date; to: Date };
}

export interface ExpenseSearch extends ExpenseFilter {
  sort?: ExpenseSort;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface ExpensePage {
  items: ExpenseListItemDTO[];
  meta: PageMeta;
  /** Approved and paid, in INR, over EVERY expense that matches (not just this page). */
  settledInr: number;
}

/**
 * The filter as a raw aggregation `$match`. Built ONLY from parsed values (ids become ObjectIds, dates are Dates,
 * search text is escaped), because aggregation stages are not sanitised by Mongoose. A viewer without `expense:view`
 * is confined to their own out-of-pocket expenses here, whatever they asked for.
 */
function rawMatch(viewer: Viewer, f: ExpenseFilter): Record<string, unknown> {
  const m: Record<string, unknown> = {};
  const all = canViewAllExpenses(viewer);
  if (!all) {
    m.paidFrom = 'admin';
    m['paidByAdmin.id'] = oid(viewer.id);
  } else {
    if (f.paidFrom) m.paidFrom = f.paidFrom;
    if (f.personId) m['paidByAdmin.id'] = oid(parseObjectId(f.personId));
  }
  if (f.status !== undefined) {
    if (f.status === 'settled') m.status = { $in: [...SETTLED_STATUSES] };
    else if ((EXPENSE_STATUSES as readonly string[]).includes(f.status)) m.status = f.status;
    else throw validationFailed({ status: 'Pick a status' });
  }
  if (f.scope) m.scope = f.scope;
  if (f.category) m.category = f.category;
  if (f.projectId) m.projectId = oid(parseObjectId(f.projectId));
  // A queue (awaiting approval, approved and not yet paid) is shown for every date: an item from last year still waits.
  const queue = f.status !== undefined && (OPEN_STATUSES as readonly string[]).includes(f.status);
  if (f.range && !queue) m.spentOn = { $gte: f.range.from, $lte: f.range.to };
  const q = f.q?.trim().slice(0, 100);
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    m.$or = [{ description: re }, { payee: re }, { ref: re }];
  }
  return m;
}

const SORT_FIELD: Record<ExpenseSort, string> = { spentOn: 'spentOn', createdAt: 'createdAt', amount: 'amount.inrMinor', status: 'status', ref: 'ref' };

/** The expense list: filtered, sorted and paged. Plain admins get their own out-of-pocket expenses only. */
export async function searchExpenses(viewer: SessionUser, params: ExpenseSearch = {}): Promise<ExpensePage> {
  assertCanUse(viewer);
  await connectToDatabase();
  const match = rawMatch(viewer, params);
  const pageSize = Math.min(Math.max(params.pageSize ?? 25, 1), 100);
  const sort = params.sort && (EXPENSE_SORTS as readonly string[]).includes(params.sort) ? params.sort : 'spentOn';
  const dir = (params.dir ?? 'desc') === 'asc' ? 1 : -1;

  const [totals] = await Expense.aggregate<{ total: Array<{ n: number }>; settled: Array<{ inr: number }> }>([
    { $match: match },
    {
      $facet: {
        total: [{ $count: 'n' }],
        settled: [{ $match: { status: { $in: [...SETTLED_STATUSES] } } }, { $group: { _id: null, inr: { $sum: '$amount.inrMinor' } } }],
      },
    },
  ]);
  const meta = pageMeta(Math.max(params.page ?? 1, 1), pageSize, totals?.total[0]?.n ?? 0);
  const rows = await Expense.aggregate<ExpenseDoc>([
    { $match: match },
    { $sort: { [SORT_FIELD[sort]]: dir, _id: -1 } },
    { $skip: (meta.page - 1) * pageSize },
    { $limit: pageSize },
  ]);
  const projects = await projectBriefs(rows.flatMap((r) => (r.projectId ? [r.projectId] : [])));
  return { items: rows.map((r) => toListItem(r, projects)), meta, settledInr: totals?.settled[0]?.inr ?? 0 };
}

/** Someone else's expense is "not found" to a viewer who may only see their own: no probing by id. */
function assertVisible(viewer: Viewer, doc: Pick<ExpenseDoc, 'paidFrom' | 'paidByAdmin'>): void {
  if (!canViewAllExpenses(viewer) && !isOwnExpense(viewer, doc)) throw notFound('We could not find that expense');
}

export async function getExpense(viewer: SessionUser, id: string): Promise<ExpenseDTO> {
  assertCanUse(viewer);
  await connectToDatabase();
  const doc = await Expense.findById(parseObjectId(id)).lean();
  if (!doc) throw notFound('We could not find that expense');
  assertVisible(viewer, doc);
  return detailDTO(viewer, doc);
}

/** Names for the project and person filters held in the URL, so the pickers can show them. */
export async function getExpenseFilterLabels(
  viewer: SessionUser,
  ids: { projectId?: string; personId?: string },
): Promise<{ project: { id: string; label: string; ref: string } | null; person: { id: string; label: string } | null }> {
  assertCanUse(viewer);
  await connectToDatabase();
  const projectId = ids.projectId ? parseObjectId(ids.projectId) : undefined;
  const personId = ids.personId && canViewAllExpenses(viewer) ? parseObjectId(ids.personId) : undefined;
  const [project, person] = await Promise.all([
    projectId && viewer.capabilities.has('project:view') ? Project.findById(projectId).select('ref name').lean() : Promise.resolve(null),
    personId ? Admin.findById(personId).select('name').lean() : Promise.resolve(null),
  ]);
  return {
    project: project ? { id: String(project._id), label: project.name, ref: project.ref } : null,
    person: person ? { id: String(person._id), label: person.name } : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Shared write rules
// ---------------------------------------------------------------------------------------------

function parseOrThrow<T>(result: { success: true; data: T } | { success: false; error: Parameters<typeof fieldErrors>[0] }): T {
  if (!result.success) throw validationFailed(fieldErrors(result.error));
  return result.data;
}

function dateOrThrow(value: string, field: string): Date {
  const date = parseDateOnly(value);
  if (!date) throw validationFailed({ [field]: 'Enter a valid date' });
  return date;
}

/** Spending and paying happen in the past (or today, in the organisation's zone). */
function assertNotFuture(date: Date, today: Date, field: string): void {
  if (date.getTime() > today.getTime()) throw validationFailed({ [field]: 'That date is in the future' });
}

function assertCategory(category: string, settings: SettingsDTO): void {
  if (!settings.expenseCategories.includes(category)) throw validationFailed({ category: 'Pick one of the categories in Settings' });
}

function assertMode(mode: string, settings: SettingsDTO): void {
  if (!settings.paymentModes.includes(mode)) throw validationFailed({ mode: 'Pick one of the payment modes in Settings' });
}

interface LinkRequest {
  scope: ExpenseScope;
  clientId?: string;
  projectId?: string;
  taskId?: string;
}

interface Links {
  scope: ExpenseScope;
  clientId?: Types.ObjectId;
  projectId?: Types.ObjectId;
  taskId?: Types.ObjectId;
}

/**
 * Derives the links from what was asked, and checks them. The task names the project and the project names the client;
 * anything that disagrees is LINK_MISMATCH, not silently "fixed". A project that is archived, or a task that is cancelled or
 * archived, cannot take a NEW link; a link the expense already had stays valid so older expenses can still be edited.
 */
async function resolveLinks(req: LinkRequest, existing: { projectId?: string; taskId?: string } | null, session: ClientSession): Promise<Links> {
  if (req.scope === 'company') {
    if (req.clientId || req.projectId || req.taskId) throw validationFailed({ scope: 'A company expense is not charged to a client, project or task' });
    return { scope: 'company' };
  }

  let task: TaskDoc | null = null;
  if (req.taskId) {
    task = await Task.findById(req.taskId).session(session).lean();
    if (!task) throw validationFailed({ taskId: 'That task does not exist' });
  }
  const projectId = req.projectId ?? (task ? String(task.projectId) : undefined);
  if (!projectId) throw validationFailed({ projectId: 'Pick the project this was spent on' });
  if (task && String(task.projectId) !== projectId) {
    throw linkMismatch('That task belongs to a different project', { taskId: 'This task is in a different project' });
  }
  const project = await Project.findById(projectId).session(session).lean();
  if (!project) throw validationFailed({ projectId: 'That project does not exist' });
  if (req.clientId && req.clientId !== String(project.clientId)) {
    throw linkMismatch('That client does not own this project', { clientId: 'This project belongs to a different client' });
  }
  if (projectId !== existing?.projectId && project.archivedAt) {
    throw conflict('That project is archived. Restore it before charging an expense to it.', { projectId: 'This project is archived' });
  }
  if (task && String(task._id) !== existing?.taskId && (task.archivedAt || task.status === 'cancelled')) {
    throw conflict('That task is cancelled or archived, so nothing new can be charged to it.', { taskId: 'This task is cancelled or archived' });
  }
  return { scope: 'project', clientId: project.clientId, projectId: project._id, taskId: task?._id };
}

/**
 * Writes the task so a concurrent move, cancel or delete of it conflicts with this transaction instead of slipping past
 * a read. `timestamps: false` keeps the bump to `$currentDate` only.
 */
async function touchTask(taskId: Types.ObjectId, session: ClientSession): Promise<void> {
  await Task.updateOne({ _id: taskId }, { $currentDate: { updatedAt: true } }, { session, timestamps: false });
}

/**
 * Receipts are PRIVATE media uploaded for an expense. Each id must exist, be private, carry the expense purpose, and be a
 * file this viewer could open themselves (so a plain admin cannot attach someone else's upload by guessing an id).
 * Ids the expense already holds are kept as they are; only new ones are checked.
 */
async function verifyReceipts(viewer: SessionUser, ids: readonly string[], already: readonly string[], session: ClientSession): Promise<Types.ObjectId[]> {
  const wanted = [...new Set(ids.map((i) => i.toLowerCase()))];
  const fresh = wanted.filter((i) => !already.includes(i));
  if (fresh.length > 0) {
    const rows = await Media.find({ _id: mongoose.trusted({ $in: fresh.map(oid) }) }).session(session).lean();
    const byId = new Map(rows.map((r) => [String(r._id), r]));
    for (const id of fresh) {
      const media = byId.get(id);
      if (!media || media.visibility !== 'private' || media.purpose !== 'expense' || !canViewMedia(viewer, media)) {
        throw validationFailed({ receiptMediaIds: 'One of those receipts could not be used. Upload it again.' });
      }
    }
  }
  return wanted.map(oid);
}

type Hydrated = HydratedDocument<ExpenseDoc>;

async function loadExpense(id: string, session: ClientSession): Promise<Hydrated> {
  const expense = await Expense.findById(id).session(session);
  if (!expense) throw notFound('We could not find that expense');
  return expense;
}

/** "This expense is already approved": why a move that is not allowed from the current status is refused. */
function wrongStatus(expense: Pick<ExpenseDoc, 'status'>, action: string): never {
  const say: Record<ExpenseStatus, string> = {
    submitted: 'is still waiting for approval',
    approved: 'has already been approved',
    paid: 'has already been paid',
    rejected: 'was rejected',
    void: 'was voided',
  };
  throw conflict(`This expense ${say[expense.status]}, so it cannot be ${action}.`);
}

function moveTo(expense: Hydrated, to: ExpenseStatus, by: ReturnType<typeof snapshot>, at: Date, note?: string): void {
  expense.statusHistory.push({ from: expense.status, to, at, by, ...(note ? { note } : {}) });
  expense.status = to;
}

function auditBase(viewer: SessionUser, e: Pick<ExpenseDoc, '_id' | 'ref' | 'description' | 'clientId' | 'projectId' | 'taskId'>, meta: ServiceMeta) {
  return {
    actor: actorOf(viewer),
    entity: { type: 'expense', id: String(e._id), ref: e.ref, label: short(e.description) },
    context: { clientId: str(e.clientId), projectId: str(e.projectId), taskId: str(e.taskId) },
    meta,
  } satisfies Omit<AuditInput, 'action'>;
}

const TRACKED = [
  'scope', 'clientId', 'projectId', 'taskId', 'category', 'description', 'payee',
  'amount.amountMinor', 'amount.currency', 'amount.fxRate', 'amount.fxSource', 'amount.inrMinor',
  'spentOn', 'paidOn', 'mode', 'transactionRef', 'receiptMediaIds',
] as const;

const trackable = (e: ExpenseDoc): Record<string, unknown> => ({
  scope: e.scope,
  clientId: str(e.clientId) ?? null,
  projectId: str(e.projectId) ?? null,
  taskId: str(e.taskId) ?? null,
  category: e.category,
  description: e.description,
  payee: e.payee ?? null,
  amount: { amountMinor: e.amount.amountMinor, currency: e.amount.currency, fxRate: e.amount.fxRate, fxSource: e.amount.fxSource, inrMinor: e.amount.inrMinor },
  spentOn: ymd(e.spentOn),
  paidOn: ymd(e.paidOn),
  mode: e.mode ?? null,
  transactionRef: e.transactionRef ?? null,
  receiptMediaIds: (e.receiptMediaIds ?? []).map(String),
});

// ---------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------

/**
 * Records a company-paid expense (needs `expense:record`) or submits an out-of-pocket one (needs `expense:submit`; the
 * submitter is the payer). See the header for the flow. `now` is for tests.
 */
export async function createExpense(viewer: SessionUser, input: CreateExpenseInput, meta: ServiceMeta = {}, now = new Date()): Promise<ExpenseDTO> {
  // Authority first, so a viewer who may not do this learns nothing about what was wrong with the request.
  const requested = (input as { paidFrom?: unknown } | null)?.paidFrom;
  if (requested === 'company') assertCapability(viewer, 'expense:record');
  else if (requested === 'admin') assertCapability(viewer, 'expense:submit');
  else assertCanUse(viewer);
  const data = parseOrThrow(createExpenseSchema.safeParse(input));
  const company = data.paidFrom === 'company';

  const created = await withTransaction(async (session) => {
    const settings = await loadSettings(session);
    const today = todayDateOnly(now, settings.timezone);
    assertCategory(data.category, settings);
    const spentOn = dateOrThrow(data.spentOn, 'spentOn');
    assertNotFuture(spentOn, today, 'spentOn');
    let paidOn: Date | undefined;
    if (company) {
      paidOn = dateOrThrow(data.paidOn as string, 'paidOn');
      assertNotFuture(paidOn, today, 'paidOn');
      assertMode(data.mode as string, settings);
    }

    const links = await resolveLinks({ scope: data.scope, clientId: lc(data.clientId), projectId: lc(data.projectId), taskId: lc(data.taskId) }, null, session);
    const receiptMediaIds = await verifyReceipts(viewer, data.receiptMediaIds, [], session);
    const amount = await resolveFx(
      { currency: data.currency, on: spentOn, amountMinor: data.amountMinor, manualRate: data.manualRate, settledInrMinor: data.settledInrMinor },
      session,
    );
    const ref = await nextFiscalRef('expense', spentOn, session);

    const by = snapshot(viewer);
    const status: ExpenseStatus = company ? 'paid' : 'submitted';
    const [doc] = await Expense.create(
      [
        {
          ref,
          scope: links.scope,
          clientId: links.clientId,
          projectId: links.projectId,
          taskId: links.taskId,
          category: data.category,
          description: data.description,
          payee: data.payee || undefined,
          amount,
          spentOn,
          paidFrom: data.paidFrom,
          // Out of pocket: the payer is always the person submitting. Never someone else.
          paidByAdmin: company ? undefined : by,
          status,
          paidOn,
          mode: company ? data.mode : undefined,
          transactionRef: company ? data.transactionRef || undefined : undefined,
          receiptMediaIds,
          recordedBy: by,
          statusHistory: [{ from: null, to: status, at: now, by }],
        },
      ],
      { session },
    );
    if (!doc) throw new Error('Expense was not created');
    if (links.taskId) await touchTask(links.taskId, session);

    await audit(
      {
        ...auditBase(viewer, doc, meta),
        action: 'expense.create',
        summary: company ? 'Recorded as paid by the company' : 'Submitted for reimbursement',
        changes: [
          { path: 'status', after: status },
          { path: 'amount.amountMinor', after: amount.amountMinor },
          { path: 'amount.currency', after: amount.currency },
          { path: 'amount.inrMinor', after: amount.inrMinor },
          { path: 'category', after: data.category },
          { path: 'scope', after: links.scope },
        ],
      },
      session,
    );
    return doc.toObject();
  });
  return detailDTO(viewer, created);
}

// ---------------------------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------------------------

/**
 * Changes an expense. A submitter edits their OWN expense only while it is `submitted`; after approval (and for anyone
 * else's) it takes `expense:record`. Rejected and void expenses are final. Every change is audited with before and after;
 * a request that changes nothing writes nothing.
 *
 * Money: sending the amount, currency, spend date or a rate re-resolves the exchange rate at the spend date. A rate that was
 * typed by hand stays (same currency). A bank-settled figure stays when only the date changed; when the amount changed it
 * must be entered again, because the INR that arrived belonged to the old amount.
 */
export async function updateExpense(viewer: SessionUser, id: string, patch: UpdateExpenseInput, meta: ServiceMeta = {}, now = new Date()): Promise<ExpenseDTO> {
  assertCanUse(viewer);
  const expenseId = parseObjectId(id);
  const p = parseOrThrow(updateExpenseSchema.safeParse(patch));

  const updated = await withTransaction(async (session) => {
    const expense = await loadExpense(expenseId, session);
    assertVisible(viewer, expense);
    if (!expenseAbilities(viewer, expense).edit) {
      if (expense.status === 'rejected' || expense.status === 'void') throw conflict(`A ${expense.status} expense cannot be changed.`);
      throw forbidden(canSubmitExpenses(viewer) && isOwnExpense(viewer, expense) ? 'Only a person who records expenses can change one after it is approved' : 'Your access does not allow this action');
    }

    const before = trackable(expense.toObject());
    const settings = await loadSettings(session);
    const today = todayDateOnly(now, settings.timezone);

    if (p.category !== undefined && p.category !== expense.category) {
      assertCategory(p.category, settings);
      expense.category = p.category;
    }
    if (p.description !== undefined) expense.description = p.description;
    if (p.payee !== undefined) expense.payee = p.payee || undefined;

    if (p.scope !== undefined || p.clientId !== undefined || p.projectId !== undefined || p.taskId !== undefined) {
      const scope = p.scope ?? expense.scope;
      // `undefined` keeps what the expense has; `null` clears it. Moving to a company expense clears all three.
      const keep = (patched: string | null | undefined, current?: Types.ObjectId) => (patched === undefined ? str(current) : (lc(patched) ?? undefined));
      const request: LinkRequest =
        scope === 'company'
          ? { scope }
          : { scope, clientId: lc(p.clientId), projectId: keep(p.projectId, expense.projectId), taskId: keep(p.taskId, expense.taskId) };
      const links = await resolveLinks(request, { projectId: str(expense.projectId), taskId: str(expense.taskId) }, session);
      expense.scope = links.scope;
      expense.clientId = links.clientId;
      expense.projectId = links.projectId;
      expense.taskId = links.taskId;
      if (links.taskId) await touchTask(links.taskId, session);
    }

    let spentOn = expense.spentOn;
    if (p.spentOn !== undefined) {
      spentOn = dateOrThrow(p.spentOn, 'spentOn');
      assertNotFuture(spentOn, today, 'spentOn');
    }
    if (p.amountMinor !== undefined || p.currency !== undefined || p.spentOn !== undefined || p.manualRate !== undefined || p.settledInrMinor !== undefined) {
      const amountMinor = p.amountMinor ?? expense.amount.amountMinor;
      const currency = p.currency ?? expense.amount.currency;
      let { manualRate, settledInrMinor } = p;
      if (manualRate === undefined && settledInrMinor === undefined && currency === expense.amount.currency && currency !== BASE_CURRENCY) {
        if (expense.amount.fxSource === 'manual') manualRate = expense.amount.fxRate;
        else if (expense.amount.fxSource === 'bank') {
          if (amountMinor !== expense.amount.amountMinor) throw validationFailed({ settledInrMinor: 'Enter the INR that arrived for the new amount' });
          settledInrMinor = expense.amount.inrMinor;
        }
      }
      expense.amount = await resolveFx({ currency, on: spentOn, amountMinor, manualRate, settledInrMinor }, session);
    }
    expense.spentOn = spentOn;

    if (p.paidOn !== undefined || p.mode !== undefined || p.transactionRef !== undefined) {
      const fields = Object.fromEntries((['paidOn', 'mode', 'transactionRef'] as const).filter((k) => p[k] !== undefined).map((k) => [k, 'Payment details can only be changed on an expense that has been paid']));
      if (expense.status !== 'paid') throw validationFailed(fields);
      if (!expenseAbilities(viewer, expense).editPayment) throw forbidden('Your access does not allow this action');
      if (p.paidOn !== undefined) {
        const paidOn = dateOrThrow(p.paidOn, 'paidOn');
        assertNotFuture(paidOn, today, 'paidOn');
        expense.paidOn = paidOn;
      }
      if (p.mode !== undefined) {
        assertMode(p.mode, settings);
        expense.mode = p.mode;
      }
      if (p.transactionRef !== undefined) expense.transactionRef = p.transactionRef || undefined;
    }
    // A reimbursement cannot predate the spend it repays.
    if (expense.paidFrom === 'admin' && expense.paidOn && spentOn.getTime() > expense.paidOn.getTime()) {
      throw validationFailed({ spentOn: 'The spend date cannot be after the reimbursement date' });
    }

    if (p.receiptMediaIds !== undefined) {
      expense.receiptMediaIds = await verifyReceipts(viewer, p.receiptMediaIds, (expense.receiptMediaIds ?? []).map(String), session);
    }

    const changes = diffFields(before, trackable(expense.toObject()), TRACKED);
    // Nothing the log would record changed: write nothing, and answer with what is stored (not the unsaved edits).
    if (changes.length === 0) return (await Expense.findById(expenseId).session(session).lean()) as ExpenseDoc;
    await expense.save({ session });
    await audit({ ...auditBase(viewer, expense, meta), action: 'expense.update', changes }, session);
    return expense.toObject();
  });
  return detailDTO(viewer, updated);
}

// ---------------------------------------------------------------------------------------------
// Approve, reject, mark paid, void
// ---------------------------------------------------------------------------------------------

/** Approves a submitted out-of-pocket expense: from now on we owe the admin. Needs `money:approve`. */
export async function approveExpense(viewer: SessionUser, id: string, meta: ServiceMeta = {}, now = new Date()): Promise<ExpenseDTO> {
  assertCapability(viewer, 'money:approve');
  const expenseId = parseObjectId(id);
  const approved = await withTransaction(async (session) => {
    const expense = await loadExpense(expenseId, session);
    if (expense.status !== 'submitted') wrongStatus(expense, 'approved');
    const by = snapshot(viewer);
    expense.approvedBy = by;
    expense.approvedAt = now;
    moveTo(expense, 'approved', by, now);
    await expense.save({ session });
    const own = isOwnExpense(viewer, expense);
    await audit(
      {
        ...auditBase(viewer, expense, meta),
        action: 'expense.approve',
        summary: own ? 'Approved their own expense' : `Approved: we now owe ${expense.paidByAdmin?.name ?? 'the admin'}`,
        changes: [{ path: 'status', before: 'submitted', after: 'approved' }],
      },
      session,
    );
    return expense.toObject();
  });
  return detailDTO(viewer, approved);
}

/** Rejects a submitted expense with a reason. It stays visible with a Rejected tag and counts in no total. Needs `money:approve`. */
export async function rejectExpense(viewer: SessionUser, id: string, input: { reason: string }, meta: ServiceMeta = {}, now = new Date()): Promise<ExpenseDTO> {
  assertCapability(viewer, 'money:approve');
  const expenseId = parseObjectId(id);
  const { reason } = parseOrThrow(rejectExpenseSchema.safeParse(input));
  const rejected = await withTransaction(async (session) => {
    const expense = await loadExpense(expenseId, session);
    if (expense.status !== 'submitted') wrongStatus(expense, 'rejected');
    expense.rejectReason = reason;
    moveTo(expense, 'rejected', snapshot(viewer), now, reason);
    await expense.save({ session });
    await audit(
      { ...auditBase(viewer, expense, meta), action: 'expense.reject', summary: reason, changes: [{ path: 'status', before: 'submitted', after: 'rejected' }] },
      session,
    );
    return expense.toObject();
  });
  return detailDTO(viewer, rejected);
}

/**
 * Records the reimbursement of an approved expense: the date, how, and the bank reference when there is one. Needs
 * `money:approve`. The INR value stays as captured at the spend date.
 */
export async function markExpensePaid(viewer: SessionUser, id: string, input: MarkPaidInput, meta: ServiceMeta = {}, now = new Date()): Promise<ExpenseDTO> {
  assertCapability(viewer, 'money:approve');
  const expenseId = parseObjectId(id);
  const data = parseOrThrow(markPaidSchema.safeParse(input));
  const paid = await withTransaction(async (session) => {
    const expense = await loadExpense(expenseId, session);
    if (expense.status !== 'approved') wrongStatus(expense, 'marked as paid');
    const settings = await loadSettings(session);
    const paidOn = dateOrThrow(data.paidOn, 'paidOn');
    assertNotFuture(paidOn, todayDateOnly(now, settings.timezone), 'paidOn');
    if (paidOn.getTime() < expense.spentOn.getTime()) throw validationFailed({ paidOn: 'The reimbursement cannot be dated before the expense' });
    assertMode(data.mode, settings);

    expense.paidOn = paidOn;
    expense.mode = data.mode;
    expense.transactionRef = data.transactionRef || undefined;
    moveTo(expense, 'paid', snapshot(viewer), now, `Reimbursed by ${humanize(data.mode).toLowerCase()}${data.transactionRef ? `, reference ${data.transactionRef}` : ''}`);
    await expense.save({ session });
    await audit(
      {
        ...auditBase(viewer, expense, meta),
        action: 'expense.mark_paid',
        summary: `Reimbursed ${expense.paidByAdmin?.name ?? 'the admin'}`,
        changes: [
          { path: 'status', before: 'approved', after: 'paid' },
          { path: 'paidOn', after: formatDateOnly(paidOn) },
          { path: 'mode', after: data.mode },
          ...(data.transactionRef ? [{ path: 'transactionRef', after: data.transactionRef }] : []),
        ],
      },
      session,
    );
    return expense.toObject();
  });
  return detailDTO(viewer, paid);
}

/**
 * Voids an expense with a reason. It stays on record, tagged Void, and leaves every total. Needs `money:void`; a
 * submitter may also withdraw their OWN expense while it is still `submitted`.
 */
export async function voidExpense(viewer: SessionUser, id: string, input: { reason: string }, meta: ServiceMeta = {}, now = new Date()): Promise<ExpenseDTO> {
  if (!viewer.capabilities.has('money:void')) assertCapability(viewer, 'expense:submit');
  const expenseId = parseObjectId(id);
  const { reason } = parseOrThrow(voidExpenseSchema.safeParse(input));
  const voided = await withTransaction(async (session) => {
    const expense = await loadExpense(expenseId, session);
    assertVisible(viewer, expense);
    if (expense.status === 'void' || expense.status === 'rejected') throw conflict(`This expense was ${expense.status === 'void' ? 'voided' : 'rejected'} already.`);
    if (!expenseAbilities(viewer, expense).void) {
      throw forbidden(isOwnExpense(viewer, expense) ? 'Only a superadmin can void an expense once it has been approved' : 'Your access does not allow this action');
    }
    const from = expense.status;
    expense.voidReason = reason;
    moveTo(expense, 'void', snapshot(viewer), now, reason);
    await expense.save({ session });
    await audit(
      { ...auditBase(viewer, expense, meta), action: 'expense.void', summary: reason, changes: [{ path: 'status', before: from, after: 'void' }] },
      session,
    );
    return expense.toObject();
  });
  return detailDTO(viewer, voided);
}
