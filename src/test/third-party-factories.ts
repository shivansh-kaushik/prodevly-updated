import { Types } from 'mongoose';
import type { Capability } from '@/config/capabilities';
import { addDays, formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { buildMoney } from '@/lib/money/fx';
import { FxRate, Media, ThirdParty, ThirdPartyPayout, WorkOrder, type ProjectDoc, type TaskDoc, type ThirdPartyDoc, type ThirdPartyPayoutDoc, type WorkOrderDoc } from '@/models';
import { nextFiscalRef, nextRef } from '@/services/refs';
import type { SessionUser } from '@/types/session';
import { makeClient, makeProject, makeTask } from './domain-factories';
import { makeAdmin, makeSuperadmin, sessionFor } from './factories';

/**
 * Fixtures for third parties, work orders and third-party payouts. They write straight to the database, so a
 * test can set up exactly the state it needs; the services under test are called by the tests themselves.
 */
const SYSTEM = { id: null, name: 'Test' };

/** Today in the organisation's zone, shifted by `days`, as a "YYYY-MM-DD" string. The services use the real clock, so tests do too. */
export const dayStr = (days = 0) => formatDateOnly(addDays(todayDateOnly(new Date(), 'Asia/Kolkata'), days));
export const dayDate = (days = 0) => addDays(todayDateOnly(new Date(), 'Asia/Kolkata'), days);
export const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export async function setRate(currency: string, rate: number, on = dayStr(0)) {
  return FxRate.create({ currency, rate, rateOn: D(on), source: 'manual', enteredBy: SYSTEM });
}

/** The same person holding exactly these capabilities (a superadmin's session would hold everything). */
export function viewerHolding(viewer: SessionUser, ...caps: Capability[]): SessionUser {
  return { ...viewer, capabilities: new Set(caps) };
}

export interface World {
  client: Awaited<ReturnType<typeof makeClient>>;
  project: ProjectDoc;
  task: TaskDoc;
  /** Holds every capability. */
  sa: SessionUser;
  /** A plain admin plus the two grants that record payouts and edit third parties: no approve, no void, no pay details. */
  recorder: SessionUser;
  /** A plain admin with no grants: reads the directory only. */
  plain: SessionUser;
  party: ThirdPartyDoc;
}

export async function makeWorld(): Promise<World> {
  const client = await makeClient();
  const project = await makeProject(client);
  const task = await makeTask(project);
  const sa = await sessionFor(await makeSuperadmin());
  const recorder = await sessionFor(await makeAdmin({ grants: ['payout:record', 'thirdParty:edit'] }));
  const plain = await sessionFor(await makeAdmin());
  const party = await makeParty();
  return { client, project, task, sa, recorder, plain, party };
}

let n = 0;

export async function makeParty(o: { name?: string; type?: string; status?: 'active' | 'inactive'; paymentNote?: string; archivedAt?: Date } = {}): Promise<ThirdPartyDoc> {
  const i = ++n;
  const doc = await ThirdParty.create({
    ref: await nextRef('thirdParty'),
    name: o.name ?? `Studio ${i}`,
    type: o.type ?? 'freelancer',
    status: o.status ?? 'active',
    paymentNote: o.paymentNote,
    archivedAt: o.archivedAt,
    createdBy: SYSTEM,
  });
  return doc.toObject();
}

export interface WorkOrderOptions {
  agreedMinor?: number;
  currency?: string;
  status?: 'open' | 'delivered' | 'closed' | 'cancelled';
  dueOn?: Date;
  task?: Pick<TaskDoc, '_id'>;
  title?: string;
  paidMinor?: number;
  dueMinor?: number;
}

export async function makeOrder(
  party: Pick<ThirdPartyDoc, '_id' | 'name'>,
  project: Pick<ProjectDoc, '_id' | 'clientId'>,
  o: WorkOrderOptions = {},
): Promise<WorkOrderDoc> {
  const doc = await WorkOrder.create({
    ref: await nextRef('workOrder'),
    thirdPartyId: party._id,
    thirdPartyName: party.name,
    clientId: project.clientId,
    projectId: project._id,
    taskId: o.task?._id,
    title: o.title ?? 'Build the checkout',
    agreed: { amountMinor: o.agreedMinor ?? 1_000_000, currency: o.currency ?? 'INR' },
    dueOn: o.dueOn,
    status: o.status ?? 'open',
    statusHistory: [{ from: null, to: o.status ?? 'open', at: new Date(), by: SYSTEM }],
    paidMinor: o.paidMinor ?? 0,
    dueMinor: o.dueMinor ?? 0,
    createdBy: SYSTEM,
  });
  return doc.toObject();
}

export interface PayoutOptions {
  amountMinor?: number;
  currency?: string;
  /** INR per unit for a foreign currency. */
  rate?: number;
  status?: 'due' | 'paid' | 'void';
  dueOn?: Date;
  paidOn?: Date;
  order?: Pick<WorkOrderDoc, '_id'>;
  task?: Pick<TaskDoc, '_id'>;
}

/** A payout written directly (no work-order sums are touched: set those on the order yourself). */
export async function makePayout(
  party: Pick<ThirdPartyDoc, '_id' | 'name'>,
  project: Pick<ProjectDoc, '_id' | 'clientId'>,
  o: PayoutOptions = {},
): Promise<ThirdPartyPayoutDoc> {
  const status = o.status ?? 'due';
  const currency = o.currency ?? 'INR';
  const dueOn = o.dueOn ?? dayDate(0);
  const paidOn = status === 'paid' ? (o.paidOn ?? dayDate(0)) : undefined;
  const money = buildMoney({ amountMinor: o.amountMinor ?? 100_000, currency, fxRate: currency === 'INR' ? undefined : (o.rate ?? 83.42), fxDate: paidOn ?? dueOn, fxSource: 'table' });
  const doc = await ThirdPartyPayout.create({
    ref: await nextFiscalRef('thirdPartyPayout', dueOn),
    thirdPartyId: party._id,
    thirdPartyName: party.name,
    workOrderId: o.order?._id,
    clientId: project.clientId,
    projectId: project._id,
    taskId: o.task?._id,
    amount: money,
    status,
    dueOn,
    paidOn,
    mode: status === 'paid' ? 'bank_transfer' : undefined,
    transactionRef: status === 'paid' ? 'UTR1' : undefined,
    paidBy: status === 'paid' ? SYSTEM : undefined,
    voidReason: status === 'void' ? 'Entered in error' : undefined,
    recordedBy: SYSTEM,
  });
  return doc.toObject();
}

/** A private file uploaded for a purpose, as the media service would have stored it (no bytes: nothing here reads them). */
export async function makeMedia(
  uploader: Pick<SessionUser, 'id' | 'name'>,
  o: { purpose?: 'payment' | 'payout' | 'expense'; visibility?: 'public' | 'private'; filename?: string } = {},
) {
  const visibility = o.visibility ?? 'private';
  const doc = await Media.create({
    storage: 'gridfs',
    fileId: new Types.ObjectId(),
    filename: o.filename ?? 'transfer-receipt.pdf',
    mime: 'application/pdf',
    size: 1234,
    sha256: `sha-${++n}-${Math.random().toString(36).slice(2)}`,
    visibility,
    ...(visibility === 'private' ? { purpose: o.purpose ?? 'payout' } : {}),
    uploadedBy: { id: new Types.ObjectId(uploader.id), name: uploader.name },
  });
  return doc.toObject();
}

export const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; status?: number; fields?: Record<string, string>; message: string };
  }
  throw new Error('expected the call to be rejected');
};
