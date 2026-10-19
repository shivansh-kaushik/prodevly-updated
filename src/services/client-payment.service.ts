import { Types, type ClientSession } from 'mongoose';
import { BASE_CURRENCY } from '@/config/currencies';
import { conflict, linkMismatch, notFound, paymentExceedsDue, validationFailed } from '@/lib/api/errors';
import { assertCapability } from '@/lib/auth/guard';
import { formatDateOnly, parseDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { mongoose, withTransaction } from '@/lib/db/mongoose';
import { buildMoney } from '@/lib/money/fx';
import { billableTotalMinor } from '@/lib/money/margin';
import { fieldErrors, parseObjectId } from '@/lib/validation/common';
import {
  recordPaymentSchema,
  updatePaymentSchema,
  voidPaymentSchema,
  type RecordPaymentInput,
  type UpdatePaymentInput,
} from '@/lib/validation/payment';
import { Client, ClientPayment, Media, Project, Task, type ClientPaymentDoc, type MoneyDoc, type ProjectDoc } from '@/models';
import type { SessionUser } from '@/types/session';
import type { ServiceMeta } from './admin.service';
import { audit, diffFields, type AuditActor } from './audit.service';
import { loadBriefs, toPaymentDTO, type PaymentDTO } from './client-payment.dto';
import {
  checkDue,
  contractEquivalentFromInr,
  exceedsMessage,
  nextMilestoneStatus,
  sayMoney,
  SIGNED_CONTRACT,
  signed,
  type MilestoneStatus,
  type PaymentType,
} from './client-payment.rules';
import { resolveFx, lookupRate } from './fx.service';
import { canViewMedia } from './media.service';
import { nextFiscalRef } from './refs';
import { loadSettings } from './settings.service';

export type { PaymentDTO } from './client-payment.dto';
export * from './client-payment.read';
export type { ServiceMeta };

/**
 * Client payments: money received from clients (plan sections 2, 3 and 4).
 *
 * Who may do what, enforced here and again in the route layer:
 * - view and list: payment:view
 * - record and edit: payment:record (which brings payment:view)
 * - void: money:void (superadmins only; never grantable)
 * - "record as advance": money:approve, also superadmins only
 *
 * Every entry names a PROJECT. The client is derived from it and a task or milestone must belong to it
 * (LINK_MISMATCH otherwise). The INR value is computed here by `resolveFx`; nothing the browser sends can
 * set it. An entry is never deleted: it is voided with a reason, and a voided entry drops out of every
 * total and stays on the page with a Void badge. Each write, its audit entry and any milestone it moves
 * commit together or not at all.
 *
 * Concurrency: every write that depends on the project's totals also WRITES the project (and the task, if
 * linked) inside its transaction, so two payments recorded at the same moment, or a payment racing a contract
 * edit or a task move, conflict and one retries against the other's result. A plain read under snapshot
 * isolation would let both pass the "more than is billable" check.
 */

const oid = (id: string) => new Types.ObjectId(id);
const snapshot = (v: SessionUser) => ({ id: oid(v.id), name: v.name });
const actorOf = (v: SessionUser): AuditActor => ({ id: v.id, name: v.name, role: v.role });
const ymd = (d: Date) => formatDateOnly(d);

/* ------------------------------------------------------------------ totals */

/** Net received toward the contract on a project, over received payments only (void is out). */
async function netReceived(projectId: Types.ObjectId, session: ClientSession): Promise<number> {
  const [row] = await ClientPayment.aggregate<{ total: number }>([
    { $match: { projectId, status: 'received' } },
    { $group: { _id: null, total: { $sum: SIGNED_CONTRACT } } },
  ]).session(session);
  return row?.total ?? 0;
}

async function milestoneNet(projectId: Types.ObjectId, milestoneId: Types.ObjectId, session: ClientSession): Promise<number> {
  const [row] = await ClientPayment.aggregate<{ total: number }>([
    { $match: { projectId, milestoneId, status: 'received' } },
    { $group: { _id: null, total: { $sum: SIGNED_CONTRACT } } },
  ]).session(session);
  return row?.total ?? 0;
}

/* --------------------------------------------------------------- milestones */

interface MilestoneKey {
  projectId: Types.ObjectId;
  milestoneId: Types.ObjectId;
}
const keyOf = (k: MilestoneKey) => `${String(k.projectId)}:${String(k.milestoneId)}`;

function uniqueKeys(keys: ReadonlyArray<MilestoneKey | null | undefined>): MilestoneKey[] {
  const seen = new Map<string, MilestoneKey>();
  for (const k of keys) if (k) seen.set(keyOf(k), k);
  return [...seen.values()];
}

/** What the payments linked to each milestone add up to NOW (call before the write, and again after it). */
async function coverageOf(keys: MilestoneKey[], session: ClientSession): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const k of keys) out.set(keyOf(k), await milestoneNet(k.projectId, k.milestoneId, session)); // sequential: one session
  return out;
}

