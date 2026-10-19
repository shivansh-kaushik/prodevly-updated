import type { Types } from 'mongoose';
import type { Capability } from '@/config/capabilities';
import { addDays, todayDateOnly } from '@/lib/dates/date-only';
import { Expense, Task, TeamPayout, WorkLog, type AdminDoc, type ProjectDoc, type TaskDoc, type WorkLogDoc } from '@/models';
import type { SessionUser } from '@/types/session';
import { makeClient, makeProject, makeTask } from './domain-factories';
import { makeAdmin, makeSuperadmin, sessionFor } from './factories';

/**
 * Fixtures for the tasks, work logs and My work tests. Like the other factories they write straight
 * to the database, so a test can set up exactly the state it needs without going through a service.
 */
export const TEST_ZONE = 'Asia/Kolkata';
/** A calendar date relative to today in the organisation's zone, as a date-only Date. */
export const dayOffset = (days: number) => addDays(todayDateOnly(new Date(), TEST_ZONE), days);
export const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** The same person with fewer capabilities, for the "a viewer without it gets FORBIDDEN" tests. */
export function without(viewer: SessionUser, ...caps: Capability[]): SessionUser {
  return { ...viewer, capabilities: new Set([...viewer.capabilities].filter((c) => !caps.includes(c))) };
}

/** The same person holding exactly these capabilities. */
export function holding(viewer: SessionUser, ...caps: Capability[]): SessionUser {
  return { ...viewer, capabilities: new Set(caps) };
}

export interface Workspace {
  client: Awaited<ReturnType<typeof makeClient>>;
  project: ProjectDoc;
  task: TaskDoc;
  admin: AdminDoc;
  adminSession: SessionUser;
  superadmin: AdminDoc;
  superSession: SessionUser;
}

/** A client with one project and one task, a plain admin and a superadmin (both signed in). */
export async function makeWorkspace(o: { project?: Partial<ProjectDoc>; task?: Partial<TaskDoc> } = {}): Promise<Workspace> {
  const client = await makeClient();
  const project = await makeProject(client, o.project);
  const task = await makeTask(project, o.task);
  const admin = await makeAdmin();
  const superadmin = await makeSuperadmin();
  return { client, project, task, admin, adminSession: await sessionFor(admin), superadmin, superSession: await sessionFor(superadmin) };
}

export interface WorkLogOverrides {
  minutes?: number;
  workedOn?: Date;
  billable?: boolean;
  note?: string;
  createdAt?: Date;
  lockedByPayoutId?: Types.ObjectId;
  /** Keep the task's cached total in step (default). */
  syncCache?: boolean;
}

export async function makeWorkLog(admin: Pick<AdminDoc, '_id' | 'name'>, task: Pick<TaskDoc, '_id' | 'projectId' | 'clientId'>, o: WorkLogOverrides = {}): Promise<WorkLogDoc> {
  const minutes = o.minutes ?? 60;
  const doc = await WorkLog.create({
    adminId: admin._id,
    adminName: admin.name,
    taskId: task._id,
    projectId: task.projectId,
    clientId: task.clientId,
    workedOn: o.workedOn ?? dayOffset(0),
    minutes,
    note: o.note ?? 'Worked on it',
    billable: o.billable ?? false,
    lockedByPayoutId: o.lockedByPayoutId,
    ...(o.createdAt ? { createdAt: o.createdAt } : {}),
  });
  if (o.syncCache !== false) await Task.updateOne({ _id: task._id }, { $inc: { loggedMinutes: minutes } }, { timestamps: false });
  return doc.toObject();
}

/** Moves a log's creation time back, to test the edit window. */
export async function backdateLog(id: Types.ObjectId, daysAgo: number): Promise<void> {
  await WorkLog.collection.updateOne({ _id: id }, { $set: { createdAt: new Date(Date.now() - daysAgo * 86_400_000) } });
}

export interface PayoutOverrides {
  status?: 'due' | 'paid' | 'void';
  periodFrom?: Date;
  periodTo?: Date;
  paidOn?: Date;
  inrMinor?: number;
  /** A foreign payout: the amount in `currency` minor units and the rate used. */
  foreign?: { currency: string; amountMinor: number; fxRate: number };
}

/** A team payout in INR (or one foreign currency), with the INR figure computed the way the money code does. */
export async function makeTeamPayout(admin: Pick<AdminDoc, '_id' | 'name'>, o: PayoutOverrides = {}) {
  const status = o.status ?? 'paid';
  const fxDate = o.paidOn ?? dayOffset(0);
  let amount;
  if (o.foreign) {
    const { currency, amountMinor, fxRate } = o.foreign;
    amount = { amountMinor, currency, fxRate, fxDate, fxSource: 'table' as const, inrMinor: Math.round(amountMinor * fxRate) };
  } else {
    const inr = o.inrMinor ?? 1_000_000;
    amount = { amountMinor: inr, currency: 'INR', fxRate: 1, fxDate, fxSource: 'identity' as const, inrMinor: inr };
  }
  const doc = await TeamPayout.create({
    ref: `TMP-FY27-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    adminId: admin._id,
    adminName: admin.name,
    basis: 'hours',
    periodFrom: o.periodFrom ?? dayOffset(-30),
    periodTo: o.periodTo ?? dayOffset(-1),
    amount,
    status,
    ...(status === 'paid' ? { paidOn: o.paidOn ?? dayOffset(0) } : {}),
    ...(status === 'void' ? { voidReason: 'Entered twice' } : {}),
    recordedBy: { id: null, name: 'Test' },
  });
  return doc.toObject();
}

export async function makeOutOfPocketExpense(admin: Pick<AdminDoc, '_id' | 'name'>, o: { status?: 'submitted' | 'approved' | 'paid' | 'rejected'; inrMinor?: number } = {}) {
  const inr = o.inrMinor ?? 250_000;
  const status = o.status ?? 'approved';
  const doc = await Expense.create({
    ref: `EXP-FY27-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    scope: 'company',
    category: 'travel',
    description: 'Taxi to the client office',
    amount: { amountMinor: inr, currency: 'INR', fxRate: 1, fxDate: dayOffset(0), fxSource: 'identity', inrMinor: inr },
    spentOn: dayOffset(-2),
    paidFrom: 'admin',
    paidByAdmin: { id: admin._id, name: admin.name },
    status,
    ...(status === 'paid' ? { paidOn: dayOffset(0) } : {}),
    ...(status === 'rejected' ? { rejectReason: 'Not an allowed expense' } : {}),
    recordedBy: { id: admin._id, name: admin.name },
  });
  return doc.toObject();
}
