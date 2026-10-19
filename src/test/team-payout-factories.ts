import type { Types } from 'mongoose';
import type { Capability } from '@/config/capabilities';
import { mongoose } from '@/lib/db/mongoose';
import type { CreateTeamPayoutInput } from '@/lib/validation/team-payout';
import { WorkLog, type AdminDoc, type ProjectDoc, type TaskDoc, type WorkLogDoc } from '@/models';
import { createTeamPayout } from '@/services/team-payout.service';
import type { SessionUser } from '@/types/session';
import { setupTestDb } from './db';
import { makeClient, makeProject, makeTask } from './domain-factories';
import { makeAdmin, makeSuperadmin, sessionFor } from './factories';
import { makeFxRate } from './project-factories';
import { day, makeMember, makePayProfile, makeWorkLog } from './team-factories';

/**
 * Fixtures for the team payout tests. Direct-to-database where the point is the state (people, projects, time logs), and
 * through the real service where the point is a payout (so a payout in a test is built the way production builds one).
 */
export { setupTestDb };

/** 12 Oct 2026 in India, mid FY27. Every test that cares about "today" passes this to the service. */
export const NOW = new Date('2026-10-12T10:00:00Z');

export const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; status?: number; fields?: Record<string, string> };
  }
  throw new Error('expected the call to be rejected');
};

/** The same person with exactly these capabilities (a real session, only doctored), for the capability matrix. */
export const holding = (viewer: SessionUser, ...caps: Capability[]): SessionUser => ({ ...viewer, capabilities: new Set(caps) });
export const without = (viewer: SessionUser, ...caps: Capability[]): SessionUser => ({ ...viewer, capabilities: new Set([...viewer.capabilities].filter((c) => !caps.includes(c))) });

export interface PayoutWorld {
  client: Awaited<ReturnType<typeof makeClient>>;
  /** Two more projects of the same client, so a split has somewhere to go. */
  projects: ProjectDoc[];
  tasks: TaskDoc[];
  /** The person who is paid. A plain admin with a team profile. */
  person: AdminDoc;
  personSession: SessionUser;
  superadmin: AdminDoc;
  sa: SessionUser;
}

/** A client with three projects (one task each), a person to pay and a superadmin to pay them. */
export async function makePayoutWorld(o: { pay?: Parameters<typeof makePayProfile>[1] | null } = {}): Promise<PayoutWorld> {
  const client = await makeClient();
  const projects = [await makeProject(client), await makeProject(client), await makeProject(client)];
  const tasks = await Promise.all(projects.map((p) => makeTask(p)));
  const person = await makeMember({ name: 'Asha Rao' });
  if (o.pay !== null) await makePayProfile(person, o.pay ?? { basis: 'monthly', rateMinor: 5_000_000 });
  const superadmin = await makeSuperadmin();
  return { client, projects, tasks, person, personSession: await sessionFor(person), superadmin, sa: await sessionFor(superadmin) };
}

/** Time the person logged, on a project's task, on a day. */
export function logTime(w: PayoutWorld, projectIndex: number, workedOn: string, minutes: number): Promise<WorkLogDoc> {
  return makeWorkLog(w.person, w.tasks[projectIndex] as TaskDoc, { workedOn, minutes });
}

/** An INR salary payout for April 2026, due on the 5th, as the form would send it. */
export function payoutBody(w: Pick<PayoutWorld, 'person'>, over: Partial<CreateTeamPayoutInput> = {}): CreateTeamPayoutInput {
  return {
    adminId: String(w.person._id),
    basis: 'salary',
    periodFrom: '2026-04-01',
    periodTo: '2026-04-30',
    amountMinor: 5_000_000,
    currency: 'INR',
    dueOn: '2026-05-05',
    allocations: [],
    ...over,
  };
}

/** Records a due payout through the service and returns its DTO. */
export async function recordPayout(w: PayoutWorld, over: Partial<CreateTeamPayoutInput> = {}, viewer: SessionUser = w.sa) {
  const { payout } = await createTeamPayout(viewer, payoutBody(w, over), {}, NOW);
  return payout;
}

/** A USD rate for a day (rates are INR per 1 unit). */
export const usdRate = (rate: number, on: string) => makeFxRate('USD', rate, on);

/** The ids of a person's logs that are locked, sorted. */
export async function lockedLogIds(adminId: Types.ObjectId | string): Promise<string[]> {
  const rows = await WorkLog.find({ adminId, lockedByPayoutId: mongoose.trusted({ $exists: true }) }).select('_id').lean();
  return rows.map((r) => String(r._id)).sort();
}

export { day, makeAdmin, makeMember, makePayProfile, sessionFor };