/**
 * Moves milestones whose coverage changed: covered means paid, and a paid milestone that a void or an edit
 * uncovers goes back to invoiced. Every move is its own audit entry on the project, naming the milestone.
 */
async function rollUpMilestones(
  viewer: SessionUser,
  keys: MilestoneKey[],
  before: Map<string, number>,
  payment: Pick<ClientPaymentDoc, 'ref'>,
  cause: 'recorded' | 'changed' | 'voided',
  meta: ServiceMeta,
  session: ClientSession,
): Promise<void> {
  for (const key of keys) {
    const project = await Project.findById(key.projectId).session(session).lean();
    const milestone = project?.milestones.find((m) => String(m._id) === String(key.milestoneId));
    if (!project || !milestone) continue;
    const after = await milestoneNet(key.projectId, key.milestoneId, session);
    const next = nextMilestoneStatus(milestone.status as MilestoneStatus, milestone.amountMinor, before.get(keyOf(key)) ?? 0, after);
    if (!next) continue;
    await Project.updateOne(
      { _id: project._id, 'milestones._id': milestone._id },
      { $set: { 'milestones.$.status': next, updatedBy: snapshot(viewer) } },
      { session },
    );
    await audit(
      {
        actor: actorOf(viewer),
        action: 'project.update',
        entity: { type: 'project', id: String(project._id), ref: project.ref, label: project.name },
        // The summary stays neutral: project viewers without payment:view read it, and the status and the payment
        // are money. Both are in `changes`, which the project's activity feed hides from them (milestones.* paths).
        summary: `Milestone "${milestone.title}" updated from its payments`,
        changes: [
          { path: `milestones.${String(milestone._id)}.status`, before: milestone.status, after: next },
          { path: `milestones.${String(milestone._id)}.cause`, after: `${payment.ref} ${cause}` },
        ],
        context: { clientId: String(project.clientId), projectId: String(project._id) },
        meta,
      },
      session,
    );
  }
}

/* -------------------------------------------------------------------- rules */

function assertMode(mode: string, allowed: readonly string[]): void {
  if (!allowed.includes(mode)) throw validationFailed({ mode: 'Pick one of the payment modes set up in Settings' });
}

/** "Not in the future" is the organisation's today, which can already be tomorrow in UTC. */
function assertNotFuture(receivedOn: Date, timezone: string, now: Date): void {
  if (receivedOn.getTime() > todayDateOnly(now, timezone).getTime()) throw validationFailed({ receivedOn: 'The date cannot be in the future' });
}

/**
 * The project a NEW link may point at: it must exist, must not be archived, and must not be an internal
 * project (plan section 4: internal projects never count as revenue, so money "received" on one would be
 * recorded and then missing from every total).
 */
async function loadOpenProject(id: string, session: ClientSession): Promise<ProjectDoc> {
  const project = await Project.findById(id).session(session).lean();
  if (!project) throw validationFailed({ projectId: 'That project does not exist' });
  if (project.archivedAt) throw conflict('That project is archived. Restore it before recording money against it.', { projectId: 'This project is archived' });
  const client = await Client.findById(project.clientId).select('isInternal').session(session).lean();
  if (client?.isInternal) throw validationFailed({ projectId: 'That is an internal project. Client payments are recorded against client projects.' });
  return project;
}

