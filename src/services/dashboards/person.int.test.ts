import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Admin } from '@/models';
import { resolvePeriod } from '@/lib/dates/ranges';
import { audit } from '@/services/audit.service';
import { getPersonDashboard } from '@/services/dashboards/person';
import { weekStarts } from '@/services/dashboards/tasks';
import { setupTestDb } from '@/test/db';
import { makeAdmin, sessionFor } from '@/test/factories';
import { makeProject, makeTask } from '@/test/domain-factories';
import { dayOffset, holding, makeOutOfPocketExpense, makeTeamPayout, makeWorkLog, makeWorkspace, ymd } from '@/test/task-factories';

setupTestDb();

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const period = () => resolvePeriod({ period: 'custom', from: ymd(dayOffset(-60)), to: ymd(dayOffset(0)) });
const id = (d: { _id: Types.ObjectId }) => String(d._id);
/** The Monday ("YYYY-MM-DD") of the week a date falls in. */
const mondayOf = (d: Date) => ymd(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY));
const mine = (a: { _id: Types.ObjectId; name: string }) => ({ kind: 'admin' as const, id: a._id, name: a.name });

describe('who may open it', () => {
  it('lets a person see their own, a superadmin see anyone\'s, and nobody else see it', async () => {
    const w = await makeWorkspace();
    const peer = await sessionFor(await makeAdmin());
    expect((await getPersonDashboard(w.adminSession, id(w.admin), period())).person.id).toBe(id(w.admin));
    expect((await getPersonDashboard(w.superSession, id(w.admin), period())).person.name).toBe(w.admin.name);
    await expect(getPersonDashboard(peer, id(w.admin), period())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // pay rights alone do not open someone else's dashboard
    await expect(getPersonDashboard(holding(peer, 'team:payView', 'team:view', 'worklog:viewAll'), id(w.admin), period())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('answers 404 for an unknown or malformed id, even to a superadmin', async () => {
    const w = await makeWorkspace();
    await expect(getPersonDashboard(w.superSession, String(new Types.ObjectId()), period())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getPersonDashboard(w.superSession, 'nope', period())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('treats a differently-cased id as the same person', async () => {
    const w = await makeWorkspace();
    expect((await getPersonDashboard(w.adminSession, id(w.admin).toUpperCase(), period())).person.id).toBe(id(w.admin));
  });
});

describe('with no records at all', () => {
  it('renders zeros, no ratios and an empty activity list', async () => {
    const w = await makeWorkspace();
    const d = await getPersonDashboard(w.adminSession, id(w.admin), period());
    expect(d.hours).toEqual({ thisWeekMinutes: 0, thisMonthMinutes: 0, periodMinutes: 0, periodBillableMinutes: 0 });
    expect(d.hoursPerWeek).toHaveLength(12);
    expect(d.hoursPerWeek.every((h) => h.minutes === 0)).toBe(true);
    expect(d.hoursByProject).toEqual([]);
    expect(d.tasks).toEqual({ open: 0, overdue: 0, completedInPeriod: 0, withDueDate: 0, onTime: 0, onTimePercent: null, medianCycleMs: null, cycleSampleSize: 0 });
    expect(d.pay).toEqual({
      paidInPeriodInrMinor: 0,
      paidInPeriodCount: 0,
      paidInPeriodNative: [],
      dueCount: 0,
      dueInrMinor: 0,
      reimbursements: { owedCount: 0, owedInrMinor: 0, awaitingApprovalCount: 0, awaitingApprovalInrMinor: 0 },
    });
    expect(d.recentActivity).toEqual([]);
    expect(d.person).toMatchObject({ designation: null, active: true, lastLoginAt: null });
  });
});

describe('hours', () => {
  it('totals this week, this month and the period, per week for 12 weeks and per project, for this person only', async () => {
    const w = await makeWorkspace();
    const peer = await makeAdmin();
    const second = await makeProject(w.client, { name: 'Second Project' });
    const secondTask = await makeTask(second);
    await makeWorkLog(w.admin, w.task, { minutes: 60, workedOn: dayOffset(0), billable: true });
    await makeWorkLog(w.admin, secondTask, { minutes: 30, workedOn: dayOffset(0) });
    await makeWorkLog(w.admin, w.task, { minutes: 120, workedOn: dayOffset(-8) }); // last week
    await makeWorkLog(w.admin, w.task, { minutes: 200, workedOn: dayOffset(-40), billable: true }); // a previous month
    await makeWorkLog(w.admin, w.task, { minutes: 15, workedOn: dayOffset(-90) }); // outside the period, inside no week of the 12
    await makeWorkLog(peer, w.task, { minutes: 500, workedOn: dayOffset(0) }); // someone else
    const d = await getPersonDashboard(w.adminSession, id(w.admin), period());
    expect(d.hours.thisWeekMinutes).toBe(90);
    expect(d.hours.thisMonthMinutes).toBeGreaterThanOrEqual(90);
    expect(d.hours.thisMonthMinutes).toBeLessThanOrEqual(90 + 120); // the log 8 days back may share the month
    expect(d.hours.periodMinutes).toBe(60 + 30 + 120 + 200);
    expect(d.hours.periodBillableMinutes).toBe(260);
    const week = (date: Date) => d.hoursPerWeek.find((h) => h.weekStart === mondayOf(date))?.minutes;
    expect(d.hoursPerWeek.at(-1)?.minutes).toBe(90);
    expect(week(dayOffset(-8))).toBe(120); // 8 days back is always an earlier week, whatever today is
    expect(week(dayOffset(-40))).toBe(200);
    expect(d.hoursPerWeek.map((h) => h.weekStart)).toEqual(weekStarts(12, dayOffset(0)).map(ymd));
    expect(d.hoursPerWeek.reduce((s, h) => s + h.minutes, 0)).toBe(90 + 120 + 200);
    expect(d.hoursByProject.map((p) => [p.name, p.minutes])).toEqual([[w.project.name, 380], ['Second Project', 30]]);
  });
});

describe('tasks', () => {
  async function seedTasks() {
    const w = await makeWorkspace();
    const peer = await makeAdmin();
    const p = w.project;
    // completed in the period, assigned to this person
    await makeTask(p, { status: 'done', assignees: [mine(w.admin)], startedAt: ago(4), completedAt: ago(2), dueOn: dayOffset(1) }); // on time, 2 days
    await makeTask(p, { status: 'done', assignees: [mine(w.admin)], startedAt: ago(12), completedAt: ago(2), dueOn: dayOffset(-5) }); // late, 10 days
    await makeTask(p, { status: 'done', assignees: [mine(w.admin)], completedAt: ago(2) }); // no due date, never started
    await makeTask(p, { status: 'done', assignees: [mine(w.admin)], completedAt: new Date(), dueOn: dayOffset(0) }); // done ON the due date counts as on time
    await makeTask(p, { status: 'done', assignees: [mine(w.admin)], completedAt: ago(200), dueOn: dayOffset(-210) }); // outside the period
    await makeTask(p, { status: 'done', assignees: [mine(peer)], completedAt: ago(2), dueOn: dayOffset(-5) }); // someone else's
    // open
    await makeTask(p, { status: 'todo', assignees: [mine(w.admin)], dueOn: dayOffset(-2) });
    await makeTask(p, { status: 'in_progress', assignees: [mine(w.admin), mine(peer)], dueOn: dayOffset(3) });
    await makeTask(p, { status: 'todo', assignees: [mine(peer)], dueOn: dayOffset(-2) });
    await makeTask(p, { status: 'todo', assignees: [mine(w.admin)], archivedAt: new Date(), dueOn: dayOffset(-2) });
    await makeTask(p, { status: 'cancelled', assignees: [mine(w.admin)], dueOn: dayOffset(-2) });
    return w;
  }

  it('counts open and overdue tasks and what this person completed, leaving out other people\'s, archived and cancelled ones', async () => {
    const w = await seedTasks();
    const d = await getPersonDashboard(w.adminSession, id(w.admin), period());
    expect(d.tasks.open).toBe(2);
    expect(d.tasks.overdue).toBe(1);
    expect(d.tasks.completedInPeriod).toBe(4);
  });

  it('measures on-time completion against the due date, only over tasks that had one', async () => {
    const w = await seedTasks();
    const d = await getPersonDashboard(w.adminSession, id(w.admin), period());
    expect(d.tasks).toMatchObject({ withDueDate: 3, onTime: 2, onTimePercent: 67 });
  });

  it('takes the median cycle time over completed tasks that were started', async () => {
    const w = await seedTasks();
    const d = await getPersonDashboard(w.adminSession, id(w.admin), period());
    expect(d.tasks.cycleSampleSize).toBe(2);
    expect(d.tasks.medianCycleMs).toBeCloseTo(6 * DAY, -4); // (2 days + 10 days) / 2, within a few ms
  });
});

describe('pay', () => {
  it('shows what was paid in the period in INR with the native amounts, what is due, and reimbursements waiting', async () => {
    const w = await makeWorkspace();
    const peer = await makeAdmin();
    await makeTeamPayout(w.admin, { paidOn: dayOffset(-5), inrMinor: 1_000_000 });
    await makeTeamPayout(w.admin, { paidOn: dayOffset(-6), foreign: { currency: 'USD', amountMinor: 100_000, fxRate: 83.5 } });
    await makeTeamPayout(w.admin, { paidOn: dayOffset(-120), inrMinor: 9_000_000 }); // outside the period
    await makeTeamPayout(w.admin, { status: 'void', inrMinor: 7_000_000 });
    await makeTeamPayout(w.admin, { status: 'due', inrMinor: 400_000 });
    await makeTeamPayout(w.admin, { status: 'due', inrMinor: 100_000 });
    await makeTeamPayout(peer, { paidOn: dayOffset(-5), inrMinor: 5_000_000 }); // someone else
    await makeOutOfPocketExpense(w.admin, { status: 'approved', inrMinor: 250_000 });
    await makeOutOfPocketExpense(w.admin, { status: 'approved', inrMinor: 50_000 });
    await makeOutOfPocketExpense(w.admin, { status: 'submitted', inrMinor: 100_000 });
    await makeOutOfPocketExpense(w.admin, { status: 'paid', inrMinor: 900_000 });
    await makeOutOfPocketExpense(w.admin, { status: 'rejected', inrMinor: 800_000 });
    await makeOutOfPocketExpense(peer, { status: 'approved', inrMinor: 600_000 });

    const d = await getPersonDashboard(w.adminSession, id(w.admin), period());
    expect(d.pay).toEqual({
      paidInPeriodInrMinor: 1_000_000 + 8_350_000,
      paidInPeriodCount: 2,
      paidInPeriodNative: [
        { currency: 'INR', amountMinor: 1_000_000, inrMinor: 1_000_000 },
        { currency: 'USD', amountMinor: 100_000, inrMinor: 8_350_000 },
      ],
      dueCount: 2,
      dueInrMinor: 500_000,
      reimbursements: { owedCount: 2, owedInrMinor: 300_000, awaitingApprovalCount: 1, awaitingApprovalInrMinor: 100_000 },
    });
  });

  it('is shown to the person and to someone holding team:payView, and left out for anyone else', async () => {
    const w = await makeWorkspace();
    await makeTeamPayout(w.admin, { paidOn: dayOffset(-5), inrMinor: 1_000_000 });
    expect((await getPersonDashboard(w.adminSession, id(w.admin), period())).pay?.paidInPeriodInrMinor).toBe(1_000_000);
    expect((await getPersonDashboard(w.superSession, id(w.admin), period())).pay?.paidInPeriodInrMinor).toBe(1_000_000);
    // a viewer who may read the person's activity but not their pay
    const noPay = holding(w.superSession, 'audit:viewAll');
    const d = await getPersonDashboard(noPay, id(w.admin), period());
    expect(d.pay).toBeNull();
    expect(JSON.stringify(d)).not.toContain('1000000');
  });
});

describe('activity and sign-in', () => {
  it('lists this person\'s latest 20 audit entries, newest first, and nobody else\'s', async () => {
    const w = await makeWorkspace();
    for (let i = 0; i < 25; i++) {
      await audit({ actor: { id: id(w.admin), name: w.admin.name, role: 'admin' }, action: 'task.update', entity: { type: 'task', id: id(w.task), label: `Edit ${i}` } });
    }
    await audit({ actor: { id: id(w.superadmin), name: w.superadmin.name, role: 'superadmin' }, action: 'task.update', entity: { type: 'task', label: 'Not theirs' } });
    const d = await getPersonDashboard(w.adminSession, id(w.admin), period());
    expect(d.recentActivity).toHaveLength(20);
    expect(d.recentActivity.every((e) => e.actorName === w.admin.name)).toBe(true);
    expect(d.recentActivity[0]?.entity.label).toBe('Edit 24');
    expect(d.recentActivity.at(-1)?.entity.label).toBe('Edit 5');
  });

  it('reports the last sign-in, the designation and whether the account is active', async () => {
    const w = await makeWorkspace();
    const at = new Date('2026-10-10T09:30:00Z');
    await Admin.updateOne({ _id: w.admin._id }, { $set: { lastLoginAt: at, 'profile.designation': 'Frontend developer' } });
    const d = await getPersonDashboard(w.superSession, id(w.admin), period());
    expect(d.person).toMatchObject({ lastLoginAt: at.toISOString(), designation: 'Frontend developer', active: true });
    await Admin.updateOne({ _id: w.admin._id }, { $set: { status: 'deactivated' } });
    expect((await getPersonDashboard(w.superSession, id(w.admin), period())).person.active).toBe(false);
  });

  it('returns plain JSON: no ids as objects, no hashes', async () => {
    const w = await makeWorkspace();
    await makeWorkLog(w.admin, w.task);
    const json = JSON.stringify(await getPersonDashboard(w.superSession, id(w.admin), period()));
    expect(json).not.toMatch(/passwordHash|\$2[aby]\$|"_id"|ipHash/);
    expect(JSON.parse(json)).toBeTruthy();
  });
});
