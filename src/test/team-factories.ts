import { Types } from 'mongoose';
import type { EMPLOYMENT_TYPES, PAY_BASES, TASK_STATUSES } from '@/config/statuses';
import { toInrMinor } from '@/lib/money/fx';
import { parseDateOnly } from '@/lib/dates/date-only';
import { Admin, PayProfile, TeamPayout, TeamRole, WorkLog, type AdminDoc, type ProjectDoc, type TaskDoc, type TeamRoleDoc } from '@/models';
import { makeAdmin, type AdminOverrides } from './factories';
import { makeTask } from './domain-factories';

/**
 * Fixtures for the Team module. Direct-to-database: they bypass the services on purpose, so a test
 * can set up exactly the state it needs. Dates are "YYYY-MM-DD" strings, stored as UTC midnight.
 */
const SYSTEM = { id: null, name: 'Test' };
let n = 0;
const next = () => ++n;

export const day = (value: string): Date => {
  const d = parseDateOnly(value);
  if (!d) throw new Error(`Not a calendar date: ${value}`);
  return d;
};

export async function makeTeamRole(o: { name?: string; order?: number; archived?: boolean; description?: string } = {}): Promise<TeamRoleDoc> {
  const i = next();
  const doc = await TeamRole.create({
    name: o.name ?? `Role ${i}`,
    order: o.order ?? i,
    description: o.description,
    archivedAt: o.archived ? new Date() : undefined,
    createdBy: SYSTEM,
  });
  return doc.toObject();
}

export interface MemberOverrides extends AdminOverrides {
  jobRole?: Pick<TeamRoleDoc, '_id'>;
  designation?: string;
  phone?: string;
  employmentType?: (typeof EMPLOYMENT_TYPES)[number];
  skills?: string[];
  weeklyCapacityHours?: number;
  joinedOn?: string;
}

/** An admin with a team profile. */
export async function makeMember(o: MemberOverrides = {}): Promise<AdminDoc> {
  const admin = await makeAdmin(o);
  const set: Record<string, unknown> = {};
  if (o.jobRole) set['profile.jobRoleId'] = o.jobRole._id;
  if (o.designation) set['profile.designation'] = o.designation;
  if (o.phone) set['profile.phone'] = o.phone;
  if (o.employmentType) set['profile.employmentType'] = o.employmentType;
  if (o.skills) set['profile.skills'] = o.skills;
  if (o.weeklyCapacityHours) set['profile.weeklyCapacityHours'] = o.weeklyCapacityHours;
  if (o.joinedOn) set['profile.joinedOn'] = day(o.joinedOn);
  if (Object.keys(set).length === 0) return admin;
  await Admin.updateOne({ _id: admin._id }, { $set: set });
  const fresh = await Admin.findById(admin._id).lean();
  if (!fresh) throw new Error('member vanished');
  return fresh;
}

type Assignee = Pick<AdminDoc, '_id' | 'name'>;

/** A task assigned to the given admins. */
export function makeAssignedTask(
  project: Pick<ProjectDoc, '_id' | 'ref' | 'clientId'>,
  assignees: Assignee[],
  o: Partial<TaskDoc> & { status?: (typeof TASK_STATUSES)[number]; due?: string } = {},
) {
  const { due, ...rest } = o;
  return makeTask(project, {
    assignees: assignees.map((a) => ({ kind: 'admin' as const, id: a._id, name: a.name })),
    ...(due ? { dueOn: day(due) } : {}),
    ...rest,
  });
}

export async function makeWorkLog(
  admin: Assignee,
  task: Pick<TaskDoc, '_id' | 'projectId' | 'clientId'>,
  o: { workedOn: string; minutes: number; billable?: boolean },
) {
  const doc = await WorkLog.create({
    adminId: admin._id,
    adminName: admin.name,
    taskId: task._id,
    projectId: task.projectId,
    clientId: task.clientId,
    workedOn: day(o.workedOn),
    minutes: o.minutes,
    note: 'Test log',
    billable: o.billable ?? false,
  });
  return doc.toObject();
}

export async function makePayProfile(
  admin: Pick<AdminDoc, '_id'>,
  o: { basis?: (typeof PAY_BASES)[number]; rateMinor?: number; currency?: string; effectiveFrom?: string; payoutNote?: string } = {},
) {
  const doc = await PayProfile.create({
    adminId: admin._id,
    basis: o.basis ?? 'monthly',
    rateMinor: o.rateMinor ?? 5_000_000,
    currency: o.currency ?? 'INR',
    effectiveFrom: day(o.effectiveFrom ?? '2026-04-01'),
    payoutNote: o.payoutNote,
    createdBy: SYSTEM,
  });
  return doc.toObject();
}

export async function makeTeamPayout(
  admin: Pick<AdminDoc, '_id' | 'name'>,
  o: {
    status?: 'due' | 'paid' | 'void';
    amountMinor?: number;
    currency?: string;
    /** INR per 1 unit, for a payout in another currency. */
    fxRate?: number;
    paidOn?: string;
    dueOn?: string;
  } = {},
) {
  const i = next();
  const status = o.status ?? 'paid';
  const currency = o.currency ?? 'INR';
  const amountMinor = o.amountMinor ?? 1_000_000;
  const fxDate = day(o.paidOn ?? o.dueOn ?? '2026-04-01');
  const money =
    currency === 'INR'
      ? { amountMinor, currency, fxRate: 1, fxDate, fxSource: 'identity' as const, inrMinor: amountMinor }
      : { amountMinor, currency, fxRate: o.fxRate ?? 80, fxDate, fxSource: 'manual' as const, inrMinor: toInrMinor(amountMinor, currency, o.fxRate ?? 80) };
  const doc = await TeamPayout.create({
    ref: `TMP-FY27-${String(i).padStart(4, '0')}`,
    adminId: admin._id,
    adminName: admin.name,
    basis: 'salary',
    periodFrom: day('2026-04-01'),
    periodTo: day('2026-04-30'),
    amount: money,
    status,
    dueOn: o.dueOn ? day(o.dueOn) : undefined,
    paidOn: status === 'paid' ? day(o.paidOn ?? '2026-05-05') : undefined,
    voidReason: status === 'void' ? 'Entered by mistake' : undefined,
    recordedBy: { id: null, name: 'Test' },
  });
  return doc.toObject();
}

export const newObjectId = () => new Types.ObjectId();