async function loadProject(id: Types.ObjectId, session: ClientSession): Promise<ProjectDoc> {
  const project = await Project.findById(id).session(session).lean();
  if (!project) throw notFound('We could not find that project');
  return project;
}

/** The task must belong to the project, and (for a NEW link) be open: not archived, not cancelled. */
async function resolveTask(taskId: string, project: ProjectDoc, session: ClientSession) {
  const task = await Task.findById(taskId).session(session).lean();
  if (!task) throw validationFailed({ taskId: 'That task does not exist' });
  if (String(task.projectId) !== String(project._id)) {
    throw linkMismatch('That task belongs to a different project', { taskId: 'This task is not on the chosen project' });
  }
  if (task.archivedAt) throw conflict('That task is archived. Restore it before recording money against it.', { taskId: 'This task is archived' });
  if (task.status === 'cancelled') throw validationFailed({ taskId: 'That task is cancelled. Money cannot be linked to it.' });
  return task;
}

function resolveMilestone(milestoneId: string, project: ProjectDoc) {
  const milestone = project.milestones.find((m) => String(m._id) === milestoneId);
  if (!milestone) throw linkMismatch('That milestone is not on this project', { milestoneId: 'This milestone is not on the chosen project' });
  return milestone;
}

/** Writes the task so a concurrent move or delete of it conflicts with this transaction. */
async function touchTask(taskId: Types.ObjectId, session: ClientSession): Promise<void> {
  const result = await Task.updateOne({ _id: taskId }, { $currentDate: { updatedAt: true } }, { session, timestamps: false });
  if (result.matchedCount !== 1) throw validationFailed({ taskId: 'That task no longer exists' });
}

/** Writes the project (see the header): the lock the "more than is billable" check relies on. */
async function touchProject(projectId: Types.ObjectId, session: ClientSession): Promise<void> {
  const result = await Project.updateOne({ _id: projectId }, { $currentDate: { updatedAt: true } }, { session, timestamps: false });
  if (result.matchedCount !== 1) throw notFound('We could not find that project');
}

/** Private payment files that exist and that this viewer may open. Returns the ids as ObjectIds. */
async function checkAttachments(viewer: SessionUser, ids: readonly string[], session: ClientSession): Promise<Types.ObjectId[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await Media.find({ _id: mongoose.trusted({ $in: unique.map(oid) }) })
    .session(session)
    .lean();
  const good = new Set(rows.filter((m) => m.visibility === 'private' && m.purpose === 'payment' && canViewMedia(viewer, m)).map((m) => String(m._id)));
  if (unique.some((id) => !good.has(id))) {
    throw validationFailed({ attachmentMediaIds: 'One of those files is not available as a payment attachment. Upload it again.' });
  }
  return unique.map(oid);
}

/**
 * The amount in the project's contract currency (plan section 4). The same currency: the amount itself,
 * and a different explicit figure is refused. Another currency: the explicit figure when the person gave
 * one (their correction wins), otherwise the payment's INR value over the contract currency's rate on the
 * received date. No usable rate means there is nothing to compute from, so the person must say it.
 */
async function contractEquivalentFor(
  args: { amount: MoneyDoc; contractCurrency: string; explicit?: number; receivedOn: Date },
  session: ClientSession,
): Promise<number> {
  const { amount, contractCurrency, explicit } = args;
  if (amount.currency === contractCurrency) {
    if (explicit !== undefined && explicit !== amount.amountMinor) {
      throw validationFailed({ contractEquivalentMinor: 'In the contract currency this is the amount itself' });
    }
    return amount.amountMinor;
  }
  if (explicit !== undefined) return explicit;
  const rate = await lookupRate(contractCurrency, args.receivedOn, session);
  const value = rate && !rate.stale ? contractEquivalentFromInr(amount.inrMinor, contractCurrency, rate.rate) : null;
  if (value === null || value < 1) {
    throw validationFailed({
      contractEquivalentMinor: rate && !rate.stale
        ? `Enter how much of the ${contractCurrency} contract this settles: the amount is too small to convert`
        : `There is no recent ${contractCurrency} rate for this date. Enter how much of the ${contractCurrency} contract this payment settles.`,
    });
  }
  return value;
}

