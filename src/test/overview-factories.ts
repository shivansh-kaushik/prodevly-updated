import type { Capability } from '@/config/capabilities';
import { resolvePeriod, type PeriodInput } from '@/lib/dates/ranges';
import type { SessionUser } from '@/types/session';
import { makeClient, makeProject, makeTask } from './domain-factories';
import { insertExpense } from './expense-factories';
import { makeAdmin, makeSuperadmin, sessionFor } from './factories';
import { makeLead } from './lead-factories';
import { D, makeExpense, makeFxRate, makeInternalClient, makePayment, makeTeamPayout, makeThirdPartyPayout } from './project-factories';

/**
 * Fixtures for the Overview dashboard: one small company whose four ledgers, projects, tasks and enquiries
 * add up to figures a test can write down by hand. Everything is inserted directly, so a test can set up
 * settled, void, rejected, foreign-currency and internal entries that the services would refuse or reprice.
 */

/** 12 October 2026 in India, mid FY27 (1 Apr 2026 to 31 Mar 2027). */
export const NOW = new Date('2026-10-12T10:00:00Z');
export const periodFor = (input: PeriodInput = {}, now = NOW) => resolvePeriod(input, now);
export const FY27 = periodFor();

export const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; status?: number; message?: string };
  }
  throw new Error('expected the call to be rejected');
};

/** The same person holding exactly these capabilities (a real session, only doctored). */
export const holding = (viewer: SessionUser, ...caps: Capability[]): SessionUser => ({ ...viewer, capabilities: new Set(caps) });
export const without = (viewer: SessionUser, ...caps: Capability[]): SessionUser => ({ ...viewer, capabilities: new Set([...viewer.capabilities].filter((c) => !caps.includes(c))) });

export interface OverviewViewers {
  /** Every capability. */
  sa: SessionUser;
  /** The admin defaults: projects, tasks and enquiries, no money. */
  plain: SessionUser;
  /** An admin granted payment:view only. */
  cash: SessionUser;
  /** An admin granted payout:view only. */
  payout: SessionUser;
  /** An admin granted expense:view only. */
  expense: SessionUser;
  /** An admin granted every money view a superadmin can hand out: payment, payout and expense (team pay is never grantable). */
  allGrantable: SessionUser;
}

export async function makeViewers(): Promise<OverviewViewers> {
  return {
    sa: await sessionFor(await makeSuperadmin({ name: 'Sara Super' })),
    plain: await sessionFor(await makeAdmin({ name: 'Pat Plain' })),
    cash: await sessionFor(await makeAdmin({ name: 'Cal Cash', grants: ['payment:view'] })),
    payout: await sessionFor(await makeAdmin({ name: 'Pia Payout', grants: ['payout:view'] })),
    expense: await sessionFor(await makeAdmin({ name: 'Ed Expense', grants: ['expense:view'] })),
    allGrantable: await sessionFor(await makeAdmin({ name: 'Gia Grants', grants: ['payment:view', 'payout:view', 'expense:view'] })),
  };
}

/**
 * What the world below adds up to for FY27, in paise, worked out by hand from the entries (and checked
 * against them in the tests). The comments name the entries; every other entry is noise that must not count.
 */
export const FY27_FIGURES = {
  // 10,00,000 + USD 1,000 at 83.42 (83,42,000) - refund 2,00,000 + USD 200 at 83.42 (16,68,400)
  received: 10_810_400,
  // 3,00,000 + USD 100 at 83.42 (8,34,200) + 50,000 on the internal project (costs of internal work count)
  thirdParties: 1_184_200,
  // 1,00,000 approved + 50,000 paid + 40,000 company + 30,000 internal project + 70,000 out of pocket, approved
  expenses: 290_000,
  team: 1_000_000,
  net: 8_336_200,
  /** Due third-party payouts and approved out-of-pocket expenses not yet reimbursed. */
  payables: { duePayouts: 900_000, reimbursements: 70_000 },
  /** A one: contract 2,00,000.00 less 91,420.00 received toward it. B one: USD 4,800.00 still to come, at the latest rate of 84. */
  outstanding: 10_858_000 + 40_320_000,
} as const;

