import { describe, expect, it } from 'vitest';
import type { Capability } from '@/config/capabilities';
import { PROJECT_STATUSES } from '@/config/statuses';
import { getClientsDashboard } from '@/services/dashboards/clients';
import { getEnquiriesDashboard } from '@/services/dashboards/enquiries';
import { getExpensesDashboard, type ExpensesDashboard } from '@/services/dashboards/expenses';
import { getOverviewDashboard, overviewAccess, OVERVIEW_ACTIVITY_LIMIT, type OverviewDashboard } from '@/services/dashboards/overview';
import { getPaymentsDashboard } from '@/services/dashboards/payments';
import { getProjectsDashboard } from '@/services/dashboards/projects';
import { getTasksDashboard } from '@/services/dashboards/tasks';
import { getThirdPartiesDashboard } from '@/services/dashboards/third-parties';
import { actorOf, makeAuditEntries, makeAuditEntry } from '@/test/audit-factories';
import { setupTestDb } from '@/test/db';
import { makeClient, makeProject } from '@/test/domain-factories';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import {
  addUncountedMoney,
  FY27,
  FY27_FIGURES,
  holding,
  makeOverviewWorld,
  makeViewers,
  NOW,
  periodFor,
  rejects,
  without,
} from '@/test/overview-factories';
import { makeExpense, makePayment, makeThirdPartyPayout } from '@/test/project-factories';
import type { SessionUser } from '@/types/session';

setupTestDb();

const overview = (viewer: SessionUser, period = FY27) => getOverviewDashboard(viewer, period, { now: NOW });

/** Every capability the Overview looks at, as a set a test can take one from. */
const MONEY_VIEWS = ['payment:view', 'payout:view', 'expense:view', 'team:payView'] as const;
const BASE = ['dashboard:view', 'project:view', 'task:view', 'lead:view'] as const;

describe('overviewAccess', () => {
  const access = (...caps: Capability[]) => overviewAccess({ capabilities: new Set(caps) });

  it('gives a viewer with no capability nothing, and reads no ledger for them', () => {
    expect(access()).toEqual({
      received: false, thirdParties: false, expenses: false, team: false, net: false, outstanding: false, payables: false,
      topProjects: false, projects: false, tasks: false, enquiries: false, ledger: false, clients: false,
    });
  });

  it('ties each tile to its own capability', () => {
    expect(access('payment:view')).toMatchObject({ received: true, outstanding: true, thirdParties: false, expenses: false, team: false, ledger: true });
    expect(access('payout:view')).toMatchObject({ thirdParties: true, received: false, payables: false });
    expect(access('expense:view')).toMatchObject({ expenses: true, payables: false });
    expect(access('team:payView')).toMatchObject({ team: true, net: false });
    expect(access('project:view')).toMatchObject({ projects: true, topProjects: false });
    expect(access('task:view')).toMatchObject({ tasks: true });
    expect(access('lead:view')).toMatchObject({ enquiries: true });
  });

  it('needs payout and expense for payables, payment and project for the margin list, and all four for net', () => {
    expect(access('payout:view', 'expense:view').payables).toBe(true);
    expect(access('payment:view', 'project:view').topProjects).toBe(true);
    expect(access('payment:view', 'payout:view', 'expense:view').net).toBe(false);
    expect(access(...MONEY_VIEWS).net).toBe(true);
    for (const missing of MONEY_VIEWS) expect(access(...MONEY_VIEWS.filter((c) => c !== missing)).net).toBe(false);
  });
});