interface DueArgs {
  project: ProjectDoc;
  type: PaymentType;
  amount: MoneyDoc;
  contractEquivalentMinor: number;
  receivedOthersMinor: number;
  /** The payment's contribution before an edit; null when recording a new one. */
  wasContributionMinor: number | null;
  wasAdvance: boolean;
  ticked: boolean;
  canAdvance: boolean;
}

/**
 * PAYMENT_EXCEEDS_DUE (plan section 4) and its companions, in the contract currency:
 * - nothing can leave less than nothing received (a refund of more than was received is refused);
 * - a receipt in the contract currency that takes the total above the billable total is refused, unless a
 *   superadmin ticked "Record as advance";
 * - another currency never blocks: it returns one warning saying what it counts as.
 * An edit that does not increase the payment's contribution is not re-judged against the billable total.
 */
function evaluateDue(a: DueArgs): { advance: boolean; warnings: string[] } {
  const billableMinor = billableTotalMinor(a.project.contract, a.project.milestones);
  const contractCurrency = a.project.contract.currency;
  const contribution = signed(a.type, a.contractEquivalentMinor);
  const due = checkDue({ receivedOthersMinor: a.receivedOthersMinor, contributionMinor: contribution, billableMinor });
  if (due.negative) {
    throw validationFailed({
      amountMinor: `That leaves more refunded than received on this project (${sayMoney(Math.max(0, a.receivedOthersMinor), contractCurrency)} received by the other entries)`,
    });
  }

  const warnings: string[] = [];
  let advance = false;
  const sameCurrency = a.amount.currency === contractCurrency;
  if (a.type === 'receipt' && due.exceeds) {
    const increased = a.wasContributionMinor === null || contribution > a.wasContributionMinor;
    if (sameCurrency && increased) {
      if (!(a.ticked && a.canAdvance)) throw paymentExceedsDue(exceedsMessage(due, billableMinor, contractCurrency, a.canAdvance));
      advance = true;
    } else if (sameCurrency) {
      advance = a.wasAdvance;
    }
  }
  if (!sameCurrency) {
    warnings.push(
      `Paid in ${a.amount.currency} against a ${contractCurrency} contract: it counts as ${sayMoney(a.contractEquivalentMinor, contractCurrency)} toward the contract${
        a.type === 'receipt' && due.exceeds ? ', which takes the total received above what is billable. Check that figure.' : '.'
      }`,
    );
  }
  return { advance, warnings };
}

/** `buildMoney` throws plain Errors for an incoherent entry; a caller's bad input must be a 422, never a 500. */
function keepRate(amountMinor: number, currency: string, before: MoneyDoc, fxDate: Date): MoneyDoc {
  try {
    return buildMoney({ amountMinor, currency, fxRate: before.fxRate, fxDate, fxSource: before.fxSource === 'bank' ? 'bank' : 'manual' }) as MoneyDoc;
  } catch (error) {
    throw validationFailed({ amountMinor: error instanceof Error ? error.message : 'That amount cannot be converted' });
  }
}

/* ------------------------------------------------------------------- record */

const auditBase = (viewer: SessionUser, p: Pick<ClientPaymentDoc, '_id' | 'ref' | 'clientId' | 'projectId' | 'taskId'>, label: string, meta: ServiceMeta) => ({
  actor: actorOf(viewer),
  entity: { type: 'payment', id: String(p._id), ref: p.ref, label },
  context: { clientId: String(p.clientId), projectId: String(p.projectId), ...(p.taskId ? { taskId: String(p.taskId) } : {}) },
  meta,
});

/**
 * Records money received from a client (or refunded to one). The body names a project, never an INR
 * value. Returns the entry with `warnings` (another currency than the contract, or an advance).
 */
