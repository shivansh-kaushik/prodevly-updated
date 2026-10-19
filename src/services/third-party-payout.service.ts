import { Types, type ClientSession } from 'mongoose';
import { mongoose, connectToDatabase, withTransaction } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { AppError, conflict, currencyMismatch, entryLocked, linkMismatch, notFound, validationFailed } from '@/lib/api/errors';
import { escapeRegex, type PageMeta } from '@/lib/admin/search-params';
import { formatDateOnly, parseDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { fieldErrors, parseObjectId } from '@/lib/validation/common';
import {
  PAYOUT_SORTS,
  createPayoutSchema,
  markPaidSchema,
  updatePayoutSchema,
  voidPayoutSchema,
  type CreatePayoutInput,
  type MarkPaidInput,
  type PayoutFilter,
  type PayoutSort,
  type UpdatePayoutInput,
  type VoidPayoutInput,
} from '@/lib/validation/third-party-payout';
import type { MediaDTO } from '@/lib/media/types';
import { Media, Project, ThirdParty, ThirdPartyPayout, WorkOrder, type MoneyDoc, type ThirdPartyPayoutDoc, type WorkOrderDoc } from '@/models';
import type { SessionUser } from '@/types/session';
import type { ServiceMeta } from './admin.service';
import { audit, diffFields, type AuditActor } from './audit.service';
import { resolveFx } from './fx.service';
import { describeMedia } from './media.service';
import { nextFiscalRef } from './refs';
import { loadSettings } from './settings.service';
import {
  claimTask,
  fmtMoney,
  isCurrentStatus,
  loadLinkBriefs,
  loadOpenProject,
  overrunWarning,
  pagedAggregate,
  refreshWorkOrderSums,
  touchWorkOrder,
  type LinkBriefs,
} from './work-order.service';

/**
 * Third-party payouts: what we owe and what we have paid freelancers, agencies and vendors.
 *
 * Who may do what (docs/plan sections 1 and 4):
 * - `payout:view` reads; `payout:record` records a payout (always as DUE) and edits it WHILE IT IS DUE.
 * - `money:approve` (superadmins) marks it paid. That RE-CAPTURES the exchange rate for the day the money
 *   left the account, and the due-date capture is kept in the audit entry.
 * - `money:void` (superadmins) voids it with a reason. A void payout counts nowhere.
 *
 * With a work order the client, project and task are COPIED from it (a request that names others is
 * LINK_MISMATCH) and the currency must equal the work order's (CURRENCY_MISMATCH). Every write that
 * changes what a work order has been paid or owes rewrites its cached `paidMinor` and `dueMinor` in the
 * SAME transaction, after taking a write on the work order document so concurrent writers serialise.
 * A payout above the work order's remaining balance only WARNS. The links are never editable: void the
 * payout and record a new one.
 */
export type { ServiceMeta };

const MAX_ATTACHMENTS = 10;
const oid = (id: string) => new Types.ObjectId(id);
const snapshot = (v: SessionUser) => ({ id: oid(v.id), name: v.name });
const actorOf = (v: SessionUser): AuditActor => ({ id: v.id, name: v.name, role: v.role });
const ymd = (d?: Date | null) => (d ? formatDateOnly(d) : null);

// ---------------------------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------------------------

export interface PayoutMoneyDTO {
  amountMinor: number;
  currency: string;
  fxRate: number;
  /** "YYYY-MM-DD": the day the rate applies to (the due date, then the paid date once paid). */
  fxDate: string;
  fxSource: MoneyDoc['fxSource'];
  inrMinor: number;
}

export interface PayoutListItemDTO {
  id: string;
  ref: string;
  thirdPartyId: string;
  thirdPartyName: string;
  workOrderId: string | null;
  workOrderRef: string | null;
  workOrderTitle: string | null;
  clientId: string;
  clientName: string;
  projectId: string;
  projectRef: string;
  projectName: string;
  taskId: string | null;
  taskRef: string | null;
  taskTitle: string | null;
  amount: PayoutMoneyDTO;
  tdsMinor: number | null;
  status: ThirdPartyPayoutDoc['status'];
  dueOn: string | null;
  paidOn: string | null;
  /** Due and past its due date, in the organisation's time zone. */
  overdue: boolean;
  mode: string | null;
  transactionRef: string | null;
  attachmentCount: number;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PayoutDTO extends PayoutListItemDTO {
  note: string | null;
  /** The private files this viewer may open. */
  attachments: MediaDTO[];
  recordedBy: string;
  paidBy: string | null;
  voidedBy: string | null;
}

interface PayoutBriefs extends LinkBriefs {
  workOrders: Map<string, { ref: string; title: string }>;
}

async function loadBriefs(rows: ThirdPartyPayoutDoc[], session?: ClientSession): Promise<PayoutBriefs> {
  const base = await loadLinkBriefs(rows.map((r) => r.projectId), rows.map((r) => r.taskId), session);
  const ids = [...new Set(rows.map((r) => (r.workOrderId ? String(r.workOrderId) : '')).filter(Boolean))].map(oid);
  const workOrders = new Map<string, { ref: string; title: string }>();
  if (ids.length > 0) {
    const found = await WorkOrder.find({ _id: mongoose.trusted({ $in: ids }) })
      .select('ref title')
      .session(session ?? null)
      .lean();
    for (const w of found) workOrders.set(String(w._id), { ref: w.ref, title: w.title });
  }
  return { ...base, workOrders };
}

function toListItem(p: ThirdPartyPayoutDoc, briefs: PayoutBriefs, today: Date): PayoutListItemDTO {
  const project = briefs.projects.get(String(p.projectId));
  const task = p.taskId ? briefs.tasks.get(String(p.taskId)) : undefined;
  const wo = p.workOrderId ? briefs.workOrders.get(String(p.workOrderId)) : undefined;
  return {
    id: String(p._id),
    ref: p.ref,
    thirdPartyId: String(p.thirdPartyId),
    thirdPartyName: p.thirdPartyName,
    workOrderId: p.workOrderId ? String(p.workOrderId) : null,
    workOrderRef: wo?.ref ?? null,
    workOrderTitle: wo?.title ?? null,
    clientId: String(p.clientId),
    clientName: project?.clientName ?? '',
    projectId: String(p.projectId),
    projectRef: project?.ref ?? '',
    projectName: project?.name ?? 'Unknown project',
    taskId: p.taskId ? String(p.taskId) : null,
    taskRef: task?.ref ?? null,
    taskTitle: task?.title ?? null,
    amount: {
      amountMinor: p.amount.amountMinor,
      currency: p.amount.currency,
      fxRate: p.amount.fxRate,
      fxDate: formatDateOnly(p.amount.fxDate),
      fxSource: p.amount.fxSource,
      inrMinor: p.amount.inrMinor,
    },
    tdsMinor: p.tdsMinor ?? null,
    status: p.status,
    dueOn: ymd(p.dueOn),
    paidOn: ymd(p.paidOn),
    overdue: Boolean(p.status === 'due' && p.dueOn && p.dueOn.getTime() < today.getTime()),
    mode: p.mode ?? null,
    transactionRef: p.transactionRef ?? null,
    attachmentCount: (p.attachmentMediaIds ?? []).length,
    voidReason: p.voidReason ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

async function orgToday(): Promise<Date> {
  return todayDateOnly(new Date(), (await loadSettings()).timezone);
}

async function dtoFor(viewer: SessionUser, p: ThirdPartyPayoutDoc, session?: ClientSession): Promise<PayoutDTO> {
  const briefs = await loadBriefs([p], session);
  return {
    ...toListItem(p, briefs, await orgToday()),
    note: p.note ?? null,
    attachments: await describeMedia(viewer, (p.attachmentMediaIds ?? []).map(String)),
    recordedBy: p.recordedBy?.name ?? 'Unknown',
    paidBy: p.paidBy?.name ?? null,
    voidedBy: p.voidedBy?.name ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

export interface PayoutSearch extends PayoutFilter {
  sort?: PayoutSort;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

function rawMatch(f: PayoutFilter, day: Date): Record<string, unknown> {
  const m: Record<string, unknown> = {};
  if (f.status) m.status = f.status;
  if (f.overdue) {
    // Overdue only makes sense for a payout that is still due; ignore it next to another status.
    if (!f.status || f.status === 'due') {
      m.status = 'due';
      m.dueOn = { $lt: day };
    }
  }
  if (f.thirdPartyId) m.thirdPartyId = oid(parseObjectId(f.thirdPartyId));
  if (f.workOrderId) m.workOrderId = oid(parseObjectId(f.workOrderId));
  if (f.projectId) m.projectId = oid(parseObjectId(f.projectId));
  if (f.clientId) m.clientId = oid(parseObjectId(f.clientId));
  const q = f.q?.trim().slice(0, 80);
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    m.$or = [{ ref: re }, { thirdPartyName: re }, { transactionRef: re }];
  }
  return m;
}

/** The payout list: filtered, sorted and paged. Needs `payout:view`. */
export async function searchPayouts(viewer: SessionUser, params: PayoutSearch = {}): Promise<{ items: PayoutListItemDTO[]; meta: PageMeta }> {
  assertCapability(viewer, 'payout:view');
  await connectToDatabase();
  const day = await orgToday();
  const sort = params.sort && PAYOUT_SORTS.includes(params.sort) ? params.sort : 'createdAt';
  const defaultDir = sort === 'ref' || sort === 'dueOn' ? 'asc' : 'desc';
  const dir = (params.dir ?? defaultDir) === 'asc' ? 1 : -1;
  const pageSize = Math.min(Math.max(params.pageSize ?? 25, 1), 100);
  const { rows, meta } = await pagedAggregate<ThirdPartyPayoutDoc>(
    (p) => ThirdPartyPayout.aggregate(p),
    rawMatch(params, day),
    { key: sort, dir, nullable: sort === 'dueOn' || sort === 'paidOn' },
    { page: Math.max(params.page ?? 1, 1), pageSize },
  );
  const briefs = await loadBriefs(rows);
  return { items: rows.map((r) => toListItem(r, briefs, day)), meta };
}

export async function getPayout(viewer: SessionUser, id: string): Promise<PayoutDTO> {
  assertCapability(viewer, 'payout:view');
  await connectToDatabase();
  const doc = await ThirdPartyPayout.findById(parseObjectId(id)).lean();
  if (!doc) throw notFound('We could not find that payout');
  return dtoFor(viewer, doc);
}

// ---------------------------------------------------------------------------------------------
// Shared write rules
// ---------------------------------------------------------------------------------------------

function parseDay(value: string, field: string): Date {
  const d = parseDateOnly(value);
  if (!d) throw validationFailed({ [field]: 'Enter a valid date' });
  return d;
}

/**
 * Every attachment must exist, be PRIVATE and have been uploaded for payouts. The files are touched so a
 * delete of one of them running at the same moment conflicts with this write instead of leaving a
 * payout that points at a file that is gone.
 */
async function verifyAttachments(ids: readonly string[], session: ClientSession): Promise<Types.ObjectId[]> {
  const unique = [...new Set(ids.map((i) => i.toLowerCase()))];
  if (unique.length === 0) return [];
  const rows = await Media.find({ _id: mongoose.trusted({ $in: unique.map(oid) }) })
    .select('visibility purpose')
    .session(session)
    .lean();
  const found = new Map(rows.map((r) => [String(r._id), r]));
  for (const id of unique) {
    const m = found.get(id);
    if (!m) throw validationFailed({ attachmentMediaIds: 'One of those files no longer exists. Upload it again.' });
    if (m.visibility !== 'private' || m.purpose !== 'payout') {
      throw validationFailed({ attachmentMediaIds: 'One of those files was not uploaded as a payout attachment.' });
    }
  }
  const objectIds = unique.map(oid);
  await Media.updateMany({ _id: mongoose.trusted({ $in: objectIds }) }, { $currentDate: { updatedAt: true } }, { session, timestamps: false });
  return objectIds;
}

/**
 * The day a due payout's exchange rate is captured for: its due date, or today when the due date has not come yet (no rate
 * exists for a future day, and a payout due in a few weeks must not fail because the table has nothing that new).
 */
const captureDay = (dueOn: Date, today: Date): Date => (dueOn.getTime() > today.getTime() ? today : dueOn);

function assertTds(tdsMinor: number | null | undefined, amountMinor: number): void {
  if (tdsMinor !== null && tdsMinor !== undefined && tdsMinor > amountMinor) {
    throw validationFailed({ tdsMinor: 'TDS cannot be more than the payout amount' });
  }
}

function auditBase(viewer: SessionUser, p: Pick<ThirdPartyPayoutDoc, '_id' | 'ref' | 'thirdPartyName' | 'clientId' | 'projectId' | 'taskId'>, meta: ServiceMeta) {
  return {
    actor: actorOf(viewer),
    entity: { type: 'thirdPartyPayout', id: String(p._id), ref: p.ref, label: p.thirdPartyName },
    context: { clientId: String(p.clientId), projectId: String(p.projectId), ...(p.taskId ? { taskId: String(p.taskId) } : {}) },
    meta,
  };
}

/** The tracked, audit-friendly view of a payout. */
const TRACKED = [
  'status', 'amountMinor', 'currency', 'fxRate', 'fxDate', 'fxSource', 'inrMinor', 'tdsMinor', 'dueOn', 'paidOn', 'mode', 'transactionRef', 'note', 'taskId', 'attachmentMediaIds',
] as const;
const trackable = (p: ThirdPartyPayoutDoc): Record<string, unknown> => ({
  status: p.status,
  amountMinor: p.amount.amountMinor,
  currency: p.amount.currency,
  fxRate: p.amount.fxRate,
  fxDate: ymd(p.amount.fxDate),
  fxSource: p.amount.fxSource,
  inrMinor: p.amount.inrMinor,
  tdsMinor: p.tdsMinor ?? null,
  dueOn: ymd(p.dueOn),
  paidOn: ymd(p.paidOn),
  mode: p.mode ?? null,
  transactionRef: p.transactionRef ?? null,
  note: p.note ?? null,
  taskId: p.taskId ? String(p.taskId) : null,
  attachmentMediaIds: (p.attachmentMediaIds ?? []).map(String),
});

const sumsChange = (before: { paidMinor: number; dueMinor: number }, after: { paidMinor: number; dueMinor: number }) => [
  ...(before.paidMinor !== after.paidMinor ? [{ path: 'workOrder.paidMinor', before: before.paidMinor, after: after.paidMinor }] : []),
  ...(before.dueMinor !== after.dueMinor ? [{ path: 'workOrder.dueMinor', before: before.dueMinor, after: after.dueMinor }] : []),
];

/** Takes the first write on the work order, or says it does not exist. Closed and cancelled ones refuse NEW payouts. */
async function claimWorkOrder(id: string, session: ClientSession, options: { forNew: boolean }): Promise<WorkOrderDoc> {
  let wo: WorkOrderDoc;
  try {
    wo = await touchWorkOrder(oid(parseObjectId(id)), session);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') throw validationFailed({ workOrderId: 'That work order does not exist' });
    throw error;
  }
  if (options.forNew && !isCurrentStatus(wo.status)) {
    throw conflict(`That work order is ${wo.status}. Reopen it before recording payouts against it.`, { workOrderId: `This work order is ${wo.status}` });
  }
  return wo;
}

// ---------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------

export async function createPayout(viewer: SessionUser, input: CreatePayoutInput, meta: ServiceMeta = {}): Promise<{ payout: PayoutDTO; warnings: string[] }> {
  assertCapability(viewer, 'payout:record');
  const parsed = createPayoutSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const body = parsed.data;
  const requestedDue = body.dueOn ? parseDay(body.dueOn, 'dueOn') : undefined;

  return withTransaction(async (session) => {
    const settings = await loadSettings(session);
    const today = todayDateOnly(new Date(), settings.timezone);
    const dueOn = requestedDue ?? today;

    let wo: WorkOrderDoc | null = null;
    let thirdPartyId: string;
    let projectId: string;
    let currency: string;
    if (body.workOrderId) {
      wo = await claimWorkOrder(body.workOrderId, session, { forNew: true });
      // Everything a work order knows is COPIED. A request that names something else is wrong, not "fixed".
      if (body.thirdPartyId && parseObjectId(body.thirdPartyId) !== String(wo.thirdPartyId)) {
        throw linkMismatch('That third party is not the one on this work order', { thirdPartyId: 'This work order is for a different third party' });
      }
      if (body.projectId && parseObjectId(body.projectId) !== String(wo.projectId)) {
        throw linkMismatch('That project is not the one on this work order', { projectId: 'This work order is for a different project' });
      }
      if (body.clientId && parseObjectId(body.clientId) !== String(wo.clientId)) {
        throw linkMismatch('That client is not the one on this work order', { clientId: 'This work order is for a different client' });
      }
      if (body.taskId && parseObjectId(body.taskId) !== (wo.taskId ? String(wo.taskId) : '')) {
        throw linkMismatch('That task is not the one on this work order', { taskId: 'This work order is for a different task' });
      }
      if (body.currency && body.currency !== wo.agreed.currency) {
        throw currencyMismatch(`This work order is in ${wo.agreed.currency}, so the payout must be in ${wo.agreed.currency} too.`, { currency: `Use ${wo.agreed.currency}, the work order's currency` });
      }
      thirdPartyId = String(wo.thirdPartyId);
      projectId = String(wo.projectId);
      currency = wo.agreed.currency;
    } else {
      if (!body.thirdPartyId) throw validationFailed({ thirdPartyId: 'Pick the third party' });
      if (!body.projectId) throw validationFailed({ projectId: 'Pick the project this cost belongs to' });
      if (!body.currency) throw validationFailed({ currency: 'Pick a currency' });
      thirdPartyId = parseObjectId(body.thirdPartyId);
      projectId = parseObjectId(body.projectId);
      currency = body.currency;
    }

    const party = await ThirdParty.findById(thirdPartyId).session(session).lean();
    if (!party || party.archivedAt || (!wo && party.status !== 'active')) {
      throw validationFailed({ thirdPartyId: 'Pick a third party that is active and not archived' });
    }
    // A concurrent archive of the third party writes the same document, so one of the two retries.
    await ThirdParty.updateOne({ _id: party._id }, { $currentDate: { updatedAt: true } }, { session, timestamps: false });

    const project = await loadOpenProject(projectId, session);
    if (!wo) {
      // The client is whoever owns the project; a request that names another is refused.
      if (body.clientId && parseObjectId(body.clientId) !== String(project.clientId)) {
        throw linkMismatch('That client does not own this project', { clientId: 'This project belongs to a different client' });
      }
    }
    let taskId: Types.ObjectId | undefined;
    if (wo?.taskId) {
      // Copied from the work order: the task stays linked even if it has since been cancelled.
      taskId = (await claimTask(String(wo.taskId), project, session, { requireOpen: false }))._id;
    } else if (!wo && body.taskId) {
      taskId = (await claimTask(body.taskId, project, session))._id;
    }

    assertTds(body.tdsMinor, body.amountMinor);
    const attachmentMediaIds = await verifyAttachments(body.attachmentMediaIds, session);
    const amount = await resolveFx(
      { currency, on: captureDay(dueOn, today), amountMinor: body.amountMinor, manualRate: body.manualRate, settledInrMinor: body.settledInrMinor },
      session,
    );

    const warning = wo ? overrunWarning(wo, body.amountMinor) : null;
    const [created] = await ThirdPartyPayout.create(
      [
        {
          ref: await nextFiscalRef('thirdPartyPayout', today, session),
          thirdPartyId: party._id,
          thirdPartyName: party.name,
          workOrderId: wo?._id,
          clientId: project.clientId,
          projectId: project._id,
          taskId,
          amount,
          tdsMinor: body.tdsMinor,
          status: 'due',
          dueOn,
          note: body.note || undefined,
          attachmentMediaIds,
          recordedBy: snapshot(viewer),
        },
      ],
      { session },
    );
    if (!created) throw new Error('Payout was not created');

    const sums = wo ? await refreshWorkOrderSums(wo._id, session) : null;
    await audit(
      {
        ...auditBase(viewer, created, meta),
        action: 'thirdPartyPayout.create',
        summary: `${fmtMoney(amount.amountMinor, amount.currency)} due to ${party.name}${wo ? ` on ${wo.ref}` : ''}`,
        changes: [
          { path: 'amount', after: `${fmtMoney(amount.amountMinor, amount.currency)} (INR ${(amount.inrMinor / 100).toFixed(2)})` },
          { path: 'dueOn', after: ymd(dueOn) },
          ...(wo && sums ? sumsChange(wo, sums) : []),
        ],
      },
      session,
    );
    return { payout: await dtoFor(viewer, created.toObject(), session), warnings: warning ? [warning] : [] };
  });
}

// ---------------------------------------------------------------------------------------------
// Edit (only while due)
// ---------------------------------------------------------------------------------------------

export async function updatePayout(viewer: SessionUser, id: string, patch: UpdatePayoutInput, meta: ServiceMeta = {}): Promise<{ payout: PayoutDTO; warnings: string[] }> {
  assertCapability(viewer, 'payout:record');
  id = parseObjectId(id);
  const parsed = updatePayoutSchema.safeParse(patch);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const body = parsed.data;
  const newDue = body.dueOn ? parseDay(body.dueOn, 'dueOn') : undefined;

  return withTransaction(async (session) => {
    const doc = await ThirdPartyPayout.findById(id).session(session);
    if (!doc) throw notFound('We could not find that payout');
    if (doc.status !== 'due') {
      throw entryLocked(doc.status === 'paid' ? 'A paid payout can no longer be edited. Void it and record a new one.' : 'A voided payout cannot be edited.');
    }
    // The first write on the work order, so a payout edited at the same moment as a sibling conflicts and retries.
    const wo = doc.workOrderId ? await claimWorkOrder(String(doc.workOrderId), session, { forNew: false }) : null;

    const before = trackable(doc.toObject());
    const oldAmount = doc.amount.amountMinor;
    const amountMinor = body.amountMinor ?? oldAmount;
    const currency = body.currency ?? doc.amount.currency;
    if (wo && currency !== wo.agreed.currency) {
      throw currencyMismatch(`This work order is in ${wo.agreed.currency}, so the payout must be in ${wo.agreed.currency} too.`, { currency: `Use ${wo.agreed.currency}, the work order's currency` });
    }
    const fxProvided = body.manualRate !== undefined || body.settledInrMinor !== undefined;
    const today = todayDateOnly(new Date(), (await loadSettings(session)).timezone);
    const dueOn = newDue ?? doc.dueOn ?? doc.amount.fxDate;
    const moneyChanged = fxProvided || amountMinor !== oldAmount || currency !== doc.amount.currency || (newDue !== undefined && newDue.getTime() !== doc.dueOn?.getTime());

    if (moneyChanged) {
      // A rate typed by hand, or the one the bank applied, is kept when the same currency is edited:
      // only a table rate is looked up again for the new amount or date (plan section 4).
      const keepRate = !fxProvided && currency === doc.amount.currency && (doc.amount.fxSource === 'manual' || doc.amount.fxSource === 'bank');
      doc.amount = await resolveFx(
        {
          currency,
          on: captureDay(dueOn, today),
          amountMinor,
          manualRate: keepRate ? doc.amount.fxRate : body.manualRate,
          settledInrMinor: body.settledInrMinor,
        },
        session,
      );
    }
    if (newDue) doc.dueOn = newDue;

    const tds = body.tdsMinor === undefined ? doc.tdsMinor : body.tdsMinor;
    assertTds(tds, amountMinor);
    if (body.tdsMinor !== undefined) doc.tdsMinor = body.tdsMinor ?? undefined;
    if (body.note !== undefined) doc.note = body.note || undefined;

    if (body.taskId !== undefined) {
      const requested = body.taskId ? parseObjectId(body.taskId) : null;
      const current = doc.taskId ? String(doc.taskId) : null;
      if (requested !== current) {
        if (wo) throw linkMismatch('This payout takes its task from the work order', { taskId: 'The work order decides the task' });
        if (requested) {
          const project = await loadOpenProject(String(doc.projectId), session);
          doc.taskId = (await claimTask(requested, project, session))._id;
        } else {
          doc.taskId = undefined;
        }
      }
    }
    if (body.attachmentMediaIds !== undefined) doc.attachmentMediaIds = await verifyAttachments(body.attachmentMediaIds, session);

    const changes = diffFields(before, trackable(doc.toObject()), TRACKED);
    if (changes.length === 0) return { payout: await dtoFor(viewer, doc.toObject(), session), warnings: [] };

    await doc.save({ session });
    let warnings: string[] = [];
    let sumNotes: ReturnType<typeof sumsChange> = [];
    if (wo) {
      const sums = await refreshWorkOrderSums(wo._id, session);
      sumNotes = sumsChange(wo, sums);
      const warning = overrunWarning({ agreed: wo.agreed, paidMinor: sums.paidMinor, dueMinor: sums.dueMinor });
      warnings = warning ? [warning] : [];
    }
    await audit({ ...auditBase(viewer, doc, meta), action: 'thirdPartyPayout.update', changes: [...changes, ...sumNotes] }, session);
    return { payout: await dtoFor(viewer, doc.toObject(), session), warnings };
  });
}

// ---------------------------------------------------------------------------------------------
// Mark paid and void
// ---------------------------------------------------------------------------------------------

/**
 * Marks a due payout paid. Needs `money:approve` (superadmins). The paid date is the day the money left
 * the account (not in the future); the mode comes from Settings; a transaction reference is needed
 * unless it was cash. The exchange rate is CAPTURED AGAIN for the paid date (`resolveFx`: the table rate
 * for that day, the exact rate the bank used, or the INR that actually left), because that is when INR
 * moved. The due-date capture is kept in the audit entry's changes.
 */
export async function markPayoutPaid(viewer: SessionUser, id: string, input: MarkPaidInput, meta: ServiceMeta = {}): Promise<PayoutDTO> {
  assertCapability(viewer, 'money:approve');
  id = parseObjectId(id);
  const parsed = markPaidSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const body = parsed.data;
  const paidOn = parseDay(body.paidOn, 'paidOn');

  return withTransaction(async (session) => {
    const settings = await loadSettings(session);
    if (paidOn.getTime() > todayDateOnly(new Date(), settings.timezone).getTime()) {
      throw validationFailed({ paidOn: 'The paid date cannot be in the future' });
    }
    if (!settings.paymentModes.includes(body.mode)) throw validationFailed({ mode: 'Pick one of the payment modes set up in Settings' });
    const transactionRef = body.transactionRef?.trim() || undefined;
    if (!transactionRef && body.mode !== 'cash') throw validationFailed({ transactionRef: 'Enter the transaction reference' });

    const doc = await ThirdPartyPayout.findById(id).session(session);
    if (!doc) throw notFound('We could not find that payout');
    if (doc.status !== 'due') throw conflict(doc.status === 'paid' ? 'This payout is already marked paid' : 'This payout was voided, so it cannot be paid');
    const wo = doc.workOrderId ? await claimWorkOrder(String(doc.workOrderId), session, { forNew: false }) : null;

    const before = trackable(doc.toObject());
    // A transfer confirmation can be attached at the moment of paying; what is already attached stays.
    if (body.attachmentMediaIds && body.attachmentMediaIds.length > 0) {
      const merged = [...new Set([...(doc.attachmentMediaIds ?? []).map(String), ...body.attachmentMediaIds.map((i) => i.toLowerCase())])];
      if (merged.length > MAX_ATTACHMENTS) throw validationFailed({ attachmentMediaIds: `At most ${MAX_ATTACHMENTS} attachments` });
      doc.attachmentMediaIds = await verifyAttachments(merged, session);
    }
    doc.amount = await resolveFx(
      { currency: doc.amount.currency, on: paidOn, amountMinor: doc.amount.amountMinor, manualRate: body.manualRate, settledInrMinor: body.settledInrMinor },
      session,
    );
    doc.status = 'paid';
    doc.paidOn = paidOn;
    doc.paidBy = snapshot(viewer);
    doc.mode = body.mode;
    doc.transactionRef = transactionRef;
    await doc.save({ session });

    const sums = wo ? await refreshWorkOrderSums(wo._id, session) : null;
    await audit(
      {
        ...auditBase(viewer, doc, meta),
        action: 'thirdPartyPayout.mark_paid',
        summary: `Paid ${fmtMoney(doc.amount.amountMinor, doc.amount.currency)} to ${doc.thirdPartyName} on ${ymd(paidOn)}`,
        // The due-date capture (the "before" values) is kept here; the document now carries the paid-date capture.
        changes: [...diffFields(before, trackable(doc.toObject()), TRACKED), ...(wo && sums ? sumsChange(wo, sums) : [])],
      },
      session,
    );
    return dtoFor(viewer, doc.toObject(), session);
  });
}

/** Voids a payout with a reason. Needs `money:void`. A void payout counts nowhere; the work order's sums follow. */
export async function voidPayout(viewer: SessionUser, id: string, input: VoidPayoutInput | string, meta: ServiceMeta = {}): Promise<PayoutDTO> {
  assertCapability(viewer, 'money:void');
  id = parseObjectId(id);
  const parsed = voidPayoutSchema.safeParse(typeof input === 'string' ? { reason: input } : input);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const { reason } = parsed.data;

  return withTransaction(async (session) => {
    const doc = await ThirdPartyPayout.findById(id).session(session);
    if (!doc) throw notFound('We could not find that payout');
    if (doc.status === 'void') throw conflict('This payout is already void');
    const wo = doc.workOrderId ? await claimWorkOrder(String(doc.workOrderId), session, { forNew: false }) : null;

    const from = doc.status;
    doc.status = 'void';
    doc.voidReason = reason;
    doc.voidedBy = snapshot(viewer);
    await doc.save({ session });

    const sums = wo ? await refreshWorkOrderSums(wo._id, session) : null;
    await audit(
      {
        ...auditBase(viewer, doc, meta),
        action: 'thirdPartyPayout.void',
        summary: reason,
        changes: [{ path: 'status', before: from, after: 'void' }, ...(wo && sums ? sumsChange(wo, sums) : [])],
      },
      session,
    );
    return dtoFor(viewer, doc.toObject(), session);
  });
}

/** For the pages: a project's name for a filter note. Not a capability gate: the caller already holds `payout:view`. */
export async function getProjectOption(viewer: SessionUser, projectId: string): Promise<{ id: string; label: string; ref: string } | null> {
  assertCapability(viewer, 'payout:view');
  if (!/^[a-f\d]{24}$/i.test(projectId)) return null;
  await connectToDatabase();
  const p = await Project.findById(projectId.toLowerCase()).select('name ref').lean();
  return p ? { id: String(p._id), label: p.name, ref: p.ref } : null;
}
