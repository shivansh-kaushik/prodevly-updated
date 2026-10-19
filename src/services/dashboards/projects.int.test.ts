import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { Admin, Project } from '@/models';
import { audit } from '@/services/audit.service';
import {
  getProjectActivity,
  getProjectMoney,
  getProjectsDashboard,
  getProjectTasks,
  getProjectTeam,
} from '@/services/dashboards/projects';
import { setupTestDb } from '@/test/db';
import { makeClient, makeProject, makeTask } from '@/test/domain-factories';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import {
  D,
  makeExpense,
  makeFxRate,
  makeInternalClient,
  makePayment,
  makeTeamPayout,
  makeThirdPartyPayout,
  makeWorkLog,
  makeWorkOrder,
  viewerWith,
} from '@/test/project-factories';

setupTestDb();

const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string };
  }
  throw new Error('expected the call to be rejected');
};

const FY27 = { from: D('2026-04-01'), to: D('2027-03-31') };
const NOW = new Date('2026-10-12T10:00:00Z'); // 12 October 2026 in India as well
const superadmin = async () => sessionFor(await makeSuperadmin());
const plainAdmin = async () => sessionFor(await makeAdmin());

/** A portfolio with every status, health and date case the dashboard has to get right. */
async function portfolio() {
  const a = await makeClient({ name: 'Client A' });
  const b = await makeClient({ name: 'Client B' });
  const internal = await makeInternalClient();
  const p = {
    a1: await makeProject(a, { name: 'A active', status: 'active', health: 'on_track', type: 'website', startOn: D('2026-04-10'), deadlineOn: D('2026-11-01'), costBudgetInrMinor: 700_000 }),
    a2: await makeProject(a, { name: 'A overdue', status: 'active', health: 'at_risk', type: 'web_app', startOn: D('2026-05-05'), deadlineOn: D('2026-10-01') }),
    b3: await makeProject(b, { name: 'B on hold', status: 'on_hold', health: 'off_track', type: 'saas', startOn: D('2026-05-20'), deadlineOn: D('2026-09-01'), costBudgetInrMinor: 20_000 }),
    a4: await makeProject(a, { name: 'A due today', status: 'in_review', health: 'at_risk', type: 'website', deadlineOn: D('2026-10-12') }),
    b5: await makeProject(b, { name: 'B delivered late', status: 'delivered', health: 'at_risk', type: 'uiux', startOn: D('2026-04-02'), deadlineOn: D('2026-06-10'), deliveredOn: D('2026-06-15') }),
    b6: await makeProject(b, { name: 'B delivered early', status: 'maintenance', type: 'maintenance', startOn: D('2026-06-01'), deadlineOn: D('2026-07-23'), deliveredOn: D('2026-07-20') }),
    b7: await makeProject(b, { name: 'B delivered no deadline', status: 'delivered', type: 'devops', deliveredOn: D('2026-07-02') }),
    b8: await makeProject(b, { name: 'B delivered last year', status: 'closed', type: 'devops', deadlineOn: D('2025-11-01'), deliveredOn: D('2025-12-01') }),
    b9: await makeProject(b, { name: 'B cancelled', status: 'cancelled', type: 'mobile_app' }),
    a10: await makeProject(a, { name: 'A proposal', status: 'proposal', type: 'custom_software' }),
    archived: await makeProject(a, { name: 'A archived', status: 'active', health: 'off_track', type: 'website', deadlineOn: D('2026-01-01'), archivedAt: new Date() }),
    own: await makeProject(internal, { name: 'Our product', status: 'active', type: 'saas', costBudgetInrMinor: 100_000 }),
  };
  return { a, b, internal, p };
}