export async function recordPayment(viewer: SessionUser, input: RecordPaymentInput, meta: ServiceMeta = {}, now = new Date()): Promise<PaymentDTO> {
  assertCapability(viewer, 'payment:record');
  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const body = parsed.data;
  const receivedOn = parseDateOnly(body.receivedOn);
  if (!receivedOn) throw validationFailed({ receivedOn: 'Enter a valid date' });
  const canAdvance = viewer.capabilities.has('money:approve');

  return withTransaction(async (session) => {
    const settings = await loadSettings(session);
    assertMode(body.mode, settings.paymentModes);
    assertNotFuture(receivedOn, settings.timezone, now);

    const project = await loadOpenProject(body.projectId, session);
    if (body.clientId && body.clientId !== String(project.clientId)) {
      throw linkMismatch('That client does not own this project', { clientId: 'This project belongs to a different client' });
    }
    const task = body.taskId ? await resolveTask(body.taskId, project, session) : null;
    const milestone = body.milestoneId ? resolveMilestone(body.milestoneId, project) : null;
    const attachments = await checkAttachments(viewer, body.attachmentMediaIds, session);

    // Writes first (the locks), then the reads they protect.
    await touchProject(project._id, session);
    if (task) await touchTask(task._id, session);

    const amount = await resolveFx(
      { currency: body.currency, on: receivedOn, amountMinor: body.amountMinor, manualRate: body.manualRate, settledInrMinor: body.settledInrMinor },
      session,
    );
    const contractEquivalentMinor = await contractEquivalentFor(
      { amount, contractCurrency: project.contract.currency, explicit: body.contractEquivalentMinor, receivedOn },
      session,
    );
    const { advance, warnings } = evaluateDue({
      project,
      type: body.type,
      amount,
      contractEquivalentMinor,
      receivedOthersMinor: await netReceived(project._id, session),
      wasContributionMinor: null,
      wasAdvance: false,
      ticked: body.recordAsAdvance === true,
      canAdvance,
    });
    if (advance) warnings.push('Recorded as an advance: more has been received than is billable on this project.');

    const keys = uniqueKeys([milestone ? { projectId: project._id, milestoneId: milestone._id } : null]);
    const before = await coverageOf(keys, session);
    const ref = await nextFiscalRef('payment', receivedOn, session);
    const [created] = await ClientPayment.create(
      [
        {
          ref,
          type: body.type,
          clientId: project.clientId,
          projectId: project._id,
          ...(task ? { taskId: task._id } : {}),
          ...(milestone ? { milestoneId: milestone._id } : {}),
          amount,
          contractEquivalentMinor,
          ...(body.tdsMinor ? { tdsMinor: body.tdsMinor } : {}),
          ...(body.chargesMinor ? { chargesMinor: body.chargesMinor } : {}),
          receivedOn,
          mode: body.mode,
          ...(body.transactionRef ? { transactionRef: body.transactionRef } : {}),
          ...(body.invoiceRef ? { invoiceRef: body.invoiceRef } : {}),
          ...(body.note ? { note: body.note } : {}),
          attachmentMediaIds: attachments,
          ...(advance ? { recordedAsAdvance: true } : {}),
          status: 'received',
          recordedBy: snapshot(viewer),
        },
      ],
      { session },
    );
    if (!created) throw new Error('Payment was not recorded');
    const doc = created.toObject();

    await audit(
      {
        ...auditBase(viewer, doc, sayMoney(amount.amountMinor, amount.currency), meta),
        action: 'payment.create',
        summary: `${body.type === 'refund' ? 'Refunded' : 'Received'} ${sayMoney(amount.amountMinor, amount.currency)}${amount.currency === BASE_CURRENCY ? '' : ` (${sayMoney(amount.inrMinor, BASE_CURRENCY)})`} on ${project.ref}`,
        // The same paths an edit reports, so a payment's history reads the same from its first entry on.
        changes: [
          { path: 'amountMinor', after: amount.amountMinor },
          { path: 'currency', after: amount.currency },
          { path: 'fxRate', after: amount.fxRate },
          { path: 'fxSource', after: amount.fxSource },
          { path: 'inrMinor', after: amount.inrMinor },
          { path: 'receivedOn', after: ymd(receivedOn) },
          { path: 'contractEquivalentMinor', after: contractEquivalentMinor },
          ...(milestone ? [{ path: 'milestoneId', after: String(milestone._id) }] : []),
          ...(advance ? [{ path: 'recordedAsAdvance', after: true }] : []),
        ],
      },
      session,
    );
    await rollUpMilestones(viewer, keys, before, doc, 'recorded', meta, session);
    return toPaymentDTO(doc, await loadBriefs([doc], session), warnings);
  });
}