export async function makeOverviewWorld() {
  await makeFxRate('USD', 84, '2026-10-01');
  const a = await makeClient({ name: 'Client A' });
  const b = await makeClient({ name: 'Client B' });
  const internal = await makeInternalClient();

  const pA1 = await makeProject(a, {
    name: 'A one',
    contract: { pricingModel: 'fixed', amountMinor: 20_000_000, currency: 'INR' },
    milestones: [{ title: 'Kickoff', amountMinor: 1_000_000, status: 'invoiced', dueOn: D('2026-09-01') }] as never,
  });
  const pA2 = await makeProject(a, { name: 'A two' });
  const pB = await makeProject(b, {
    name: 'B one',
    contract: { pricingModel: 'fixed', amountMinor: 500_000, currency: 'USD' },
    deadlineOn: D('2026-09-30'),
  });
  const pI = await makeProject(internal, { name: 'Our own product' });
  const pDone = await makeProject(a, { name: 'A delivered', status: 'delivered' });

  const reimbursed = await makeAdmin({ name: 'Rita Rao' });

  // Client payments. The contract-equivalent is what counts toward what is still owed.
  await makePayment(pA1, { amountMinor: 1_000_000, receivedOn: '2026-06-10' });
  await makePayment(pA1, { amountMinor: 100_000, currency: 'USD', rate: 83.42, receivedOn: '2026-07-05', contractEquivalentMinor: 8_342_000 });
  await makePayment(pA1, { type: 'refund', amountMinor: 200_000, receivedOn: '2026-07-20' });
  await makePayment(pB, { amountMinor: 20_000, currency: 'USD', rate: 83.42, receivedOn: '2026-08-02', contractEquivalentMinor: 20_000 });

  // Third-party payouts: two paid (one in USD), one due, one on our own project.
  await makeThirdPartyPayout(pA1, { amountMinor: 300_000, status: 'paid', paidOn: '2026-06-15' });
  await makeThirdPartyPayout(pA1, { amountMinor: 900_000, status: 'due', dueOn: '2026-06-20' });
  await makeThirdPartyPayout(pB, { amountMinor: 10_000, currency: 'USD', rate: 83.42, status: 'paid', paidOn: '2026-08-10' });
  await makeThirdPartyPayout(pI, { amountMinor: 50_000, status: 'paid', paidOn: '2026-09-01' });

  // Expenses: approved and paid count; one is out of pocket and still owed to a person.
  await makeExpense({ project: pA1, amountMinor: 100_000, status: 'approved', spentOn: '2026-06-12' });
  await makeExpense({ project: pA1, amountMinor: 50_000, status: 'paid', spentOn: '2026-06-13' });
  await makeExpense({ amountMinor: 40_000, status: 'paid', spentOn: '2026-06-20' });
  await makeExpense({ project: pI, amountMinor: 30_000, status: 'paid', spentOn: '2026-06-21' });
  await insertExpense({ status: 'approved', paidBy: reimbursed, amountMinor: 70_000, spentOn: '2026-09-10', category: 'travel' });

  // One paid team payout split over two projects.
  await makeTeamPayout({
    amountMinor: 1_000_000,
    status: 'paid',
    paidOn: '2026-06-30',
    allocations: [
      { project: pA1, amountMinor: 400_000 },
      { project: pA2, amountMinor: 300_000 },
    ],
  });

  // Tasks on A one: three open (one overdue, one blocked), one done, one cancelled.
  await makeTask(pA1, { status: 'todo' });
  await makeTask(pA1, { status: 'in_progress', dueOn: D('2026-10-01') });
  await makeTask(pA1, { status: 'blocked' });
  await makeTask(pA1, { status: 'done' });
  await makeTask(pA1, { status: 'cancelled' });

  // Enquiries: four received in FY27 (spam not counted), three of them still waiting for a first reply,
  // plus one that arrived before the year and is still waiting.
  await makeLead({ status: 'new', createdAt: new Date('2026-10-10T08:00:00Z') });
  await makeLead({ status: 'new', createdAt: new Date('2026-05-02T08:00:00Z') });
  await makeLead({ status: 'contacted', createdAt: new Date('2026-06-01T08:00:00Z') });
  await makeLead({ status: 'contacted', createdAt: new Date('2026-08-01T08:00:00Z') });
  await makeLead({ status: 'spam', createdAt: new Date('2026-07-01T08:00:00Z') });
  await makeLead({ status: 'new', createdAt: new Date('2026-03-15T08:00:00Z') });

  return { a, b, internal, pA1, pA2, pB, pI, pDone, reimbursed };
}

export type OverviewWorld = Awaited<ReturnType<typeof makeOverviewWorld>>;

/**
 * Entries that look like money but must never count: void and rejected entries, anything not yet settled,
 * and receipts on our own projects. Adding them must not move any figure on the Overview.
 */
export async function addUncountedMoney(w: OverviewWorld) {
  await makePayment(w.pA1, { status: 'void', amountMinor: 5_000_000, receivedOn: '2026-06-11' });
  await makePayment(w.pI, { amountMinor: 700_000, receivedOn: '2026-06-12' });
  await makeThirdPartyPayout(w.pA1, { amountMinor: 400_000, status: 'void' });
  await makeExpense({ project: w.pA1, amountMinor: 77_000, status: 'submitted', spentOn: '2026-06-14' });
  await makeExpense({ project: w.pA1, amountMinor: 88_000, status: 'rejected', spentOn: '2026-06-14' });
  await makeExpense({ project: w.pA1, amountMinor: 99_000, status: 'void', spentOn: '2026-06-14' });
  await makeTeamPayout({ amountMinor: 500_000, status: 'due', allocations: [{ project: w.pA1, amountMinor: 500_000 }] });
  await makeTeamPayout({ amountMinor: 250_000, status: 'void', allocations: [{ project: w.pA1, amountMinor: 250_000 }] });
}
