import { Types, type AnyBulkWriteOperation, type ClientSession } from 'mongoose';
import { mongoose, connectToDatabase, withTransaction } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { conflict, entryLocked, forbidden, linkMismatch, notFound, validationFailed } from '@/lib/api/errors';
import { formatDate } from '@/lib/admin/format';
import { escapeRegex, pageMeta, type PageMeta } from '@/lib/admin/search-params';
import { formatDateOnly, parseDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { allocationInrShares } from '@/lib/money/apportion';
import { formatMinor } from '@/lib/money/minor';
import { fieldErrors, parseObjectId } from '@/lib/validation/common';
import {
  createTeamPayoutSchema,
  markPaidSchema,
  payoutListQuerySchema,
  updateTeamPayoutSchema,
  voidPayoutSchema,
  type AllocationInput,
  type CreateTeamPayoutInput,
  type MarkPaidInput,
  type PayoutFilter,
  type PayoutSort,
  type TeamPayoutBasis,
  type UpdateTeamPayoutInput,
} from '@/lib/validation/team-payout';
import { Admin, Counter, Project, TeamPayout, WorkLog, type CounterDoc, type MoneyDoc, type TeamPayoutDoc } from '@/models';
import type { PayoutAllocation } from '@/models/team-payout.model';
import type { SessionUser } from '@/types/session';
import type { ServiceMeta } from './admin.service';
import { audit, diffFields, type AuditActor } from './audit.service';
import { resolveFx } from './fx.service';
import { nextFiscalRef } from './refs';
import { getSettings, loadSettings } from './settings.service';
import { projectBriefs, type TaskProjectDTO } from './task.service';
import { workLogDayLockKey } from './work-log.service';
import {
  assertPeriod,
  computeSuggestion,
  parsePeriod,
  storableSuggestion,
  UNKNOWN_PROJECT,
  type Facts,
  type StoredSuggestion,
} from './team-payout-suggestion.service';

export { computeSuggestedMinor, getPayoutSuggestion, type PayoutSuggestionDTO, type StoredSuggestion } from './team-payout-suggestion.service';

/**
 * Payments to team members (plan sections 2, 3, 4 and 6).
 *
 * WHO MAY DO WHAT
 *   record or edit a DUE payout   teamPayout:record
 *   mark paid                      money:approve   (the paid date, mode and transaction reference are required)
 *   void                           money:void      (with a reason; a paid payout can be voided too)
 *   read                           the person themself, or team:payView. The person gets the amount, status, dates, mode
 *                                  and reference of THEIR OWN payouts and nothing else: no allocations, no internal note,
 *                                  no suggestion, no void reason. Another admin gets nothing.
 * Nobody is barred from recording a payout for themself: superadmins pay each other and themselves.
 *
 * THE MONEY
 *   The payout's `amount` is a Money subdocument built by `resolveFx` for the DUE date. Marking it paid captures the rate AGAIN for
 *   the paid date (that is when the money left the account), so the INR figure changes with it. Every allocation's INR share is
 *   recomputed from the payout's INR value by largest remainder (`allocationInrShares`), at creation, at every edit and again at
 *   mark-paid, so the shares can never add up to more than the payout and a fully allocated payout adds up to exactly its INR
 *   value. Project margins (the ledger) sum those shares of PAID payouts, so they have to be right at the moment of payment.
 *
 * THE LOCK
 *   Marking a payout paid sets `lockedByPayoutId` on every work log of that person dated inside the period, in the SAME
 *   transaction as the status change and the audit entry. Voiding it clears the lock (and re-applies another paid payout's,
 *   when periods overlap). The work-log service refuses edits to a locked log and refuses new logs dated inside a paid period.
 *   Those two checks are only a SNAPSHOT read, so paying also touches the per-day counter that the work-log service writes
 *   when it logs time: a log being added at the same moment conflicts with the payment, one retries, and the retry sees the lock.
 *
 * HOW PAY IS SUGGESTED lives in `team-payout-suggestion.service.ts`; this file records what is proposed next to the final amount.
 */

const DAY = 86_400_000;
const oid = (id: string) => new Types.ObjectId(id);
const iso = (d: Date) => formatDateOnly(d);
const isoOrNull = (d?: Date | null) => (d ? formatDateOnly(d) : null);
const actorOf = (v: SessionUser): AuditActor => ({ id: v.id, name: v.name, role: v.role });
const snapshot = (v: SessionUser) => ({ id: new Types.ObjectId(v.id), name: v.name });
const isSelf = (v: SessionUser, adminId: string | Types.ObjectId) => v.id.toLowerCase() === String(adminId);
const money = (m: { amountMinor: number; currency: string }) => formatMinor(m.amountMinor, m.currency, m.currency === 'INR' ? 'en-IN' : 'en-US');

export interface PayoutMoneyDTO {
  amountMinor: number;
  currency: string;
  fxRate: number;
  /** "YYYY-MM-DD" */
  fxDate: string;
  fxSource: string;
  inrMinor: number;
}

export interface PayoutAllocationDTO {
  projectId: string;
  projectRef: string;
  projectName: string;
  clientId: string;
  clientName: string;
  /** In the payout's own currency. */
  amountMinor: number;
  /** This allocation's share of the payout in INR: what the project's margin counts. */
  inrMinor: number;
  /** The time the person logged on this project in the period, when the payout was recorded. */
  minutes: number;
  archived: boolean;
}

/** What only an entitled viewer (`team:payView`) receives. A person reading their own payout has `detail: null`. */
export interface TeamPayoutDetail {
  suggestion: StoredSuggestion | null;
  note: string | null;
  allocations: PayoutAllocationDTO[];
  allocatedInrMinor: number;
  /** The rest of the payout in INR: company overhead. */
  unallocatedInrMinor: number;
  recordedBy: string;
  paidBy: string | null;
  voidReason: string | null;
  voidedBy: string | null;
  voidedAt: string | null;
  /** Work logs this payout locks right now (single reads of a paid payout only). */
  lockedLogs: number | null;
  /** Work logs marking it paid would lock: the person's, inside the period, not already covered (single reads of a due payout only). */
  logsToLock: number | null;
  /** Worth a second look before paying: an overlapping payout, a period that runs past today (single reads of a due payout). */
  warnings: string[];
}

export interface TeamPayoutDTO {
  id: string;
  ref: string;
  adminId: string;
  adminName: string;
  basis: TeamPayoutBasis;
  /** "YYYY-MM-DD", inclusive. */
  periodFrom: string;
  periodTo: string;
  amount: PayoutMoneyDTO;
  status: TeamPayoutDoc['status'];
  dueOn: string | null;
  paidOn: string | null;
  mode: string | null;
  transactionRef: string | null;
  createdAt: string;
  detail: TeamPayoutDetail | null;
}

// ---------------------------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------------------------

const moneyDTO = (m: MoneyDoc): PayoutMoneyDTO => ({
  amountMinor: m.amountMinor,
  currency: m.currency,
  fxRate: m.fxRate,
  fxDate: iso(m.fxDate),
  fxSource: m.fxSource,
  inrMinor: m.inrMinor,
});

async function toDTOs(docs: TeamPayoutDoc[], full: boolean, session?: ClientSession): Promise<TeamPayoutDTO[]> {
  const projects = full ? await projectBriefs(docs.flatMap((d) => d.allocations.map((a) => a.projectId)), session) : new Map<string, TaskProjectDTO>();
  return docs.map((d) => {
    const allocated = d.allocations.reduce((s, a) => s + a.inrMinor, 0);
    return {
      id: String(d._id),
      ref: d.ref,
      adminId: String(d.adminId),
      adminName: d.adminName,
      basis: d.basis,
      periodFrom: iso(d.periodFrom),
      periodTo: iso(d.periodTo),
      amount: moneyDTO(d.amount),
      status: d.status,
      dueOn: isoOrNull(d.dueOn),
      paidOn: isoOrNull(d.paidOn),
      mode: d.mode ?? null,
      transactionRef: d.transactionRef ?? null,
      createdAt: d.createdAt.toISOString(),
      detail: full
        ? {
            suggestion: d.suggestion && d.suggestion.computedMinor !== undefined
              ? {
                  minutes: d.suggestion.minutes ?? 0,
                  taskCount: d.suggestion.taskCount ?? 0,
                  rateMinor: d.suggestion.rateMinor ?? 0,
                  currency: d.suggestion.currency ?? d.amount.currency,
                  computedMinor: d.suggestion.computedMinor,
                }
              : null,
            note: d.note ?? null,
            allocations: d.allocations.map((a) => {
              const p = projects.get(String(a.projectId)) ?? UNKNOWN_PROJECT(a.projectId);
              return {
                projectId: String(a.projectId),
                projectRef: p.ref,
                projectName: p.name,
                clientId: String(a.clientId),
                clientName: p.clientName,
                amountMinor: a.amountMinor,
                inrMinor: a.inrMinor,
                minutes: a.minutes ?? 0,
                archived: p.archived,
              };
            }),
            allocatedInrMinor: allocated,
            unallocatedInrMinor: d.unallocatedInrMinor,
            recordedBy: d.recordedBy.name,
            paidBy: d.paidBy?.name ?? null,
            voidReason: d.voidReason ?? null,
            voidedBy: d.voidedBy?.name ?? null,
            voidedAt: d.voidedAt ? d.voidedAt.toISOString() : null,
            lockedLogs: null,
            logsToLock: null,
            warnings: [],
          }
        : null,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Rules shared by the writes
// ---------------------------------------------------------------------------------------------

/**
 * Turns the requested split into stored allocations. Client and minutes are derived (the client from the project, the minutes
 * from the person's own logs), the INR shares come from the payout's INR value, and nothing can exceed the payout.
 * A project already in the split may stay in it after being archived; a NEW link to an archived project is refused.
 */
async function buildAllocations(
  inputs: readonly AllocationInput[],
  amount: MoneyDoc,
  facts: Facts,
  existing: ReadonlySet<string>,
  session: ClientSession,
): Promise<PayoutAllocation[]> {
  if (inputs.length === 0) return [];
  const ids = inputs.map((a) => oid(a.projectId));
  const projects = await Project.find({ _id: mongoose.trusted({ $in: ids }) }).select('clientId archivedAt name ref').session(session).lean();
  const byId = new Map(projects.map((p) => [String(p._id), p]));
  const minutes = new Map(facts.byProject.map((p) => [String(p.projectId), p.minutes]));

  inputs.forEach((a, i) => {
    const field = `allocations.${i}.projectId`;
    const project = byId.get(a.projectId);
    if (!project) throw validationFailed({ [field]: 'That project does not exist' });
    if (project.archivedAt && !existing.has(a.projectId)) {
      const message = 'That project is archived, so it cannot take new costs. Remove it from the split.';
      throw conflict(message, { [field]: message });
    }
    if (a.clientId && a.clientId !== String(project.clientId)) {
      throw linkMismatch('That client does not own this project', { [`allocations.${i}.clientId`]: 'This project belongs to a different client' });
    }
  });

  const native = inputs.map((a) => a.amountMinor);
  const total = native.reduce((s, n) => s + n, 0);
  if (total > amount.amountMinor) {
    const message = `The split is ${money({ amountMinor: total, currency: amount.currency })}, which is more than the payout (${money(amount)}).`;
    throw validationFailed({ allocations: message });
  }
  const shares = allocationInrShares(amount.amountMinor, amount.inrMinor, native);
  return inputs.map((a, i) => ({
    clientId: (byId.get(a.projectId) as { clientId: Types.ObjectId }).clientId,
    projectId: oid(a.projectId),
    amountMinor: a.amountMinor,
    inrMinor: shares[i] ?? 0,
    minutes: minutes.get(a.projectId) ?? 0,
  }));
}

/** Things worth a second look. Never blocks. */
async function collectWarnings(doc: Pick<TeamPayoutDoc, '_id' | 'adminId' | 'basis' | 'periodFrom' | 'periodTo' | 'adminName'>, today: Date, session?: ClientSession): Promise<string[]> {
  const out: string[] = [];
  const clashes = await TeamPayout.find({
    _id: mongoose.trusted({ $ne: doc._id }),
    adminId: doc.adminId,
    basis: doc.basis,
    status: mongoose.trusted({ $ne: 'void' }),
    periodFrom: mongoose.trusted({ $lte: doc.periodTo }),
    periodTo: mongoose.trusted({ $gte: doc.periodFrom }),
  })
    .select('ref periodFrom periodTo status')
    .sort({ periodFrom: 1 })
    .limit(5)
    .session(session ?? null)
    .lean();
  for (const c of clashes) {
    out.push(`This period overlaps ${c.ref} (${formatDate(c.periodFrom)} to ${formatDate(c.periodTo)}, ${c.status}), the same kind of payout for ${doc.adminName}. Check they are not paid twice for the same time.`);
  }
  if (doc.periodTo > today) {
    out.push(`The period runs to ${formatDate(doc.periodTo)}, which is after today. Once this is marked paid, time logged for the remaining days is refused.`);
  }
  return out;
}

function assertEditable(doc: Pick<TeamPayoutDoc, 'status'>): void {
  if (doc.status === 'paid') throw entryLocked('A paid payout cannot be changed. Void it with a reason and record a new one.');
  if (doc.status === 'void') throw conflict('A void payout cannot be changed.');
}

async function loadPayout(id: string, session: ClientSession) {
  const doc = await TeamPayout.findById(parseObjectId(id)).session(session);
  if (!doc) throw notFound('We could not find that payout');
  return doc;
}

/**
 * Touches the counter the work-log service writes for each (person, day) when it logs time. A log being added to a day in the
 * period at the same moment as the payment then CONFLICTS with it, one transaction retries, and the retry sees the paid
 * period and refuses (or, if it committed first, is locked by the update below). Without this, both would commit and a log
 * would sit unlocked inside a paid period. The key is the work-log service's `workLogDayLockKey`, the same one `lockWorkLogDay` touches.
 */
async function guardPeriodDays(adminId: Types.ObjectId, from: Date, to: Date, session: ClientSession): Promise<void> {
  const ops: AnyBulkWriteOperation<CounterDoc>[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY) {
    ops.push({ updateOne: { filter: { _id: workLogDayLockKey(adminId, new Date(t)) }, update: { $inc: { seq: 1 } }, upsert: true } });
  }
  if (ops.length > 0) await Counter.bulkWrite(ops, { session, ordered: false });
}

const TRACKED = [
  'basis',
  'periodFrom',
  'periodTo',
  'dueOn',
  'amount.amountMinor',
  'amount.currency',
  'amount.fxRate',
  'amount.fxSource',
  'amount.inrMinor',
  'note',
  'allocations',
  'suggestion',
] as const;

type Trackable = Pick<TeamPayoutDoc, 'basis' | 'periodFrom' | 'periodTo' | 'dueOn' | 'amount' | 'note' | 'allocations' | 'suggestion'>;

const trackable = (d: Trackable): Record<string, unknown> => ({
  basis: d.basis,
  periodFrom: iso(d.periodFrom),
  periodTo: iso(d.periodTo),
  dueOn: isoOrNull(d.dueOn),
  amount: { amountMinor: d.amount.amountMinor, currency: d.amount.currency, fxRate: d.amount.fxRate, fxSource: d.amount.fxSource, inrMinor: d.amount.inrMinor },
  note: d.note ?? null,
  allocations: d.allocations.map((a) => ({ projectId: String(a.projectId), amountMinor: a.amountMinor, inrMinor: a.inrMinor })),
  suggestion: d.suggestion?.computedMinor !== undefined ? d.suggestion : null,
});

/**
 * The audit context of a payout: a project's activity feed is filtered by `context.projectId`, so a payout charged to a single
 * project (or a single client) carries it. A payout split across several projects names none: one entry cannot belong to many.
 */
function auditContext(allocations: ReadonlyArray<{ clientId: Types.ObjectId; projectId: Types.ObjectId }>): { clientId?: string; projectId?: string } {
  const clients = new Set(allocations.map((a) => String(a.clientId)));
  const projects = new Set(allocations.map((a) => String(a.projectId)));
  return {
    ...(clients.size === 1 ? { clientId: [...clients][0] } : {}),
    ...(projects.size === 1 ? { projectId: [...projects][0] } : {}),
  };
}

function requireDate(value: string, field: string): Date {
  const d = parseDateOnly(value);
  if (!d) throw validationFailed({ [field]: 'Enter a valid date' });
  return d;
}

/** The person's logs inside the period that marking this payout paid would lock (the ones another paid payout holds stay with it). */
function countLogsToLock(doc: Pick<TeamPayoutDoc, 'adminId' | 'periodFrom' | 'periodTo'>, session?: ClientSession): Promise<number> {
  return WorkLog.countDocuments({ adminId: doc.adminId, workedOn: mongoose.trusted({ $gte: doc.periodFrom, $lte: doc.periodTo }), lockedByPayoutId: null }).session(session ?? null);
}

/** A single payout read as the caller's DTO plus its warnings, built inside the transaction that wrote it. */
async function written(viewer: SessionUser, doc: TeamPayoutDoc, today: Date, session: ClientSession, lockedLogs: number | null = null) {
  const full = viewer.capabilities.has('team:payView');
  const [dto] = await toDTOs([doc], full, session);
  if (!dto) throw new Error('Team payout could not be mapped');
  const warnings = doc.status === 'void' ? [] : await collectWarnings(doc, today, session);
  if (dto.detail) {
    dto.detail.warnings = doc.status === 'due' ? warnings : [];
    dto.detail.lockedLogs = lockedLogs;
    if (doc.status === 'due') dto.detail.logsToLock = await countLogsToLock(doc, session);
  }
  return { payout: dto, warnings };
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

/**
 * Records a payout as DUE. The server builds the amount (`resolveFx` for the due date), derives each allocation's client and INR
 * share, snapshots what the system would have proposed, and numbers it TMP-FY27-0001 in the financial year of the due date.
 * An overlapping payout for the same person and basis is a WARNING in the result, not an error.
 */
export async function createTeamPayout(viewer: SessionUser, input: CreateTeamPayoutInput, meta: ServiceMeta = {}, now = new Date()) {
  assertCapability(viewer, 'teamPayout:record');
  const parsed = createTeamPayoutSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const body = parsed.data;
  const adminId = oid(parseObjectId(body.adminId));
  const { from, to } = parsePeriod(body.periodFrom, body.periodTo);

  return withTransaction(async (session) => {
    const settings = await loadSettings(session);
    const today = todayDateOnly(now, settings.timezone);
    const dueOn = body.dueOn ? requireDate(body.dueOn, 'dueOn') : today;
    const person = await Admin.findById(adminId).select('name').session(session).lean();
    if (!person) throw notFound('We could not find that person');

    const core = await computeSuggestion(adminId, from, to, settings.timezone, session);
    const amount = await resolveFx({ currency: body.currency, on: dueOn.getTime() > today.getTime() ? today : dueOn, amountMinor: body.amountMinor, manualRate: body.manualRate, settledInrMinor: body.settledInrMinor }, session);
    const allocations = await buildAllocations(body.allocations, amount, core.facts, new Set(), session);
    const ref = await nextFiscalRef('teamPayout', dueOn, session);

    const [created] = await TeamPayout.create(
      [
        {
          ref,
          adminId,
          adminName: person.name,
          basis: body.basis,
          periodFrom: from,
          periodTo: to,
          suggestion: storableSuggestion(core, body.basis),
          amount,
          status: 'due',
          dueOn,
          note: body.note || undefined,
          allocations,
          recordedBy: snapshot(viewer),
        },
      ],
      { session },
    );
    if (!created) throw new Error('Team payout was not created');
    const doc = created.toObject();

    await audit(
      {
        actor: actorOf(viewer),
        action: 'teamPayout.create',
        entity: { type: 'teamPayout', id: String(doc._id), ref: doc.ref, label: person.name },
        context: auditContext(doc.allocations),
        summary: `Recorded ${money(doc.amount)} due ${formatDate(dueOn)} for ${formatDate(from)} to ${formatDate(to)}`,
        changes: [
          { path: 'basis', after: doc.basis },
          { path: 'periodFrom', after: iso(from) },
          { path: 'periodTo', after: iso(to) },
          { path: 'amount.amountMinor', after: doc.amount.amountMinor },
          { path: 'amount.currency', after: doc.amount.currency },
          { path: 'amount.fxRate', after: doc.amount.fxRate },
          { path: 'amount.inrMinor', after: doc.amount.inrMinor },
          { path: 'allocations', after: trackable(doc).allocations },
          ...(doc.suggestion?.computedMinor !== undefined ? [{ path: 'suggestion', after: doc.suggestion }] : []),
        ],
        meta,
      },
      session,
    );
    return written(viewer, doc, today, session);
  });
}

/**
 * Edits a DUE payout (a paid one is immutable: void it and record a new one). Anything left out stays. When the amount, the
 * currency or the due date changes the rate is captured again for the due date (a rate typed by hand is kept); the allocations'
 * INR shares always follow the final amount. A request that changes nothing writes nothing.
 */
export async function updateTeamPayout(viewer: SessionUser, id: string, patch: UpdateTeamPayoutInput, meta: ServiceMeta = {}, now = new Date()) {
  assertCapability(viewer, 'teamPayout:record');
  const payoutId = parseObjectId(id);
  const parsed = updateTeamPayoutSchema.safeParse(patch);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const body = parsed.data;

  return withTransaction(async (session) => {
    const doc = await loadPayout(payoutId, session);
    assertEditable(doc);
    const plain = doc.toObject();
    const settings = await loadSettings(session);
    const today = todayDateOnly(now, settings.timezone);

    const from = body.periodFrom ? requireDate(body.periodFrom, 'periodFrom') : plain.periodFrom;
    const to = body.periodTo ? requireDate(body.periodTo, 'periodTo') : plain.periodTo;
    assertPeriod(from, to);
    const basis = body.basis ?? plain.basis;
    const dueOn = body.dueOn ? requireDate(body.dueOn, 'dueOn') : (plain.dueOn ?? today);
    const amountMinor = body.amountMinor ?? plain.amount.amountMinor;
    const currency = body.currency ?? plain.amount.currency;

    const moneyChanged =
      amountMinor !== plain.amount.amountMinor ||
      currency !== plain.amount.currency ||
      dueOn.getTime() !== (plain.dueOn ?? today).getTime() ||
      body.manualRate !== undefined ||
      body.settledInrMinor !== undefined;
    let amount: MoneyDoc = plain.amount;
    if (moneyChanged) {
      // A rate typed by hand stays; a table rate is looked up again for the (possibly new) date.
      const keepManual = body.manualRate === undefined && body.settledInrMinor === undefined && plain.amount.fxSource === 'manual' && currency === plain.amount.currency;
      amount = await resolveFx(
        { currency, on: dueOn, amountMinor, manualRate: body.manualRate ?? (keepManual ? plain.amount.fxRate : undefined), settledInrMinor: body.settledInrMinor },
        session,
      );
    }

    const periodChanged = from.getTime() !== plain.periodFrom.getTime() || to.getTime() !== plain.periodTo.getTime();
    const core = await computeSuggestion(plain.adminId, from, to, settings.timezone, session);
    const requested = body.allocations ?? plain.allocations.map((a) => ({ projectId: String(a.projectId), amountMinor: a.amountMinor }));
    const allocations = await buildAllocations(requested, amount, core.facts, new Set(plain.allocations.map((a) => String(a.projectId))), session);
    // The proposal is of the period: it is taken again when the period or kind of payout changes, and otherwise left as it was.
    const suggestion = periodChanged || basis !== plain.basis ? storableSuggestion(core, basis) : plain.suggestion?.computedMinor !== undefined ? plain.suggestion : storableSuggestion(core, basis);
    const note = body.note !== undefined ? body.note || undefined : plain.note;

    const next: Trackable = { basis, periodFrom: from, periodTo: to, dueOn, amount, note, allocations, suggestion };
    const changes = diffFields(trackable(plain), trackable(next), TRACKED);
    if (changes.length === 0) return written(viewer, plain, today, session);

    doc.set({ basis, periodFrom: from, periodTo: to, dueOn, amount, allocations, suggestion, note });
    await doc.save({ session }); // validates the invariants again (allocations never exceed the payout) and derives the overhead
    const after = doc.toObject();
    await audit(
      {
        actor: actorOf(viewer),
        action: 'teamPayout.update',
        entity: { type: 'teamPayout', id: String(after._id), ref: after.ref, label: after.adminName },
        context: auditContext(after.allocations),
        changes,
        meta,
      },
      session,
    );
    return written(viewer, after, today, session);
  });
}

/**
 * Marks a due payout paid. In ONE transaction: the rate is captured again for the paid date, every allocation's INR share is
 * recomputed from the new INR value (project margins read those), the status and payment details are set, the person's work
 * logs dated inside the period are locked, and the audit entry is written.
 */
export async function markTeamPayoutPaid(viewer: SessionUser, id: string, input: MarkPaidInput, meta: ServiceMeta = {}, now = new Date()) {
  assertCapability(viewer, 'money:approve');
  const payoutId = parseObjectId(id);
  const parsed = markPaidSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const body = parsed.data;
  const paidOn = requireDate(body.paidOn, 'paidOn');

  return withTransaction(async (session) => {
    const settings = await loadSettings(session);
    const today = todayDateOnly(now, settings.timezone);
    if (paidOn > today) throw validationFailed({ paidOn: 'The paid date cannot be in the future' });
    if (!settings.paymentModes.includes(body.mode)) throw validationFailed({ mode: 'Pick one of the payment modes set up in Settings' });

    const doc = await loadPayout(payoutId, session);
    if (doc.status === 'paid') throw conflict('This payout is already marked paid');
    if (doc.status === 'void') throw conflict('A void payout cannot be marked paid');
    const plain = doc.toObject();

    // The money left the account on the paid date, so that is the date whose rate counts.
    const amount = await resolveFx(
      { currency: plain.amount.currency, on: paidOn, amountMinor: plain.amount.amountMinor, manualRate: body.manualRate, settledInrMinor: body.settledInrMinor },
      session,
    );
    const shares = allocationInrShares(plain.amount.amountMinor, amount.inrMinor, plain.allocations.map((a) => a.amountMinor));

    doc.set({
      amount,
      allocations: plain.allocations.map((a, i) => ({ ...a, inrMinor: shares[i] ?? 0 })),
      status: 'paid',
      paidOn,
      mode: body.mode,
      transactionRef: body.transactionRef,
      paidBy: snapshot(viewer),
      ...(body.note !== undefined ? { note: body.note || undefined } : {}),
    });
    await doc.save({ session });
    const after = doc.toObject();

    await guardPeriodDays(after.adminId, after.periodFrom, after.periodTo, session);
    const locked = await WorkLog.updateMany(
      { adminId: after.adminId, workedOn: mongoose.trusted({ $gte: after.periodFrom, $lte: after.periodTo }), lockedByPayoutId: null },
      { $set: { lockedByPayoutId: after._id } },
      { session, timestamps: false }, // locking is not an edit of the log
    );

    await audit(
      {
        actor: actorOf(viewer),
        action: 'teamPayout.mark_paid',
        entity: { type: 'teamPayout', id: String(after._id), ref: after.ref, label: after.adminName },
        context: auditContext(after.allocations),
        summary: `Paid ${money(after.amount)} on ${formatDate(paidOn)}`,
        changes: [
          { path: 'status', before: 'due', after: 'paid' },
          { path: 'paidOn', after: iso(paidOn) },
          { path: 'mode', after: body.mode },
          { path: 'transactionRef', after: body.transactionRef },
          ...diffFields(
            { amount: { fxRate: plain.amount.fxRate, fxDate: iso(plain.amount.fxDate), fxSource: plain.amount.fxSource, inrMinor: plain.amount.inrMinor } },
            { amount: { fxRate: after.amount.fxRate, fxDate: iso(after.amount.fxDate), fxSource: after.amount.fxSource, inrMinor: after.amount.inrMinor } },
            ['amount.fxRate', 'amount.fxDate', 'amount.fxSource', 'amount.inrMinor'],
          ),
          ...(after.allocations.length > 0
            ? [{ path: 'allocations.inrMinor', before: plain.allocations.map((a) => a.inrMinor), after: after.allocations.map((a) => a.inrMinor) }]
            : []),
          { path: 'workLogsLocked', after: locked.modifiedCount },
        ],
        meta,
      },
      session,
    );
    return written(viewer, after, today, session, locked.modifiedCount);
  });
}

/**
 * Voids a payout with a reason: it drops out of every total, and the work logs it locked are released (a log another paid
 * payout of the same person also covers goes back under that payout's lock). A void payout stays on record.
 */
export async function voidTeamPayout(viewer: SessionUser, id: string, input: { reason: string }, meta: ServiceMeta = {}, now = new Date()) {
  assertCapability(viewer, 'money:void');
  const payoutId = parseObjectId(id);
  const parsed = voidPayoutSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));

  return withTransaction(async (session) => {
    const settings = await loadSettings(session);
    const today = todayDateOnly(now, settings.timezone);
    const doc = await loadPayout(payoutId, session);
    if (doc.status === 'void') throw conflict('This payout is already void');
    const wasPaid = doc.status === 'paid';
    const before = doc.status;

    doc.set({ status: 'void', voidReason: parsed.data.reason, voidedBy: snapshot(viewer), voidedAt: new Date() });
    await doc.save({ session });
    const after = doc.toObject();

    let released = 0;
    if (wasPaid) {
      const result = await WorkLog.updateMany({ lockedByPayoutId: after._id }, { $unset: { lockedByPayoutId: 1 } }, { session, timestamps: false });
      released = result.modifiedCount;
      const others = await TeamPayout.find({ adminId: after.adminId, status: 'paid', _id: mongoose.trusted({ $ne: after._id }) })
        .select('periodFrom periodTo')
        .session(session)
        .lean();
      for (const other of others) {
        await WorkLog.updateMany(
          { adminId: after.adminId, workedOn: mongoose.trusted({ $gte: other.periodFrom, $lte: other.periodTo }), lockedByPayoutId: null },
          { $set: { lockedByPayoutId: other._id } },
          { session, timestamps: false },
        );
      }
    }

    await audit(
      {
        actor: actorOf(viewer),
        action: 'teamPayout.void',
        entity: { type: 'teamPayout', id: String(after._id), ref: after.ref, label: after.adminName },
        context: auditContext(after.allocations),
        summary: parsed.data.reason,
        changes: [{ path: 'status', before, after: 'void' }, ...(wasPaid ? [{ path: 'workLogsUnlocked', after: released }] : [])],
        meta,
      },
      session,
    );
    return written(viewer, after, today, session, wasPaid ? 0 : null);
  });
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/** One payout. The person it is for, or `team:payView`, may read it; the person gets the plain version (`detail: null`). */
export async function getTeamPayout(viewer: SessionUser, id: string, now = new Date()): Promise<TeamPayoutDTO> {
  const payoutId = parseObjectId(id);
  await connectToDatabase();
  const doc = await TeamPayout.findById(payoutId).lean();
  if (!doc) throw notFound('We could not find that payout');
  const full = viewer.capabilities.has('team:payView');
  if (!full && !isSelf(viewer, doc.adminId)) throw forbidden('Your access does not allow this action');

  const [dto] = await toDTOs([doc], full);
  if (!dto) throw new Error('Team payout could not be mapped');
  if (dto.detail) {
    const settings = await getSettings();
    if (doc.status === 'due') {
      dto.detail.warnings = await collectWarnings(doc, todayDateOnly(now, settings.timezone));
      dto.detail.logsToLock = await countLogsToLock(doc);
    }
    if (doc.status === 'paid') dto.detail.lockedLogs = await WorkLog.countDocuments({ lockedByPayoutId: doc._id });
  }
  return dto;
}

export { PAYOUT_SORTS, type PayoutSort } from '@/lib/validation/team-payout';

export interface PayoutSearch extends PayoutFilter {
  /** Date-only, inclusive. A payout is "in" the period by the day it was paid, or by its due date until it is. */
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
  sort?: PayoutSort;
  dir?: 'asc' | 'desc';
}

const SORT_FIELD: Record<PayoutSort, string> = { createdAt: 'createdAt', dueOn: 'dueOn', paidOn: 'paidOn', amount: 'amount.inrMinor', person: 'adminName' };

/**
 * The scope a viewer may read: everyone's with `team:payView`, otherwise only their own. Asking for someone else's is refused
 * outright (not silently narrowed), so a probe learns nothing.
 */
function readScope(viewer: SessionUser, adminId?: string): { all: boolean; adminId?: Types.ObjectId } {
  const requested = adminId ? parseObjectId(adminId) : undefined;
  if (viewer.capabilities.has('team:payView')) return { all: true, adminId: requested ? oid(requested) : undefined };
  if (requested && !isSelf(viewer, requested)) throw forbidden('Your access does not allow this action');
  return { all: false, adminId: oid(viewer.id.toLowerCase()) };
}

/** The payouts list. Everyone's with `team:payView`; otherwise only the caller's own, in the plain version. */
export async function searchTeamPayouts(viewer: SessionUser, params: PayoutSearch = {}): Promise<{ items: TeamPayoutDTO[]; meta: PageMeta }> {
  const scope = readScope(viewer, params.adminId);
  await connectToDatabase();

  const filter: Record<string, unknown> = {};
  if (scope.adminId) filter.adminId = scope.adminId;
  if (params.status) filter.status = params.status;
  const and: Array<Record<string, unknown>> = [];
  if (scope.all && params.q) {
    const re = new RegExp(escapeRegex(params.q.slice(0, 80)), 'i');
    and.push({ $or: [{ ref: re }, { adminName: re }] });
  }
  if (params.from || params.to) {
    const range = mongoose.trusted({ ...(params.from ? { $gte: params.from } : {}), ...(params.to ? { $lte: params.to } : {}) });
    and.push({ $or: [{ paidOn: range }, { paidOn: null, dueOn: range }] });
  }
  if (and.length > 0) filter.$and = and;

  const pageSize = Math.min(Math.max(params.pageSize ?? 25, 1), 100);
  const total = await TeamPayout.countDocuments(filter);
  const meta = pageMeta(Math.max(params.page ?? 1, 1), pageSize, total);
  const sortKey = SORT_FIELD[params.sort ?? 'createdAt'];
  const dir = (params.dir ?? 'desc') === 'asc' ? 1 : -1;
  const docs = await TeamPayout.find(filter)
    .sort({ [sortKey]: dir, _id: -1 })
    .skip((meta.page - 1) * pageSize)
    .limit(pageSize)
    .lean();
  return { items: await toDTOs(docs, scope.all), meta };
}

/** The route's GET: the same search from query-string text. */
export async function listTeamPayouts(viewer: SessionUser, query: unknown) {
  const parsed = payoutListQuerySchema.safeParse(query);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const q = parsed.data;
  return searchTeamPayouts(viewer, {
    adminId: q.adminId,
    status: q.status,
    q: q.q,
    from: q.from ? (parseDateOnly(q.from) ?? undefined) : undefined,
    to: q.to ? (parseDateOnly(q.to) ?? undefined) : undefined,
    page: q.page,
    pageSize: q.pageSize,
    sort: q.sort,
    dir: q.dir,
  });
}

/** A person's latest payouts (the person page). The person themself, or `team:payView`. */
export async function listPersonPayouts(viewer: SessionUser, adminId: string, limit = 10): Promise<TeamPayoutDTO[]> {
  const scope = readScope(viewer, adminId);
  await connectToDatabase();
  const docs = await TeamPayout.find({ adminId: scope.adminId })
    .sort({ createdAt: -1, _id: -1 })
    .limit(Math.min(Math.max(limit, 1), 50))
    .lean();
  return toDTOs(docs, scope.all);
}

export interface NativeLine {
  currency: string;
  amountMinor: number;
  inrMinor: number;
}

export interface PayoutTotals {
  paid: { inrMinor: number; count: number; native: NativeLine[]; unallocatedInrMinor: number };
  /** Due dates inside the period. */
  due: { inrMinor: number; count: number; overdueCount: number; native: NativeLine[] };
  /** Everything still unpaid, whatever its due date: what is owed right now. */
  owed: { inrMinor: number; count: number };
}

interface Group {
  _id: string;
  amountMinor: number;
  inrMinor: number;
  unallocated: number;
  n: number;
  overdue: number;
}

/**
 * The totals band of the payouts list. Needs `team:payView`. Paid counts by the day it was paid and due by its due date; void is
 * never counted. Summed from `amount.inrMinor` only; native amounts come back grouped by currency as a second line. The
 * figures ignore the list's status and search filters on purpose (so choosing "Due" does not blank the Paid tile) but follow
 * the person filter.
 */
export async function getPayoutTotals(viewer: SessionUser, range: { from: Date; to: Date }, filter: { adminId?: string } = {}, now = new Date()): Promise<PayoutTotals> {
  assertCapability(viewer, 'team:payView');
  await connectToDatabase();
  const settings = await getSettings();
  const today = todayDateOnly(now, settings.timezone);
  const person = filter.adminId ? { adminId: oid(parseObjectId(filter.adminId)) } : {};
  const group = {
    $group: {
      _id: '$amount.currency',
      amountMinor: { $sum: '$amount.amountMinor' },
      inrMinor: { $sum: '$amount.inrMinor' },
      unallocated: { $sum: '$unallocatedInrMinor' },
      n: { $sum: 1 },
      overdue: { $sum: { $cond: [{ $lt: ['$dueOn', today] }, 1, 0] } },
    },
  };
  const [facets] = await TeamPayout.aggregate<{ paid: Group[]; due: Group[]; owed: Group[] }>([
    { $match: { ...person, status: { $in: ['paid', 'due'] } } },
    {
      $facet: {
        paid: [{ $match: { status: 'paid', paidOn: { $gte: range.from, $lte: range.to } } }, group, { $sort: { _id: 1 } }],
        due: [{ $match: { status: 'due', dueOn: { $gte: range.from, $lte: range.to } } }, group, { $sort: { _id: 1 } }],
        owed: [{ $match: { status: 'due' } }, group],
      },
    },
  ]);
  const sum = (rows: Group[] | undefined, key: 'inrMinor' | 'n' | 'overdue' | 'unallocated') => (rows ?? []).reduce((s, r) => s + r[key], 0);
  const native = (rows: Group[] | undefined): NativeLine[] =>
    (rows ?? []).filter((r) => r._id !== 'INR').map((r) => ({ currency: r._id, amountMinor: r.amountMinor, inrMinor: r.inrMinor }));
  return {
    paid: { inrMinor: sum(facets?.paid, 'inrMinor'), count: sum(facets?.paid, 'n'), native: native(facets?.paid), unallocatedInrMinor: sum(facets?.paid, 'unallocated') },
    due: { inrMinor: sum(facets?.due, 'inrMinor'), count: sum(facets?.due, 'n'), overdueCount: sum(facets?.due, 'overdue'), native: native(facets?.due) },
    owed: { inrMinor: sum(facets?.owed, 'inrMinor'), count: sum(facets?.owed, 'n') },
  };
}