describe('who may open it', () => {
  it('needs dashboard:view', async () => {
    const v = await makeViewers();
    const e = await rejects(overview(without(v.sa, 'dashboard:view')));
    expect(e).toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('the company figures come from the four ledgers', () => {
  it('totals settled money for the period, in INR, from the records', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    const d = await overview(v.sa);
    expect(d.money.received).toEqual({ inrMinor: FY27_FIGURES.received });
    expect(d.money.thirdParties).toEqual({ inrMinor: FY27_FIGURES.thirdParties, payouts: 3 });
    expect(d.money.expenses).toEqual({ inrMinor: FY27_FIGURES.expenses, count: 5 });
    expect(d.money.team).toEqual({ inrMinor: FY27_FIGURES.team });
    expect(d.money.net).toEqual({ inrMinor: FY27_FIGURES.net });
  });

  it('closes the double rule: net is received less all three costs, to the paisa', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    const { money: m } = await overview(v.sa);
    expect(m.net?.inrMinor).toBe((m.received?.inrMinor ?? NaN) - (m.thirdParties?.inrMinor ?? NaN) - (m.expenses?.inrMinor ?? NaN) - (m.team?.inrMinor ?? NaN));
  });

  it('prices a foreign entry at its own captured rate, not at today\'s table rate', async () => {
    const v = await makeViewers();
    const w = await makeOverviewWorld();
    // USD 1,000.00 at 83.42 is INR 83,420.00. The table now says 84, which would give 84,000.00.
    const { money } = await overview(v.sa);
    expect(money.received?.inrMinor).toBe(1_000_000 + 8_342_000 - 200_000 + 1_668_400);
    expect(w.pB.contract.currency).toBe('USD');
  });

  it('never counts void, rejected, submitted or due entries, or receipts on our own projects', async () => {
    const v = await makeViewers();
    const w = await makeOverviewWorld();
    const before = await overview(v.sa);
    await addUncountedMoney(w);
    const after = await overview(v.sa);
    expect(after.money).toEqual(before.money);
    expect(after.cashFlow).toEqual(before.cashFlow);
    expect(after.topProjects).toEqual(before.topProjects);
  });

  it('counts the costs of internal projects but never their receipts', async () => {
    const v = await makeViewers();
    const { internal } = await (async () => {
      const client = await makeClient({ name: 'ProDevly (internal)', isInternal: true });
      const project = await makeProject(client, { name: 'Our product' });
      await makePayment(project, { amountMinor: 900_000, receivedOn: '2026-06-01' });
      await makeThirdPartyPayout(project, { amountMinor: 200_000, status: 'paid', paidOn: '2026-06-02' });
      await makeExpense({ project, amountMinor: 50_000, status: 'paid', spentOn: '2026-06-03' });
      return { internal: client };
    })();
    expect(internal.isInternal).toBe(true);
    const d = await overview(v.sa);
    expect(d.money.received).toEqual({ inrMinor: 0 });
    expect(d.money.thirdParties?.inrMinor).toBe(200_000);
    expect(d.money.expenses?.inrMinor).toBe(50_000);
    expect(d.money.net).toEqual({ inrMinor: -250_000 });
    expect(d.topProjects).toEqual([]);
  });

  it('leaves out money outside the period, and shows it in the period it belongs to', async () => {
    const v = await makeViewers();
    const w = await makeOverviewWorld();
    await makePayment(w.pA1, { amountMinor: 123_456, receivedOn: '2026-03-31' });
    await makePayment(w.pA1, { amountMinor: 654_321, receivedOn: '2027-04-01' });
    expect((await overview(v.sa)).money.received?.inrMinor).toBe(FY27_FIGURES.received);
    const fy26 = await overview(v.sa, periodFor({ period: 'last_fy' }));
    expect(fy26.period).toMatchObject({ fyLabel: 'FY26', from: '2025-04-01', to: '2026-03-31' });
    expect(fy26.money.received?.inrMinor).toBe(123_456);
  });
});

describe('cash in and out by month', () => {
  it('has one zero-filled month for each month of the period, with every figure in its own month', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    const flow = (await overview(v.sa)).cashFlow;
    expect(flow?.months).toHaveLength(12);
    expect(flow?.months.map((m) => m.month)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']);
    const at = (month: string) => flow?.months.find((m) => m.month === month);
    expect(at('2026-04')).toMatchObject({ cashInInr: 0, thirdPartyInr: 0, expenseInr: 0, teamInr: 0, netInr: 0 });
    expect(at('2026-06')).toMatchObject({ cashInInr: 1_000_000, thirdPartyInr: 300_000, expenseInr: 220_000, teamInr: 1_000_000, netInr: -520_000 });
    // The refund nets out of July's cash in.
    expect(at('2026-07')).toMatchObject({ cashInInr: 8_142_000, thirdPartyInr: 0, expenseInr: 0, teamInr: 0, netInr: 8_142_000 });
    expect(at('2026-08')).toMatchObject({ cashInInr: 1_668_400, thirdPartyInr: 834_200, netInr: 834_200 });
    expect(at('2026-09')).toMatchObject({ cashInInr: 0, thirdPartyInr: 50_000, expenseInr: 70_000, netInr: -120_000 });
  });

  it('adds up to the tiles, series by series', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    const d = await overview(v.sa);
    const sum = (pick: (m: NonNullable<OverviewDashboard['cashFlow']>['months'][number]) => number | null) =>
      (d.cashFlow?.months ?? []).reduce((s, m) => s + (pick(m) ?? 0), 0);
    expect(sum((m) => m.cashInInr)).toBe(d.money.received?.inrMinor);
    expect(sum((m) => m.thirdPartyInr)).toBe(d.money.thirdParties?.inrMinor);
    expect(sum((m) => m.expenseInr)).toBe(d.money.expenses?.inrMinor);
    expect(sum((m) => m.teamInr)).toBe(d.money.team?.inrMinor);
    expect(sum((m) => m.netInr)).toBe(d.money.net?.inrMinor);
  });

  it('follows a custom range down to a single month', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    const june = await overview(v.sa, periodFor({ period: 'custom', from: '2026-06-01', to: '2026-06-30' }));
    expect(june.cashFlow?.months).toHaveLength(1);
    expect(june.money).toMatchObject({
      received: { inrMinor: 1_000_000 },
      thirdParties: { inrMinor: 300_000 },
      expenses: { inrMinor: 220_000 },
      team: { inrMinor: 1_000_000 },
      net: { inrMinor: -520_000 },
    });
  });
});