async function seedMoney(w: Awaited<ReturnType<typeof portfolio>>) {
  const { p } = w;
  await makePayment(p.a1, { amountMinor: 1_000_000, receivedOn: '2026-06-10' });
  await makePayment(p.a1, { amountMinor: 2_000_000, receivedOn: '2025-12-01' }); // last financial year
  await makePayment(p.a1, { status: 'void', amountMinor: 9_000_000, receivedOn: '2026-06-11' });
  await makeThirdPartyPayout(p.a1, { amountMinor: 200_000, paidOn: '2026-06-15' });
  await makeThirdPartyPayout(p.a1, { amountMinor: 800_000, status: 'due', dueOn: '2026-11-01' });
  await makeExpense({ project: p.a1, amountMinor: 50_000, spentOn: '2026-06-12' });
  await makePayment(p.a2, { amountMinor: 500_000, receivedOn: '2026-07-01' });
  await makeExpense({ project: p.b3, amountMinor: 30_000, spentOn: '2026-08-01' });
  await makeExpense({ amountMinor: 999_000, spentOn: '2026-08-02' }); // company overhead: no project
  await makeTeamPayout({ amountMinor: 400_000, paidOn: '2026-06-30', allocations: [{ project: p.a1, amountMinor: 100_000 }, { project: p.a2, amountMinor: 100_000 }] });
  // the internal project: its receipt is not revenue, its costs are real
  await makePayment(p.own, { amountMinor: 900_000, receivedOn: '2026-06-20' });
  await makeExpense({ project: p.own, amountMinor: 70_000, spentOn: '2026-06-21' });
  await makeThirdPartyPayout(p.own, { amountMinor: 10_000, paidOn: '2026-06-22' });
}