/* --------------------------------------------------------------------- edit */

const TRACKED = [
  'amountMinor', 'currency', 'fxRate', 'fxSource', 'inrMinor', 'receivedOn', 'contractEquivalentMinor', 'projectId', 'clientId', 'taskId',
  'milestoneId', 'tdsMinor', 'chargesMinor', 'mode', 'transactionRef', 'invoiceRef', 'noteLength', 'attachmentMediaIds', 'recordedAsAdvance',
] as const;

const trackable = (p: ClientPaymentDoc): Record<string, unknown> => ({
  amountMinor: p.amount.amountMinor,
  currency: p.amount.currency,
  fxRate: p.amount.fxRate,
  fxSource: p.amount.fxSource,
  inrMinor: p.amount.inrMinor,
  receivedOn: ymd(p.receivedOn),
  contractEquivalentMinor: p.contractEquivalentMinor,
  projectId: String(p.projectId),
  clientId: String(p.clientId),
  taskId: p.taskId ? String(p.taskId) : null,
  milestoneId: p.milestoneId ? String(p.milestoneId) : null,
  tdsMinor: p.tdsMinor ?? null,
  chargesMinor: p.chargesMinor ?? null,
  mode: p.mode,
  transactionRef: p.transactionRef ?? null,
  invoiceRef: p.invoiceRef ?? null,
  // The free-text note can hold bank details: the append-only log records only THAT it changed, never its text.
  noteLength: p.note?.length ?? 0,
  attachmentMediaIds: (p.attachmentMediaIds ?? []).map(String),
  recordedAsAdvance: Boolean(p.recordedAsAdvance),
});

/**
 * Corrects a received entry. Needs payment:record, and only while it is `received` (a void is final).
 * Amount, currency, date and links recompute the money through `resolveFx` unless the rate was typed by
 * hand or applied by the bank (then the rate stays and only the INR value follows the amount), or the body
 * gives a rate or asks for the table rate. A request that changes nothing writes nothing. Every real change
 * is audited with before and after, and the milestones it moves are rolled up in the same transaction.
 */