describe('it agrees with each section\'s own page', () => {
  it('shows the figures the section dashboards show for the same period', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    const d = await overview(v.sa);
    const range = { from: FY27.from, to: FY27.to };

    const payments = await getPaymentsDashboard(v.sa, FY27, { now: NOW });
    expect(d.money.received?.inrMinor).toBe(payments.receivedInr);
    expect(d.money.outstanding?.inrMinor).toBe(payments.outstanding.totalInr);
    expect(d.money.outstanding?.overdueMilestones).toBe(payments.overdue.count);

    // The Clients page totals the same balances at the same rates.
    const clients = await getClientsDashboard(v.sa, FY27, NOW);
    expect(d.money.outstanding?.inrMinor).toBe(clients.money?.outstandingInrMinor);
    expect(d.money.received?.inrMinor).toBe(clients.money?.receivedInrMinor);

    const parties = await getThirdPartiesDashboard(v.sa, range, { now: NOW });
    expect(d.money.thirdParties).toEqual({ inrMinor: parties.money?.paid.inr, payouts: parties.money?.paid.count });
    expect(d.money.payables?.duePayouts.inrMinor).toBe(parties.money?.due.inr);

    const spend = (await getExpensesDashboard(v.sa, range)) as ExpensesDashboard;
    expect(d.money.expenses).toEqual({ inrMinor: spend.spent.inrMinor, count: spend.spent.count });
    expect(d.money.payables?.reimbursements.inrMinor).toBe(spend.owedToAdmins.inrMinor);

    const projects = await getProjectsDashboard(v.sa, range, { now: NOW });
    expect(d.projects).toMatchObject({ total: projects.total, active: projects.active, overdue: projects.overdue });
    expect(d.projects?.byStatus).toEqual(projects.byStatus);
    // The margin list shows the Projects page's own margins, best first.
    const margins = new Map(projects.money?.rows.map((r) => [r.projectId, r.marginInr]));
    expect(d.topProjects?.length).toBeGreaterThan(0);
    for (const p of d.topProjects ?? []) expect(margins.get(p.projectId)).toBe(p.marginInr);

    const tasks = await getTasksDashboard(v.sa, FY27, {}, NOW);
    expect(d.tasks).toEqual({ open: tasks.openTotal, overdue: tasks.overdue, blocked: tasks.blocked, inProgress: tasks.openByStatus.in_progress });

    const enquiries = await getEnquiriesDashboard(v.sa, FY27, { now: NOW });
    expect(d.enquiries).toEqual({ newInPeriod: enquiries.newInPeriod, waitingForFirstReply: enquiries.waitingForFirstReply });
  });
});

