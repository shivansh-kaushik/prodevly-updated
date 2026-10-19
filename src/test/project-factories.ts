import type { Types } from 'mongoose';
import type { Capability } from '@/config/capabilities';
import { buildMoney } from '@/lib/money/fx';
import {
  ClientPayment,
  Expense,
  FxRate,
  TeamPayout,
  ThirdPartyPayout,
  WorkLog,
  WorkOrder,
  type ClientDoc,
  type ProjectDoc,
} from '@/models';
import { nextFiscalRef, nextRef } from '@/services/refs';
import type { SessionUser } from '@/types/session';
import { makeClient, makeThirdParty } from './domain-factories';
import { makeAdmin } from './factories';

/**
 * Fixtures for the Projects module and the ledger. Direct-to-database on purpose: a ledger or
 * dashboard test needs exact settled and unsettled entries, and the services that would record
 * them belong to other modules.
 */
const SYSTEM = { id: null, name: 'Test' };

/** "2026-06-01" as a date-only value (UTC midnight). */
export const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

interface MoneyOptions {
  amountMinor: number;
  /** Defaults to INR. */
  currency?: string;
  /** INR per unit for a foreign currency. Defaults to 83.42. */
  rate?: number;
  date?: string;
}

/** The Money subdocument, built the way the services build it (INR computed, never typed). */
export function money(o: MoneyOptions) {
  const currency = o.currency ?? 'INR';
  return buildMoney({
    amountMinor: o.amountMinor,
    currency,
    fxRate: currency === 'INR' ? undefined : (o.rate ?? 83.42),
    fxDate: D(o.date ?? '2026-06-01'),
    fxSource: 'table',
  });
}

type ProjectRef = Pick<ProjectDoc, '_id' | 'clientId'>;

export interface PaymentFixture extends Omit<MoneyOptions, 'date'> {
  type?: 'receipt' | 'refund';
  status?: 'received' | 'void';
  receivedOn?: string;
  taskId?: Types.ObjectId;
  milestoneId?: Types.ObjectId;
  /** In the project's contract currency. Defaults to the amount itself. */
  contractEquivalentMinor?: number;
}

export async function makePayment(project: ProjectRef, o: PaymentFixture) {
  const receivedOn = o.receivedOn ?? '2026-06-01';
  const status = o.status ?? 'received';
  const doc = await ClientPayment.create({
    ref: await nextFiscalRef('payment', D(receivedOn)),
    type: o.type ?? 'receipt',
    clientId: project.clientId,
    projectId: project._id,
    taskId: o.taskId,
    milestoneId: o.milestoneId,
    amount: money({ ...o, date: receivedOn }),
    contractEquivalentMinor: o.contractEquivalentMinor ?? o.amountMinor,
    receivedOn: D(receivedOn),
    mode: 'bank_transfer',
    status,
    voidReason: status === 'void' ? 'Entered in error' : undefined,
    recordedBy: SYSTEM,
  });
  return doc.toObject();
}

export interface PayoutFixture extends Omit<MoneyOptions, 'date'> {
  status?: 'due' | 'paid' | 'void';
  paidOn?: string;
  dueOn?: string;
  taskId?: Types.ObjectId;
}

export async function makeThirdPartyPayout(project: ProjectRef, o: PayoutFixture) {
  const status = o.status ?? 'paid';
  const paidOn = status === 'paid' ? (o.paidOn ?? '2026-06-01') : undefined;
  const vendor = await makeThirdParty();
  const doc = await ThirdPartyPayout.create({
    ref: await nextFiscalRef('thirdPartyPayout', D(paidOn ?? o.dueOn ?? '2026-06-01')),
    thirdPartyId: vendor._id,
    thirdPartyName: vendor.name,
    clientId: project.clientId,
    projectId: project._id,
    taskId: o.taskId,
    amount: money({ ...o, date: paidOn ?? o.dueOn }),
    status,
    dueOn: o.dueOn ? D(o.dueOn) : undefined,
    paidOn: paidOn ? D(paidOn) : undefined,
    voidReason: status === 'void' ? 'Entered in error' : undefined,
    recordedBy: SYSTEM,
  });
  return doc.toObject();
}

export interface ExpenseFixture extends Omit<MoneyOptions, 'date'> {
  /** A project expense when given, otherwise company overhead. */
  project?: ProjectRef;
  status?: 'submitted' | 'approved' | 'paid' | 'rejected' | 'void';
  spentOn?: string;
  taskId?: Types.ObjectId;
}