export async function updatePayment(viewer: SessionUser, id: string, patch: UpdatePaymentInput, meta: ServiceMeta = {}, now = new Date()): Promise<PaymentDTO> {
  assertCapability(viewer, 'payment:record');
  const paymentId = parseObjectId(id);
  const parsed = updatePaymentSchema.safeParse(patch);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const body = parsed.data;
  const nextDate = body.receivedOn ? parseDateOnly(body.receivedOn) : null;
  if (body.receivedOn && !nextDate) throw validationFailed({ receivedOn: 'Enter a valid date' });
  const canAdvance = viewer.capabilities.has('money:approve');

  return withTransaction(async (session) => {
    const before = await ClientPayment.findById(paymentId).session(session).lean();
    if (!before) throw notFound('We could not find that payment');
    if (before.status !== 'received') throw conflict('This payment is void and can no longer be changed. Record a new one instead.');
    const settings = await loadSettings(session);

    const receivedOn = nextDate ?? before.receivedOn;
    if (nextDate && nextDate.getTime() !== before.receivedOn.getTime()) assertNotFuture(nextDate, settings.timezone, now);
    if (body.mode !== undefined && body.mode !== before.mode) assertMode(body.mode, settings.paymentModes);

    // Links: the project can move (an entry recorded against the wrong one); the client follows it.
    const projectChanged = body.projectId !== undefined && body.projectId !== String(before.projectId);
    const project = projectChanged ? await loadOpenProject(body.projectId as string, session) : await loadProject(before.projectId, session);
    if (body.clientId && body.clientId !== String(project.clientId)) {
      throw linkMismatch('That client does not own this project', { clientId: 'This project belongs to a different client' });
    }

    const nextTaskId = body.taskId === undefined ? (before.taskId ?? null) : body.taskId === null ? null : oid(body.taskId);
    const nextMilestoneId = body.milestoneId === undefined ? (before.milestoneId ?? null) : body.milestoneId === null ? null : oid(body.milestoneId);
    const taskChanged = String(nextTaskId ?? '') !== String(before.taskId ?? '');
    const milestoneChanged = String(nextMilestoneId ?? '') !== String(before.milestoneId ?? '');
    // A link is re-checked when it, or the project it hangs from, changed. An untouched link is left alone:
    // its task may have been cancelled since, and that must not block fixing a typo in the reference.
    if (nextTaskId && (taskChanged || projectChanged)) await resolveTask(String(nextTaskId), project, session);
    if (nextMilestoneId && (milestoneChanged || projectChanged)) resolveMilestone(String(nextMilestoneId), project);
    const attachments = body.attachmentMediaIds ? await checkAttachments(viewer, body.attachmentMediaIds, session) : null;

    // Money.
    const nextCurrency = body.currency ?? before.amount.currency;
    const nextAmountMinor = body.amountMinor ?? before.amount.amountMinor;
    const explicitFx = body.manualRate !== undefined || body.settledInrMinor !== undefined;
    const moneyInputsChanged =
      nextAmountMinor !== before.amount.amountMinor || nextCurrency !== before.amount.currency || receivedOn.getTime() !== before.receivedOn.getTime();
    let amount: MoneyDoc = before.amount;
    if (explicitFx || body.useTableRate || moneyInputsChanged) {
      const handRate = before.amount.fxSource === 'manual' || before.amount.fxSource === 'bank';
      amount =
        handRate && !explicitFx && !body.useTableRate && nextCurrency === before.amount.currency
          ? keepRate(nextAmountMinor, nextCurrency, before.amount, receivedOn)
          : await resolveFx({ currency: nextCurrency, on: receivedOn, amountMinor: nextAmountMinor, manualRate: body.manualRate, settledInrMinor: body.settledInrMinor }, session);
    }
    const contractCurrency = project.contract.currency;
    let contractEquivalentMinor = before.contractEquivalentMinor;
    if (body.contractEquivalentMinor !== undefined || projectChanged || amount.inrMinor !== before.amount.inrMinor || nextAmountMinor !== before.amount.amountMinor || nextCurrency !== before.amount.currency) {
      contractEquivalentMinor = await contractEquivalentFor({ amount, contractCurrency, explicit: body.contractEquivalentMinor, receivedOn }, session);
    }

    // Totals: the other entries of the project, without this one's old contribution.
    const oldContribution = signed(before.type, before.contractEquivalentMinor);
    if (projectChanged) {
      const leftBehind = (await netReceived(before.projectId, session)) - oldContribution;
      if (leftBehind < 0) throw conflict('Moving this entry would leave its old project with more refunded than received.');
    }
    const targetNet = await netReceived(project._id, session);
    const { advance, warnings } = evaluateDue({
      project,
      type: before.type,
      amount,
      contractEquivalentMinor,
      receivedOthersMinor: projectChanged ? targetNet : targetNet - oldContribution,
      wasContributionMinor: projectChanged ? null : oldContribution,
      wasAdvance: Boolean(before.recordedAsAdvance),
      ticked: body.recordAsAdvance === true,
      canAdvance,
    });
    if (advance) warnings.push('Recorded as an advance: more has been received than is billable on this project.');

    // What changes.
    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    const put = (path: string, value: unknown) => {
      if (value === null) unset[path] = 1;
      else if (value !== undefined) set[path] = value;
    };
    set.amount = amount;
    set.contractEquivalentMinor = contractEquivalentMinor;
    set.receivedOn = receivedOn;
    set.projectId = project._id;
    set.clientId = project.clientId;
    put('taskId', nextTaskId);
    put('milestoneId', nextMilestoneId);
    if (body.tdsMinor !== undefined) put('tdsMinor', body.tdsMinor || null);
    if (body.chargesMinor !== undefined) put('chargesMinor', body.chargesMinor || null);
    if (body.mode !== undefined) set.mode = body.mode;
    for (const field of ['transactionRef', 'invoiceRef', 'note'] as const) put(field, body[field]);
    if (attachments) set.attachmentMediaIds = attachments;
    if (advance) set.recordedAsAdvance = true;
    else unset.recordedAsAdvance = 1;

    const prospective = { ...before, ...set } as ClientPaymentDoc;
    for (const key of Object.keys(unset)) delete (prospective as unknown as Record<string, unknown>)[key];
    const changes = diffFields(trackable(before), trackable(prospective), TRACKED);
    if (changes.length === 0) return toPaymentDTO(before, await loadBriefs([before], session), warnings);

    // The locks (see the header) are taken only for a real change: a request that changes nothing writes nothing,
    // not even the project's "updated" time. Snapshot isolation makes the order against the reads above immaterial:
    // whoever wrote these documents after this transaction began makes this write conflict, and it retries.
    const lockTasks = [...new Set([before.taskId, nextTaskId].filter((t): t is Types.ObjectId => Boolean(t)).map(String))].map(oid);
    for (const projectLock of [...new Set([String(before.projectId), String(project._id)])]) await touchProject(oid(projectLock), session);
    for (const taskLock of lockTasks) await touchTask(taskLock, session);

    const keys = uniqueKeys([
      before.milestoneId ? { projectId: before.projectId, milestoneId: before.milestoneId } : null,
      nextMilestoneId ? { projectId: project._id, milestoneId: nextMilestoneId } : null,
    ]);
    const coverageBefore = await coverageOf(keys, session);
    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length) update.$unset = unset;
    const after = await ClientPayment.findOneAndUpdate({ _id: before._id, status: 'received' }, update, { returnDocument: 'after', session, runValidators: true }).lean();
    if (!after) throw conflict('Someone else just changed this payment. Reload and try again.');

    await audit({ ...auditBase(viewer, after, sayMoney(after.amount.amountMinor, after.amount.currency), meta), action: 'payment.update', changes }, session);
    await rollUpMilestones(viewer, keys, coverageBefore, after, 'changed', meta, session);
    return toPaymentDTO(after, await loadBriefs([after], session), warnings);
  });
}