describe('what we are owed and what we owe', () => {
  it('shows outstanding at the latest rates, with overdue milestones, and payables from open items', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    const { money } = await overview(v.sa);
    expect(money.outstanding).toEqual({ inrMinor: FY27_FIGURES.outstanding, missingRates: [], overdueMilestones: 1 });
    expect(money.payables).toEqual({
      inrMinor: FY27_FIGURES.payables.duePayouts + FY27_FIGURES.payables.reimbursements,
      duePayouts: { inrMinor: 900_000, count: 1, overdueCount: 1 },
      reimbursements: { inrMinor: 70_000, count: 1 },
    });
  });

  it('does not let the period change an open balance', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    const lastYear = (await overview(v.sa, periodFor({ period: 'last_fy' }))).money;
    expect(lastYear.outstanding?.inrMinor).toBe(FY27_FIGURES.outstanding);
    expect(lastYear.payables?.inrMinor).toBe(970_000);
  });

  it('lists currencies with no rate instead of guessing, and says so when nothing can be totalled', async () => {
    const v = await makeViewers();
    const client = await makeClient();
    await makeProject(client, { contract: { pricingModel: 'fixed', amountMinor: 100_000, currency: 'EUR' } });
    expect((await overview(v.sa)).money.outstanding).toEqual({ inrMinor: null, missingRates: ['EUR'], overdueMilestones: 0 });

    await makeProject(client, { contract: { pricingModel: 'fixed', amountMinor: 50_000, currency: 'INR' } });
    expect((await overview(v.sa)).money.outstanding).toEqual({ inrMinor: 50_000, missingRates: ['EUR'], overdueMilestones: 0 });
  });

  it('counts due team payouts nowhere in payables (they need team pay access, which payables does not)', async () => {
    const v = await makeViewers();
    const w = await makeOverviewWorld();
    await addUncountedMoney(w);
    expect((await overview(v.sa)).money.payables?.inrMinor).toBe(970_000);
  });
});

describe('the best margins of the period', () => {
  it('ranks external projects by margin, with received and margin percent only when something was received', async () => {
    const v = await makeViewers();
    const w = await makeOverviewWorld();
    const top = (await overview(v.sa)).topProjects;
    expect(top).toEqual([
      { projectId: String(w.pA1._id), ref: w.pA1.ref, name: 'A one', clientName: 'Client A', receivedInr: 9_142_000, marginInr: 8_292_000, marginPct: 90.7 },
      { projectId: String(w.pB._id), ref: w.pB.ref, name: 'B one', clientName: 'Client B', receivedInr: 1_668_400, marginInr: 834_200, marginPct: 50 },
      // Team cost only: a loss, and no percentage over nothing received.
      { projectId: String(w.pA2._id), ref: w.pA2.ref, name: 'A two', clientName: 'Client A', receivedInr: 0, marginInr: -300_000, marginPct: null },
    ]);
    // Our own project has costs in the period, yet is not ranked.
    expect(top?.some((p) => p.projectId === String(w.pI._id))).toBe(false);
  });

  it('shows the five best of many, largest first', async () => {
    const v = await makeViewers();
    const client = await makeClient();
    for (let i = 1; i <= 7; i += 1) {
      const project = await makeProject(client, { name: `Project ${i}` });
      await makePayment(project, { amountMinor: i * 100_000, receivedOn: '2026-06-01' });
    }
    const top = (await overview(v.sa)).topProjects ?? [];
    expect(top.map((p) => p.name)).toEqual(['Project 7', 'Project 6', 'Project 5', 'Project 4', 'Project 3']);
    expect(top.map((p) => p.marginInr)).toEqual([700_000, 600_000, 500_000, 400_000, 300_000]);
  });
});

describe('projects, tasks and enquiries', () => {
  it('counts them from their own dashboards', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    const d = await overview(v.plain);
    expect(d.projects).toEqual({
      total: 5,
      active: 4,
      overdue: 1, // B one: deadline 30 Sep, still active
      byStatus: PROJECT_STATUSES.map((status) => ({ status, count: status === 'active' ? 4 : status === 'delivered' ? 1 : 0 })),
    });
    expect(d.tasks).toEqual({ open: 3, overdue: 1, blocked: 1, inProgress: 1 });
    // Four received in the year (spam left out); three are still marked new, one of them from before the year.
    expect(d.enquiries).toEqual({ newInPeriod: 4, waitingForFirstReply: 3 });
  });

  it('counts new enquiries by the period but the waiting ones as they stand now', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    const lastYear = (await overview(v.plain, periodFor({ period: 'last_fy' }))).enquiries;
    expect(lastYear).toEqual({ newInPeriod: 1, waitingForFirstReply: 3 });
  });
});