export async function makeExpense(o: ExpenseFixture) {
  const status = o.status ?? 'paid';
  const spentOn = o.spentOn ?? '2026-06-01';
  const doc = await Expense.create({
    ref: await nextFiscalRef('expense', D(spentOn)),
    scope: o.project ? 'project' : 'company',
    clientId: o.project?.clientId,
    projectId: o.project?._id,
    taskId: o.taskId,
    category: 'software_subscriptions',
    description: 'Test expense',
    amount: money({ ...o, date: spentOn }),
    spentOn: D(spentOn),
    paidFrom: 'company',
    status,
    paidOn: status === 'paid' ? D(spentOn) : undefined,
    rejectReason: status === 'rejected' ? 'Not a business cost' : undefined,
    voidReason: status === 'void' ? 'Entered in error' : undefined,
    recordedBy: SYSTEM,
  });
  return doc.toObject();
}

export interface TeamPayoutFixture extends Omit<MoneyOptions, 'date'> {
  status?: 'due' | 'paid' | 'void';
  paidOn?: string;
  /** The project's share of this payout, in the payout's own currency AND as INR. Sums must not exceed the payout. */
  allocations?: Array<{ project: ProjectRef; amountMinor: number; inrMinor?: number }>;
}

export async function makeTeamPayout(o: TeamPayoutFixture) {
  const status = o.status ?? 'paid';
  const paidOn = status === 'paid' ? (o.paidOn ?? '2026-06-30') : undefined;
  const admin = await makeAdmin();
  const amount = money({ ...o, date: paidOn });
  const rate = o.currency && o.currency !== 'INR' ? amount.inrMinor / amount.amountMinor : 1;
  const doc = await TeamPayout.create({
    ref: await nextFiscalRef('teamPayout', D(paidOn ?? '2026-06-30')),
    adminId: admin._id,
    adminName: admin.name,
    basis: 'salary',
    periodFrom: D('2026-06-01'),
    periodTo: D('2026-06-30'),
    amount,
    status,
    dueOn: status === 'due' ? D('2026-07-05') : undefined,
    paidOn: paidOn ? D(paidOn) : undefined,
    allocations: (o.allocations ?? []).map((a) => ({
      clientId: a.project.clientId,
      projectId: a.project._id,
      amountMinor: a.amountMinor,
      inrMinor: a.inrMinor ?? Math.round(a.amountMinor * rate),
    })),
    voidReason: status === 'void' ? 'Entered in error' : undefined,
    recordedBy: SYSTEM,
  });
  return doc.toObject();
}

export interface WorkOrderFixture {
  agreedMinor: number;
  currency?: string;
  paidMinor?: number;
  dueMinor?: number;
  status?: 'open' | 'delivered' | 'closed' | 'cancelled';
}

export async function makeWorkOrder(project: ProjectRef, o: WorkOrderFixture) {
  const vendor = await makeThirdParty();
  const doc = await WorkOrder.create({
    ref: await nextRef('workOrder'),
    thirdPartyId: vendor._id,
    thirdPartyName: vendor.name,
    clientId: project.clientId,
    projectId: project._id,
    title: 'Test work order',
    agreed: { amountMinor: o.agreedMinor, currency: o.currency ?? 'INR' },
    status: o.status ?? 'open',
    paidMinor: o.paidMinor ?? 0,
    dueMinor: o.dueMinor ?? 0,
    createdBy: SYSTEM,
  });
  return doc.toObject();
}

export async function makeWorkLog(
  project: ProjectRef,
  task: { _id: Types.ObjectId },
  admin: { _id: Types.ObjectId; name: string },
  o: { minutes?: number; billable?: boolean; workedOn?: string } = {},
) {
  const doc = await WorkLog.create({
    adminId: admin._id,
    adminName: admin.name,
    taskId: task._id,
    projectId: project._id,
    clientId: project.clientId,
    workedOn: D(o.workedOn ?? '2026-06-01'),
    minutes: o.minutes ?? 60,
    note: 'Worked on it',
    billable: o.billable ?? true,
  });
  return doc.toObject();
}

export async function makeFxRate(currency: string, rate: number, rateOn = '2026-10-01') {
  return FxRate.create({ currency, rate, rateOn: D(rateOn), source: 'manual', enteredBy: SYSTEM });
}

export const makeInternalClient = (): Promise<ClientDoc> => makeClient({ name: 'ProDevly (internal)', isInternal: true });

/** The same viewer with capabilities added or taken away, to test a capability matrix without a grant dance. */
export function viewerWith(viewer: SessionUser, change: { add?: Capability[]; remove?: Capability[] }): SessionUser {
  const capabilities = new Set<Capability>(viewer.capabilities);
  for (const c of change.add ?? []) capabilities.add(c);
  for (const c of change.remove ?? []) capabilities.delete(c);
  return { ...viewer, capabilities };
}
