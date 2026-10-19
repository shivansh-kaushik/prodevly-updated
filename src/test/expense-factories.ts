import type { Types } from 'mongoose';
import type { Capability } from '@/config/capabilities';
import { buildMoney } from '@/lib/money/fx';
import { Expense, FxRate, type AdminDoc, type ClientDoc, type ProjectDoc, type TaskDoc } from '@/models';
import { nextFiscalRef } from '@/services/refs';
import type { CreateExpenseInput } from '@/lib/validation/expense';
import type { SessionUser } from '@/types/session';
import { makeClient, makeProject, makeTask } from './domain-factories';
import { makeAdmin, makeSuperadmin, sessionFor } from './factories';

/**
 * Fixtures for the Expenses module. Like the other factories they write straight to the database, so a test can set up
 * exactly the state it needs (a rejected expense, one in another currency) without walking the service flow.
 */

/** The "now" the service tests pass in: a Monday in FY27, so every date below is in the past and in the same financial year. */
export const NOW = new Date('2026-10-12T10:00:00Z');
export const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** The same person holding exactly these capabilities (for the "a viewer without it is refused" tests). */
export function holding(viewer: SessionUser, ...caps: Capability[]): SessionUser {
  return { ...viewer, capabilities: new Set(caps) };
}

/** The same person with some capabilities taken away. */
export function without(viewer: SessionUser, ...caps: Capability[]): SessionUser {
  return { ...viewer, capabilities: new Set([...viewer.capabilities].filter((c) => !caps.includes(c))) };
}

export interface ExpenseWorld {
  client: ClientDoc;
  project: ProjectDoc;
  task: TaskDoc;
  /** A second client with its own project and task, for the "disagreeing ids" tests. */
  otherClient: ClientDoc;
  otherProject: ProjectDoc;
  otherTask: TaskDoc;
  /** A plain admin: may submit out-of-pocket expenses and see only their own. */
  plain: AdminDoc;
  plainSession: SessionUser;
  /** A second plain admin, so "someone else's" is a real person. */
  other: AdminDoc;
  otherSession: SessionUser;
  /** An admin granted expense:record (so also expense:view). Cannot approve or void. */
  recorder: AdminDoc;
  recorderSession: SessionUser;
  superadmin: AdminDoc;
  superSession: SessionUser;
}

/** Two clients with a project and task each, a plain admin, a second plain admin, a recorder and a superadmin, and a USD rate. */
export async function makeExpenseWorld(): Promise<ExpenseWorld> {
  const client = await makeClient();
  const project = await makeProject(client);
  const task = await makeTask(project);
  const otherClient = await makeClient();
  const otherProject = await makeProject(otherClient);
  const otherTask = await makeTask(otherProject);
  const plain = await makeAdmin();
  const other = await makeAdmin();
  const recorder = await makeAdmin({ grants: ['expense:record', 'expense:view'] });
  const superadmin = await makeSuperadmin();
  await FxRate.create({ currency: 'USD', rateOn: D('2026-10-01'), rate: 83.42, source: 'manual', enteredBy: { id: null, name: 'Test' } });
  return {
    client, project, task, otherClient, otherProject, otherTask,
    plain, plainSession: await sessionFor(plain),
    other, otherSession: await sessionFor(other),
    recorder, recorderSession: await sessionFor(recorder),
    superadmin, superSession: await sessionFor(superadmin),
  };
}

/** A valid company-paid expense body (needs expense:record). */
export function companyPaid(o: Partial<CreateExpenseInput> = {}): CreateExpenseInput {
  return {
    scope: 'company',
    category: 'software_subscriptions',
    description: 'Design tool seats',
    amountMinor: 250_000,
    currency: 'INR',
    spentOn: '2026-10-05',
    paidFrom: 'company',
    paidOn: '2026-10-06',
    mode: 'bank_transfer',
    ...o,
  };
}

/** A valid out-of-pocket submission (needs expense:submit). */
export function outOfPocket(o: Partial<CreateExpenseInput> = {}): CreateExpenseInput {
  return {
    scope: 'company',
    category: 'travel',
    description: 'Taxi to the client office',
    amountMinor: 45_000,
    currency: 'INR',
    spentOn: '2026-10-05',
    paidFrom: 'admin',
    ...o,
  };
}

export interface ExpenseRowOptions {
  status?: 'submitted' | 'approved' | 'paid' | 'rejected' | 'void';
  /** Out of pocket by this admin when given, otherwise paid by the company. */
  paidBy?: Pick<AdminDoc, '_id' | 'name'>;
  /** A project expense when given. */
  project?: Pick<ProjectDoc, '_id' | 'clientId'>;
  taskId?: Types.ObjectId;
  category?: string;
  amountMinor?: number;
  currency?: string;
  /** INR per unit for a foreign currency. */
  rate?: number;
  spentOn?: string;
  description?: string;
  receiptMediaIds?: Types.ObjectId[];
}

/** One expense written straight to the database, with a coherent Money subdocument. */
export async function insertExpense(o: ExpenseRowOptions = {}) {
  const status = o.status ?? 'paid';
  const spentOn = o.spentOn ?? '2026-10-05';
  const currency = o.currency ?? 'INR';
  const by = { id: o.paidBy?._id ?? null, name: o.paidBy?.name ?? 'Test' };
  const doc = await Expense.create({
    ref: await nextFiscalRef('expense', D(spentOn)),
    scope: o.project ? 'project' : 'company',
    clientId: o.project?.clientId,
    projectId: o.project?._id,
    taskId: o.taskId,
    category: o.category ?? 'software_subscriptions',
    description: o.description ?? 'Test expense',
    amount: buildMoney({
      amountMinor: o.amountMinor ?? 100_000,
      currency,
      fxRate: currency === 'INR' ? undefined : (o.rate ?? 83.42),
      fxDate: D(spentOn),
      fxSource: 'table',
    }),
    spentOn: D(spentOn),
    paidFrom: o.paidBy ? 'admin' : 'company',
    paidByAdmin: o.paidBy ? { id: o.paidBy._id, name: o.paidBy.name } : undefined,
    status,
    approvedBy: status === 'approved' || status === 'paid' ? by : undefined,
    approvedAt: status === 'approved' || status === 'paid' ? D(spentOn) : undefined,
    paidOn: status === 'paid' ? D(spentOn) : undefined,
    mode: status === 'paid' ? 'bank_transfer' : undefined,
    rejectReason: status === 'rejected' ? 'Not a business cost' : undefined,
    voidReason: status === 'void' ? 'Entered in error' : undefined,
    receiptMediaIds: o.receiptMediaIds ?? [],
    recordedBy: by,
  });
  return doc.toObject();
}