describe('who sees which tile', () => {
  const json = (d: OverviewDashboard) => JSON.stringify(d);

  it('shows a superadmin everything, including company net', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    const d = await overview(v.sa);
    expect(Object.values(d.money).every((m) => m !== null)).toBe(true);
    expect(d.cashFlow?.series).toEqual({ cashIn: true, thirdParties: true, expenses: true, team: true });
    expect(d.cashFlow?.months.every((m) => m.netInr !== null)).toBe(true);
    expect(d.topProjects).not.toBeNull();
    expect(d.projects && d.tasks && d.enquiries).toBeTruthy();
    expect(d.activity.scope).toBe('all');
  });

  it('shows a plain admin only projects, tasks, enquiries and their own activity, with no trace of any money', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    const d = await overview(v.plain);
    expect(d.money).toEqual({ net: null, received: null, thirdParties: null, expenses: null, team: null, outstanding: null, payables: null });
    expect(d.cashFlow).toBeNull();
    expect(d.topProjects).toBeNull();
    expect(d.projects).not.toBeNull();
    expect(d.tasks).not.toBeNull();
    expect(d.enquiries).not.toBeNull();
    expect(d.activity.scope).toBe('own');
    for (const figure of [FY27_FIGURES.received, FY27_FIGURES.net, FY27_FIGURES.thirdParties, 8_292_000, 970_000]) {
      expect(json(d)).not.toContain(String(figure));
    }
  });

  it('shows payment:view only the tiles that need it: received, outstanding and the margin list', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    const d = await overview(v.cash);
    expect(d.money.received).toEqual({ inrMinor: FY27_FIGURES.received });
    expect(d.money.outstanding?.inrMinor).toBe(FY27_FIGURES.outstanding);
    expect(d.money).toMatchObject({ net: null, thirdParties: null, expenses: null, team: null, payables: null });
    expect(d.topProjects).toHaveLength(3);
    expect(d.cashFlow?.series).toEqual({ cashIn: true, thirdParties: false, expenses: false, team: false });
    // A series the viewer may not see carries no figure at all, in any month.
    for (const m of d.cashFlow?.months ?? []) expect(m).toMatchObject({ thirdPartyInr: null, expenseInr: null, teamInr: null, netInr: null });
    expect(d.cashFlow?.months.reduce((s, m) => s + (m.cashInInr ?? 0), 0)).toBe(FY27_FIGURES.received);
  });

  it('shows payout:view only paid third parties, and no payables without expense:view as well', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    const d = await overview(v.payout);
    expect(d.money.thirdParties).toEqual({ inrMinor: FY27_FIGURES.thirdParties, payouts: 3 });
    expect(d.money).toMatchObject({ received: null, expenses: null, team: null, net: null, outstanding: null, payables: null });
    expect(d.topProjects).toBeNull();
    expect(d.cashFlow?.series).toEqual({ cashIn: false, thirdParties: true, expenses: false, team: false });
  });

  it('shows expense:view only expenses, and no payables without payout:view as well', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    const d = await overview(v.expense);
    expect(d.money.expenses).toEqual({ inrMinor: FY27_FIGURES.expenses, count: 5 });
    expect(d.money).toMatchObject({ received: null, thirdParties: null, team: null, net: null, payables: null });
    expect(d.cashFlow?.series).toEqual({ cashIn: false, thirdParties: false, expenses: true, team: false });
  });

  it('shows payables to a viewer of both payouts and expenses, and still no net', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    const d = await overview(holding(v.sa, ...BASE, 'payout:view', 'expense:view'));
    expect(d.money.payables?.inrMinor).toBe(970_000);
    expect(d.money.thirdParties).not.toBeNull();
    expect(d.money.expenses).not.toBeNull();
    expect(d.money).toMatchObject({ received: null, team: null, net: null, outstanding: null });
  });

  it('shows team payouts to team:payView alone, and no net', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    const d = await overview(holding(v.sa, 'dashboard:view', 'team:payView'));
    expect(d.money.team).toEqual({ inrMinor: FY27_FIGURES.team });
    expect(d.money).toMatchObject({ received: null, thirdParties: null, expenses: null, net: null, payables: null, outstanding: null });
    expect(d.projects).toBeNull();
    expect(d.tasks).toBeNull();
    expect(d.enquiries).toBeNull();
  });

  it('omits company net unless the viewer holds all four money views, whichever one is missing', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    expect((await overview(v.allGrantable)).money.net).toBeNull(); // team pay can never be granted
    for (const missing of MONEY_VIEWS) {
      const d = await overview(holding(v.sa, ...BASE, ...MONEY_VIEWS.filter((c) => c !== missing)));
      expect(d.money.net).toBeNull();
      expect(d.cashFlow?.months.every((m) => m.netInr === null)).toBe(true);
    }
    expect((await overview(holding(v.sa, ...BASE, ...MONEY_VIEWS))).money.net).toEqual({ inrMinor: FY27_FIGURES.net });
  });

  it('leaves out the margin list without project:view, and each work tile without its own capability', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    const noProjects = await overview(without(v.cash, 'project:view'));
    expect(noProjects.projects).toBeNull();
    expect(noProjects.topProjects).toBeNull();
    expect(noProjects.money.received).not.toBeNull();
    expect((await overview(without(v.plain, 'task:view'))).tasks).toBeNull();
    expect((await overview(without(v.plain, 'lead:view'))).enquiries).toBeNull();
  });

  it('does not need the section pages\' own capabilities for a figure the Overview allows', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    // payout:view without thirdParty:view, expense:view without expense:submit, payment:view without client:view.
    const d = await overview(holding(v.sa, 'dashboard:view', 'payout:view', 'expense:view', 'payment:view'));
    expect(d.money.thirdParties?.inrMinor).toBe(FY27_FIGURES.thirdParties);
    expect(d.money.expenses?.inrMinor).toBe(FY27_FIGURES.expenses);
    expect(d.money.outstanding?.inrMinor).toBe(FY27_FIGURES.outstanding);
  });
});