describe('projects dashboard: counts', () => {
  it('counts projects by status, zero-filled, leaving out archived projects', async () => {
    await portfolio();
    const d = await getProjectsDashboard(await superadmin(), FY27, { now: NOW });
    expect(d.total).toBe(11);
    expect(Object.fromEntries(d.byStatus.map((s) => [s.status, s.count]))).toEqual({
      proposal: 1, active: 3, in_review: 1, on_hold: 1, delivered: 2, maintenance: 1, closed: 1, cancelled: 1,
    });
    expect(d.active).toBe(3);
    expect(d.byStatus.map((s) => s.status)).toEqual(['proposal', 'active', 'in_review', 'on_hold', 'delivered', 'maintenance', 'closed', 'cancelled']);
  });

  it('counts at risk and off track among projects in progress only', async () => {
    await portfolio();
    const d = await getProjectsDashboard(await superadmin(), FY27, { now: NOW });
    // A overdue and A due today are at risk, B on hold is off track. The delivered project's stale
    // "at risk" and the archived project's "off track" do not count.
    expect(d.atRisk).toBe(2);
    expect(d.offTrack).toBe(1);
  });

  it('counts overdue as a passed deadline while active, in review or on hold, not on the deadline day', async () => {
    await portfolio();
    const d = await getProjectsDashboard(await superadmin(), FY27, { now: NOW });
    expect(d.overdue).toBe(2); // A overdue and B on hold; not "due today", not delivered-late, not archived
    const nextDay = await getProjectsDashboard(await superadmin(), FY27, { now: new Date('2026-10-13T10:00:00Z') });
    expect(nextDay.overdue).toBe(3);
  });

  it('measures "today" in the organisation zone, not UTC', async () => {
    await portfolio();
    // 20:00 UTC on 12 Oct is already 13 Oct in India, so "due today" (12 Oct) has passed
    const d = await getProjectsDashboard(await superadmin(), FY27, { now: new Date('2026-10-12T20:00:00Z') });
    expect(d.overdue).toBe(3);
  });

  it('counts delivered in the period and the average slip against the deadline', async () => {
    await portfolio();
    const d = await getProjectsDashboard(await superadmin(), FY27, { now: NOW });
    expect(d.deliveredInPeriod).toBe(3); // the one delivered last year is outside
    // 5 days late and 3 days early: the average is +1.0 day, over the two that had a deadline
    expect(d.avgSlipDays).toBe(1);
    expect(d.slipSample).toBe(2);
  });

  it('has no average slip when nothing delivered had a deadline', async () => {
    const client = await makeClient();
    await makeProject(client, { status: 'delivered', deliveredOn: D('2026-07-02') });
    const d = await getProjectsDashboard(await superadmin(), FY27, { now: NOW });
    expect(d.deliveredInPeriod).toBe(1);
    expect(d.avgSlipDays).toBeNull();
    expect(d.slipSample).toBe(0);
  });

  it('charts started against delivered for every month of the period', async () => {
    await portfolio();
    const d = await getProjectsDashboard(await superadmin(), FY27, { now: NOW });
    expect(d.startedVsDelivered).toHaveLength(12);
    expect(d.startedVsDelivered[0]).toMatchObject({ month: '2026-04', label: 'Apr 26' });
    const by = Object.fromEntries(d.startedVsDelivered.map((m) => [m.month, [m.started, m.delivered]]));
    expect(by['2026-04']).toEqual([2, 0]);
    expect(by['2026-05']).toEqual([2, 0]);
    expect(by['2026-06']).toEqual([1, 1]);
    expect(by['2026-07']).toEqual([0, 2]);
    expect(by['2026-08']).toEqual([0, 0]);
    expect(d.startedVsDelivered.at(-1)?.month).toBe('2027-03');
  });

  it('counts projects by type, most first', async () => {
    await portfolio();
    const d = await getProjectsDashboard(await superadmin(), FY27, { now: NOW });
    // devops, saas and website tie at two: ties break alphabetically so the order is stable
    expect(d.byType.slice(0, 3)).toEqual([{ type: 'devops', count: 2 }, { type: 'saas', count: 2 }, { type: 'website', count: 2 }]);
    expect(d.byType.reduce((s, t) => s + t.count, 0)).toBe(11);
  });

  it('narrows every figure to one client', async () => {
    const w = await portfolio();
    const d = await getProjectsDashboard(await superadmin(), FY27, { now: NOW, clientId: String(w.b._id) });
    expect(d.total).toBe(6);
    expect(d.active).toBe(0);
    expect(d.offTrack).toBe(1);
    expect(d.deliveredInPeriod).toBe(3);
  });

  it('shows zeros and no invented figures on an empty database', async () => {
    const d = await getProjectsDashboard(await superadmin(), FY27, { now: NOW });
    expect(d).toMatchObject({ total: 0, active: 0, atRisk: 0, offTrack: 0, overdue: 0, deliveredInPeriod: 0, avgSlipDays: null, slipSample: 0, byType: [] });
    expect(d.byStatus.every((s) => s.count === 0)).toBe(true);
    expect(d.startedVsDelivered).toHaveLength(12);
    expect(d.startedVsDelivered.every((m) => m.started === 0 && m.delivered === 0)).toBe(true);
    expect(d.money).toEqual({ receivedInr: 0, thirdPartyInr: 0, expenseInr: 0, teamInr: 0, costInr: 0, marginInr: 0, marginPct: null, internalCostInr: 0, rows: [], projectsWithMoney: 0, internal: null, budgets: [] });
  });

  it('needs project:view', async () => {
    const viewer = viewerWith(await superadmin(), { remove: ['project:view'] });
    expect((await rejects(getProjectsDashboard(viewer, FY27))).code).toBe('FORBIDDEN');
  });
});