/* --------------------------------------------------------------------- void */

/**
 * Voids a received entry with a reason: status void, who and when, never deleted. Needs money:void. It
 * leaves every total at once and, if it uncovers a milestone that was marked paid, puts the milestone back
 * to invoiced in the same transaction. A receipt that refunds depend on cannot be voided first.
 */
export async function voidPayment(viewer: SessionUser, id: string, input: { reason: string }, meta: ServiceMeta = {}): Promise<PaymentDTO> {
  assertCapability(viewer, 'money:void');
  const paymentId = parseObjectId(id);
  const parsed = voidPaymentSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const { reason } = parsed.data;

  return withTransaction(async (session) => {
    const before = await ClientPayment.findById(paymentId).session(session).lean();
    if (!before) throw notFound('We could not find that payment');
    if (before.status === 'void') throw conflict('That payment is already void');

    await touchProject(before.projectId, session);
    if (before.taskId) await touchTask(before.taskId, session);

    const net = await netReceived(before.projectId, session);
    if (net - signed(before.type, before.contractEquivalentMinor) < 0) {
      throw conflict('Voiding this receipt would leave the project with more refunded than received. Void the refund first.');
    }

    const keys = uniqueKeys([before.milestoneId ? { projectId: before.projectId, milestoneId: before.milestoneId } : null]);
    const coverageBefore = await coverageOf(keys, session);
    const after = await ClientPayment.findOneAndUpdate(
      { _id: before._id, status: 'received' },
      { $set: { status: 'void', voidReason: reason, voidedBy: snapshot(viewer), voidedAt: new Date() } },
      { returnDocument: 'after', session, runValidators: true },
    ).lean();
    if (!after) throw conflict('Someone else just changed this payment. Reload and try again.');

    await audit(
      {
        ...auditBase(viewer, after, sayMoney(after.amount.amountMinor, after.amount.currency), meta),
        action: 'payment.void',
        summary: reason,
        changes: [{ path: 'status', before: 'received', after: 'void' }],
      },
      session,
    );
    await rollUpMilestones(viewer, keys, coverageBefore, after, 'voided', meta, session);
    return toPaymentDTO(after, await loadBriefs([after], session));
  });
}