describe('the activity list is scoped to the viewer', () => {
  it('gives a plain admin only their own entries, whoever else wrote some', async () => {
    const alice = await makeAdmin({ name: 'Alice Rao' });
    const bob = await makeAdmin({ name: 'Bob Das' });
    await makeAuditEntries([
      { at: '2026-10-10T08:00:00Z', actor: actorOf(alice), action: 'client.create', entity: { type: 'client', label: 'Alice client' } },
      { at: '2026-10-11T08:00:00Z', actor: actorOf(bob), action: 'client.create', entity: { type: 'client', label: 'Bob client' } },
      { at: '2026-10-12T08:00:00Z', actor: actorOf(alice), action: 'project.update', entity: { type: 'project', label: 'Alice project' } },
    ]);
    const d = await overview(await sessionFor(alice));
    expect(d.activity.scope).toBe('own');
    expect(d.activity.entries.map((e) => e.entity.label)).toEqual(['Alice project', 'Alice client']);
    expect(d.activity.entries.every((e) => e.actorName === 'Alice Rao')).toBe(true);
  });

  it('gives a superadmin everyone\'s, newest first, and stops at fifteen', async () => {
    const sa = await makeSuperadmin({ name: 'Sara Super' });
    const alice = await makeAdmin({ name: 'Alice Rao' });
    const bob = await makeAdmin({ name: 'Bob Das' });
    const entries = Array.from({ length: 20 }, (_, i) => ({
      at: new Date(Date.UTC(2026, 9, 1, i)).toISOString(),
      actor: actorOf(i % 2 ? alice : bob),
      action: 'client.update',
      entity: { type: 'client', label: `Entry ${i}` },
    }));
    await makeAuditEntries(entries);
    const d = await overview(await sessionFor(sa));
    expect(d.activity.scope).toBe('all');
    expect(d.activity.entries).toHaveLength(OVERVIEW_ACTIVITY_LIMIT);
    expect(d.activity.entries[0]?.entity.label).toBe('Entry 19');
    expect(d.activity.entries.at(-1)?.entity.label).toBe('Entry 5');
    expect(new Set(d.activity.entries.map((e) => e.actorName))).toEqual(new Set(['Alice Rao', 'Bob Das']));
  });

  it('narrows a viewer without audit:viewAll to their own entries, whatever their role', async () => {
    const sa = await makeSuperadmin({ name: 'Sara Super' });
    const bob = await makeAdmin({ name: 'Bob Das' });
    await makeAuditEntries([
      { actor: actorOf(sa), action: 'client.create', entity: { type: 'client', label: 'Mine' } },
      { actor: actorOf(bob), action: 'client.create', entity: { type: 'client', label: 'Bob client' } },
    ]);
    const d = await overview(without(await sessionFor(sa), 'audit:viewAll'));
    expect(d.activity.scope).toBe('own');
    expect(d.activity.entries.map((e) => e.entity.label)).toEqual(['Mine']);
  });

  it('hands the feed only what it shows: no actor id, request id, context or IP hash', async () => {
    const sa = await makeSuperadmin();
    await makeAuditEntry({
      actor: actorOf(sa),
      action: 'client.create',
      entity: { type: 'client', label: 'Acme' },
      ipHash: 'a'.repeat(64),
      requestId: 'req-123',
      context: { clientId: '5f3a9c0b1d2e4f6a8b7c9d0e' },
    });
    const entry = (await overview(await sessionFor(sa))).activity.entries[0];
    expect(Object.keys(entry ?? {}).sort()).toEqual(['action', 'actorName', 'actorRole', 'at', 'changes', 'entity', 'id', 'summary']);
    expect(JSON.stringify(entry)).not.toContain('a'.repeat(64));
  });
});