describe('projects dashboard: money', () => {
  it('totals external margin from the ledger: received, costs, margin and percent', async () => {
    const w = await portfolio();
    await seedMoney(w);
    const d = await getProjectsDashboard(await superadmin(), FY27, { now: NOW });
    const m = d.money!;
    expect(m.receivedInr).toBe(1_500_000); // A active 1,000,000 and A overdue 500,000; void and last-year receipts are out
    expect(m.costInr).toBe(480_000); // A active 200,000 + 50,000 + 100,000, A overdue 100,000, B on hold 30,000
    expect(m.marginInr).toBe(1_020_000);
    expect(m.marginPct).toBe(68);
    expect([m.thirdPartyInr, m.expenseInr, m.teamInr]).toEqual([200_000, 80_000, 200_000]);
  });

  it('lists each project with received, third-party, expense, team, margin and percent', async () => {
    const w = await portfolio();
    await seedMoney(w);
    const m = (await getProjectsDashboard(await superadmin(), FY27, { now: NOW })).money!;
    expect(m.projectsWithMoney).toBe(3);
    expect(m.rows.map((r) => r.name)).toEqual(['A active', 'A overdue', 'B on hold']);
    expect(m.rows[0]).toMatchObject({ receivedInr: 1_000_000, thirdPartyInr: 200_000, expenseInr: 50_000, teamInr: 100_000, marginInr: 650_000, marginPct: 65, clientName: 'Client A' });
    expect(m.rows[1]).toMatchObject({ receivedInr: 500_000, teamInr: 100_000, marginInr: 400_000, marginPct: 80 });
    // costs and no revenue: a loss, and no percentage
    expect(m.rows[2]).toMatchObject({ receivedInr: 0, expenseInr: 30_000, marginInr: -30_000, marginPct: null });
  });

  it('keeps company overhead and the unallocated part of a payout out of every project', async () => {
    const w = await portfolio();
    await seedMoney(w);
    const m = (await getProjectsDashboard(await superadmin(), FY27, { now: NOW })).money!;
    const projectCosts = m.rows.reduce((s, r) => s + r.thirdPartyInr + r.expenseInr + r.teamInr, 0);
    expect(projectCosts).toBe(480_000); // not 480,000 + 999,000 overhead + 200,000 unallocated pay
  });

  it('shows internal projects as one Internal row: costs counted, receipts never revenue, outside the margin', async () => {
    const w = await portfolio();
    await seedMoney(w);
    const m = (await getProjectsDashboard(await superadmin(), FY27, { now: NOW })).money!;
    expect(m.internal).toEqual({ projects: 1, thirdPartyInr: 10_000, expenseInr: 70_000, teamInr: 0, costInr: 80_000 });
    expect(m.internalCostInr).toBe(80_000);
    expect(m.rows.some((r) => r.name === 'Our product')).toBe(false);
    expect(m.receivedInr).toBe(1_500_000); // the internal 900,000 receipt is not in it
  });

  it('measures cost budget used on all-time costs, most used first', async () => {
    const w = await portfolio();
    await seedMoney(w);
    // A last-year cost on A active still counts against its budget
    await makeExpense({ project: w.p.a1, amountMinor: 150_000, spentOn: '2025-12-05' });
    const m = (await getProjectsDashboard(await superadmin(), FY27, { now: NOW })).money!;
    expect(m.budgets).toEqual([
      { projectId: String(w.p.b3._id), ref: w.p.b3.ref, name: 'B on hold', budgetInr: 20_000, costInr: 30_000, usedPct: 150 },
      { projectId: String(w.p.own._id), ref: w.p.own.ref, name: 'Our product', budgetInr: 100_000, costInr: 80_000, usedPct: 80 },
      { projectId: String(w.p.a1._id), ref: w.p.a1.ref, name: 'A active', budgetInr: 700_000, costInr: 500_000, usedPct: 71.4 },
    ]);
  });

  it('respects the period and the client filter', async () => {
    const w = await portfolio();
    await seedMoney(w);
    const lastFy = (await getProjectsDashboard(await superadmin(), { from: D('2025-04-01'), to: D('2026-03-31') }, { now: NOW })).money!;
    expect(lastFy.receivedInr).toBe(2_000_000);
    expect(lastFy.rows.map((r) => r.name)).toEqual(['A active']);

    const clientB = (await getProjectsDashboard(await superadmin(), FY27, { now: NOW, clientId: String(w.b._id) })).money!;
    expect(clientB.rows.map((r) => r.name)).toEqual(['B on hold']);
    expect(clientB.receivedInr).toBe(0);
  });

  it('leaves money out entirely, not as zeros, for a viewer without payment:view', async () => {
    const w = await portfolio();
    await seedMoney(w);
    const d = await getProjectsDashboard(await plainAdmin(), FY27, { now: NOW });
    expect(d.money).toBeNull();
    expect(JSON.stringify(d)).not.toMatch(/Inr"|marginInr|budgetInr/);
    expect(d.total).toBe(11); // the rest of the dashboard is still there
  });

  it('caps the table at 25 rows but totals every project', async () => {
    const client = await makeClient();
    let total = 0;
    for (let i = 1; i <= 27; i++) {
      const project = await makeProject(client, { name: `Project ${String(i).padStart(2, '0')}` });
      await makePayment(project, { amountMinor: i * 1000, receivedOn: '2026-06-01' });
      total += i * 1000;
    }
    const m = (await getProjectsDashboard(await superadmin(), FY27, { now: NOW })).money!;
    expect(m.rows).toHaveLength(25);
    expect(m.projectsWithMoney).toBe(27);
    expect(m.receivedInr).toBe(total);
    expect(m.rows[0]?.receivedInr).toBe(27_000);
  });
});

describe('project money tab', () => {
  async function usdProject() {
    const client = await makeClient();
    const project = await makeProject(client, {
      contract: { pricingModel: 'fixed', amountMinor: 1_000_000, currency: 'USD' },
      milestones: [
        { title: 'Kickoff', amountMinor: 300_000, status: 'paid' },
        { title: 'Beta', amountMinor: 200_000, status: 'invoiced' },
        { title: 'Launch', amountMinor: 100_000, status: 'pending' },
      ] as never,
    });
    await makeFxRate('USD', 80, '2026-06-01');
    await makeFxRate('USD', 84, '2026-10-01');
    return { client, project };
  }

  it('computes billable, received, outstanding, margin and projected margin', async () => {
    const { project } = await usdProject();
    // received: USD 4,000.00 at 83.42, less a USD 500.00 refund
    await makePayment(project, { amountMinor: 400_000, currency: 'USD', rate: 83.42, receivedOn: '2026-06-01' });
    await makePayment(project, { type: 'refund', amountMinor: 50_000, currency: 'USD', rate: 83.42, receivedOn: '2026-06-20' });
    await makePayment(project, { status: 'void', amountMinor: 999_000, currency: 'USD', rate: 83.42 });
    await makeThirdPartyPayout(project, { amountMinor: 5_000_000, paidOn: '2026-07-01' });
    await makeExpense({ project, amountMinor: 1_000_000, spentOn: '2026-07-02' });
    await makeTeamPayout({ amountMinor: 3_000_000, paidOn: '2026-07-31', allocations: [{ project, amountMinor: 2_000_000 }] });
    // committed but not yet paid
    await makeThirdPartyPayout(project, { amountMinor: 1_500_000, status: 'due', dueOn: '2026-11-01' });
    await makeTeamPayout({ amountMinor: 900_000, status: 'due', allocations: [{ project, amountMinor: 500_000 }] });
    await makeWorkOrder(project, { agreedMinor: 100_000, currency: 'USD', paidMinor: 30_000, dueMinor: 20_000 }); // USD 500.00 left
    await makeWorkOrder(project, { agreedMinor: 800_000, currency: 'INR' });
    await makeWorkOrder(project, { agreedMinor: 777_000, currency: 'INR', status: 'closed' });

    const r = await getProjectMoney(await superadmin(), String(project._id));
    expect(r).toMatchObject({ contractCurrency: 'USD', billableMinor: 1_000_000, receivedContractMinor: 350_000, outstandingMinor: 650_000 });
    expect(r.margin).toMatchObject({ receivedInr: 29_197_000, thirdPartyInr: 5_000_000, expenseInr: 1_000_000, teamInr: 2_000_000, marginInr: 21_197_000, marginPct: 72.6 });
    expect(r.receivedByCurrency).toEqual([{ currency: 'USD', nativeMinor: 350_000, inrMinor: 29_197_000 }]);
    expect(r.rate).toEqual({ rate: 84, rateOn: '2026-10-01' }); // the latest table rate, not the older one

    expect(r.billableInr).toBe(84_000_000);
    expect(r.committed).toEqual({ dueThirdPartyInr: 1_500_000, openWorkOrderInr: 5_000_000, dueTeamInr: 500_000 });
    // 84,000,000 - (8,000,000 settled + 1,500,000 + 5,000,000 + 500,000)
    expect(r.projected).toEqual({ committedCostInr: 15_000_000, projectedMarginInr: 69_000_000, projectedMarginPct: 82.1 });
    expect(r.missingRates).toEqual([]);
  });

  it('reports a currency with no table rate instead of guessing a projection', async () => {
    const client = await makeClient();
    const project = await makeProject(client, { contract: { pricingModel: 'fixed', amountMinor: 500_000, currency: 'EUR' } });
    const r = await getProjectMoney(await superadmin(), String(project._id));
    expect(r.billableInr).toBeNull();
    expect(r.projected).toBeNull();
    expect(r.missingRates).toEqual(['EUR']);
    expect(r.margin.marginPct).toBeNull();
  });

  it('bills an hourly project by its invoiced and paid milestones', async () => {
    const client = await makeClient();
    const project = await makeProject(client, {
      contract: { pricingModel: 'hourly', amountMinor: 0, currency: 'INR' },
      milestones: [
        { title: 'June', amountMinor: 400_000, status: 'paid' },
        { title: 'July', amountMinor: 300_000, status: 'invoiced' },
        { title: 'August', amountMinor: 900_000, status: 'pending' },
      ] as never,
    });
    await makePayment(project, { amountMinor: 400_000 });
    const r = await getProjectMoney(await superadmin(), String(project._id));
    expect(r).toMatchObject({ billableMinor: 700_000, receivedContractMinor: 400_000, outstandingMinor: 300_000, billableInr: 700_000 });
    expect(r.rate).toBeNull(); // INR needs no rate
  });

  it('shows an advance as a negative outstanding, and has no percentage with nothing received', async () => {
    const client = await makeClient();
    const project = await makeProject(client, { contract: { pricingModel: 'fixed', amountMinor: 100_000, currency: 'INR' } });
    expect((await getProjectMoney(await superadmin(), String(project._id))).margin.marginPct).toBeNull();
    await makePayment(project, { amountMinor: 150_000 });
    expect((await getProjectMoney(await superadmin(), String(project._id))).outstandingMinor).toBe(-50_000);
  });

  it('never counts an internal project\'s receipts as revenue', async () => {
    const internal = await makeInternalClient();
    const project = await makeProject(internal, { contract: { pricingModel: 'fixed', amountMinor: 100_000, currency: 'INR' } });
    await makePayment(project, { amountMinor: 50_000 });
    await makeExpense({ project, amountMinor: 20_000 });
    const r = await getProjectMoney(await superadmin(), String(project._id));
    expect(r.margin).toMatchObject({ receivedInr: 0, expenseInr: 20_000, marginInr: -20_000, marginPct: null });
  });

  it('includes the cost budget used, when there is a budget', async () => {
    const client = await makeClient();
    const project = await makeProject(client, { costBudgetInrMinor: 100_000 });
    await makeExpense({ project, amountMinor: 25_000 });
    expect((await getProjectMoney(await superadmin(), String(project._id))).budget).toEqual({ budgetInr: 100_000, costInr: 25_000, usedPct: 25 });
    const none = await makeProject(client);
    expect((await getProjectMoney(await superadmin(), String(none._id))).budget).toBeNull();
  });

  it('needs payment:view as well as project:view, and answers 404 for a missing project', async () => {
    const client = await makeClient();
    const project = await makeProject(client);
    expect((await rejects(getProjectMoney(await plainAdmin(), String(project._id)))).code).toBe('FORBIDDEN');
    expect((await rejects(getProjectMoney(viewerWith(await superadmin(), { remove: ['project:view'] }), String(project._id)))).code).toBe('FORBIDDEN');
    expect((await rejects(getProjectMoney(await superadmin(), String(new Types.ObjectId())))).code).toBe('NOT_FOUND');
    expect((await rejects(getProjectMoney(await superadmin(), 'bad'))).code).toBe('NOT_FOUND');
  });
});

describe('project tasks tab', () => {
  it('lists the project\'s tasks by status with counts, leaves out archived and other projects\' tasks, and needs task:view', async () => {
    const client = await makeClient();
    const project = await makeProject(client);
    const other = await makeProject(client);
    await makeTask(project, { title: 'Done thing', status: 'done' });
    await makeTask(project, { title: 'In progress thing', status: 'in_progress', assignees: [{ kind: 'admin', id: new Types.ObjectId(), name: 'Ann' }] });
    await makeTask(project, { title: 'Todo thing', status: 'todo' });
    await makeTask(project, { title: 'Archived thing', archivedAt: new Date() });
    await makeTask(other, { title: 'Someone else\'s' });

    const viewer = await superadmin();
    const tasks = await getProjectTasks(viewer, String(project._id));
    expect(tasks.items.map((t) => t.title)).toEqual(['Todo thing', 'In progress thing', 'Done thing']);
    expect(tasks.total).toBe(3);
    expect(tasks.byStatus).toEqual({ done: 1, in_progress: 1, todo: 1 });
    expect(tasks.items[1]?.assignees).toEqual(['Ann']);

    expect((await rejects(getProjectTasks(viewerWith(viewer, { remove: ['task:view'] }), String(project._id)))).code).toBe('FORBIDDEN');
  });
});

describe('project team tab', () => {
  it('shows members and total hours to everyone, and per-person hours only with worklog:viewAll', async () => {
    const client = await makeClient();
    const lead = await makeAdmin({ name: 'Lena Lead' });
    const dev = await makeAdmin({ name: 'Dev Person' });
    const ex = await makeAdmin({ name: 'Former Member' });
    const project = await makeProject(client, { lead: { id: lead._id, name: lead.name }, memberIds: [lead._id, dev._id] });
    const task = await makeTask(project);
    await makeWorkLog(project, task, lead, { minutes: 120, billable: true });
    await makeWorkLog(project, task, dev, { minutes: 90, billable: false });
    await makeWorkLog(project, task, dev, { minutes: 30, billable: true });
    await makeWorkLog(project, task, ex, { minutes: 60 });

    const sa = await superadmin();
    const all = await getProjectTeam(sa, String(project._id));
    expect(all.totalMinutes).toBe(300);
    expect(all.sawAllHours).toBe(true);
    expect(all.members.map((m) => [m.name, m.isLead, m.member, m.minutes, m.billableMinutes])).toEqual([
      ['Lena Lead', true, true, 120, 120],
      ['Dev Person', false, true, 120, 30],
      ['Former Member', false, false, 60, 60],
    ]);
    expect(all.lead).toEqual({ id: String(lead._id), name: 'Lena Lead' });

    // a plain admin who is on the team sees the team and the total, and only their own hours
    const devSession = await sessionFor(dev);
    const own = await getProjectTeam(devSession, String(project._id));
    expect(own.sawAllHours).toBe(false);
    expect(own.totalMinutes).toBe(300);
    expect(own.members.map((m) => [m.name, m.minutes])).toEqual([['Lena Lead', null], ['Dev Person', 120]]);
    expect(JSON.stringify(own)).not.toContain('Former Member');
  });

  it('marks a deactivated member and needs project:view', async () => {
    const client = await makeClient();
    const gone = await makeAdmin({ name: 'Gone Person' });
    const project = await makeProject(client, { memberIds: [gone._id] });
    await Admin.updateOne({ _id: gone._id }, { $set: { status: 'deactivated' } });
    const team = await getProjectTeam(await superadmin(), String(project._id));
    expect(team.members[0]).toMatchObject({ name: 'Gone Person', active: false });
    expect((await rejects(getProjectTeam(viewerWith(await superadmin(), { remove: ['project:view'] }), String(project._id)))).code).toBe('FORBIDDEN');
    expect((await rejects(getProjectTeam(await superadmin(), String(new Types.ObjectId())))).code).toBe('NOT_FOUND');
  });
});

describe('project activity tab', () => {
  async function seedActivity() {
    const client = await makeClient();
    const project = await makeProject(client);
    const id = String(project._id);
    const actor = { id: null, name: 'Someone' };
    const context = { projectId: id, clientId: String(client._id) };
    await audit({ actor, action: 'project.update', entity: { type: 'project', id, label: 'P' }, changes: [{ path: 'name', before: 'a', after: 'b' }, { path: 'contract.amountMinor', before: 1, after: 2 }, { path: 'milestones', after: { amountMinor: 5 } }, { path: 'costBudgetInrMinor', after: 9 }], context });
    await audit({ actor, action: 'task.create', entity: { type: 'task', label: 'T' }, context });
    await audit({ actor, action: 'payment.create', entity: { type: 'payment', label: 'PAY-1' }, changes: [{ path: 'amount.inrMinor', after: 123 }], context });
    await audit({ actor, action: 'expense.create', entity: { type: 'expense', label: 'EXP-1' }, context });
    await audit({ actor, action: 'teamPayout.mark_paid', entity: { type: 'teamPayout', label: 'TMP-1' }, context });
    await audit({ actor, action: 'mystery.thing', entity: { type: 'mystery', label: 'X' }, context });
    return id;
  }

  it('shows a viewer without money access the project and task entries, minus the contract, milestone and budget fields', async () => {
    const id = await seedActivity();
    const entries = await getProjectActivity(await plainAdmin(), id);
    expect(entries.map((e) => e.entity.type).sort()).toEqual(['project', 'task']);
    const project = entries.find((e) => e.entity.type === 'project');
    expect(project?.changes.map((c) => c.path)).toEqual(['name']);
  });

  it('shows money entries only to a viewer who holds that money capability', async () => {
    const id = await seedActivity();
    const paymentOnly = await sessionFor(await makeAdmin({ grants: ['payment:view'] }));
    const types = (await getProjectActivity(paymentOnly, id)).map((e) => e.entity.type).sort();
    expect(types).toEqual(['payment', 'project', 'task']); // not the expense, team payout or unknown entry
    const project = (await getProjectActivity(paymentOnly, id)).find((e) => e.entity.type === 'project');
    expect(project?.changes).toHaveLength(4);
  });

  it('shows everything to a superadmin', async () => {
    const id = await seedActivity();
    expect((await getProjectActivity(await superadmin(), id)).map((e) => e.entity.type).sort()).toEqual(['expense', 'mystery', 'payment', 'project', 'task', 'teamPayout']);
  });

  it('needs project:view', async () => {
    const id = await seedActivity();
    expect((await rejects(getProjectActivity(viewerWith(await superadmin(), { remove: ['project:view'] }), id))).code).toBe('FORBIDDEN');
  });

  it('respects the limit', async () => {
    const id = await seedActivity();
    expect(await getProjectActivity(await superadmin(), id, 2)).toHaveLength(2);
  });
});

describe('dashboard figures never come from a Mongoose document', () => {
  it('returns plain JSON', async () => {
    const w = await portfolio();
    await seedMoney(w);
    const d = await getProjectsDashboard(await superadmin(), FY27, { now: NOW });
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
    expect(await Project.countDocuments({})).toBe(12);
  });
});