describe('an empty database', () => {
  it('shows zeros where the viewer may see a figure, empty lists, and the next step', async () => {
    const v = await makeViewers();
    const d = await overview(v.sa);
    expect(d.money).toEqual({
      net: { inrMinor: 0 },
      received: { inrMinor: 0 },
      thirdParties: { inrMinor: 0, payouts: 0 },
      expenses: { inrMinor: 0, count: 0 },
      team: { inrMinor: 0 },
      outstanding: { inrMinor: 0, missingRates: [], overdueMilestones: 0 },
      payables: { inrMinor: 0, duePayouts: { inrMinor: 0, count: 0, overdueCount: 0 }, reimbursements: { inrMinor: 0, count: 0 } },
    });
    expect(d.cashFlow?.months).toHaveLength(12);
    expect(d.cashFlow?.months.every((m) => m.cashInInr === 0 && m.thirdPartyInr === 0 && m.expenseInr === 0 && m.teamInr === 0 && m.netInr === 0)).toBe(true);
    expect(d.topProjects).toEqual([]);
    expect(d.projects).toEqual({ total: 0, active: 0, overdue: 0, byStatus: PROJECT_STATUSES.map((status) => ({ status, count: 0 })) });
    expect(d.tasks).toEqual({ open: 0, overdue: 0, blocked: 0, inProgress: 0 });
    expect(d.enquiries).toEqual({ newInPeriod: 0, waitingForFirstReply: 0 });
    expect(d.activity).toEqual({ scope: 'all', entries: [] });
    expect(d.setup).toEqual({ hasClients: false, hasProjects: false });
  });

  it('still leaves out what a plain admin may not see', async () => {
    const v = await makeViewers();
    const d = await overview(v.plain);
    expect(d.money).toEqual({ net: null, received: null, thirdParties: null, expenses: null, team: null, outstanding: null, payables: null });
    expect(d.cashFlow).toBeNull();
    expect(d.tasks).toEqual({ open: 0, overdue: 0, blocked: 0, inProgress: 0 });
    expect(d.setup).toEqual({ hasClients: false, hasProjects: false });
  });

  it('does not reveal whether clients or projects exist to a viewer who may not look', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    const d = await overview(holding(v.sa, 'dashboard:view', 'payment:view'));
    expect(d.setup).toEqual({ hasClients: null, hasProjects: null });
  });

  it('knows a database with clients but no projects, and one with both', async () => {
    const v = await makeViewers();
    const client = await makeClient();
    expect((await overview(v.sa)).setup).toEqual({ hasClients: true, hasProjects: false });
    await makeProject(client);
    expect((await overview(v.sa)).setup).toEqual({ hasClients: true, hasProjects: true });
  });
});

describe('the period it reports', () => {
  it('names the financial year it defaults to, as plain dates', async () => {
    const v = await makeViewers();
    expect((await overview(v.plain)).period).toEqual({ key: 'this_fy', label: 'This financial year', fyLabel: 'FY27', from: '2026-04-01', to: '2027-03-31' });
  });
});
