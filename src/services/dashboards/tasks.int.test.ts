import { describe, expect, it } from 'vitest';
import type { Types } from 'mongoose';
import { resolvePeriod } from '@/lib/dates/ranges';
import { getTasksDashboard, median, weekStarts } from '@/services/dashboards/tasks';
import { setupTestDb } from '@/test/db';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { makeClient, makeProject, makeTask, makeThirdParty } from '@/test/domain-factories';
import { dayOffset, holding, makeWorkLog, makeWorkspace, without, ymd } from '@/test/task-factories';

setupTestDb();

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const period = () => resolvePeriod({ period: 'custom', from: ymd(dayOffset(-60)), to: ymd(dayOffset(0)) });
const who = (a: { _id: Types.ObjectId; name: string }) => ({ kind: 'admin' as const, id: a._id, name: a.name });

describe('median', () => {
  it('is the middle value, the mean of the middle two, and null for nothing', () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('weekStarts', () => {
  it('returns Mondays, oldest first, ending with the week that holds today', () => {
    const wednesday = new Date('2026-10-14T00:00:00Z');
    const weeks = weekStarts(3, wednesday);
    expect(weeks.map((w) => w.toISOString().slice(0, 10))).toEqual(['2026-09-28', '2026-10-05', '2026-10-12']);
    expect(weekStarts(1, new Date('2026-10-18T00:00:00Z'))[0]?.toISOString().slice(0, 10)).toBe('2026-10-12'); // a Sunday belongs to the week before it
    expect(weekStarts(1, new Date('2026-10-12T00:00:00Z'))[0]?.toISOString().slice(0, 10)).toBe('2026-10-12'); // a Monday starts its own
  });
});

describe('with no records at all', () => {
  it('renders zeros and empty lists, and no ratio', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const d = await getTasksDashboard(sa, period());
    expect(d).toMatchObject({
      openTotal: 0,
      openByStatus: { backlog: 0, todo: 0, in_progress: 0, in_review: 0, blocked: 0 },
      overdue: 0,
      unassigned: 0,
      blocked: 0,
      completedInPeriod: 0,
      medianCycleMs: null,
      cycleSampleSize: 0,
      hours: { scope: 'all', minutes: 0, billableMinutes: 0, billableShare: null },
      openPerAssignee: [],
      hoursByProject: [],
      estimateVsLogged: [],
    });
    expect(d.completedPerWeek).toHaveLength(12);
    expect(d.completedPerWeek.every((w) => w.completed === 0)).toBe(true);
    expect(d.hoursPerWeek.weeks).toHaveLength(12);
    expect(d.hoursPerWeek.people).toEqual([]);
  });
});

describe('task figures', () => {
  async function seed() {
    const client = await makeClient();
    const project = await makeProject(client);
    const asha = await makeAdmin({ name: 'Asha' });
    const bimal = await makeAdmin({ name: 'Bimal' });
    const vendor = await makeThirdParty({ name: 'Pixel Studio' });
    const pixel = { kind: 'thirdParty' as const, id: vendor._id, name: vendor.name };
    // open
    await makeTask(project, { title: 'Backlog item', status: 'backlog' });
    await makeTask(project, { title: 'Late todo', status: 'todo', dueOn: dayOffset(-1), assignees: [who(asha)] });
    await makeTask(project, { title: 'Todo with two', status: 'todo', assignees: [who(asha), who(bimal)] });
    await makeTask(project, { title: 'In progress', status: 'in_progress', dueOn: dayOffset(1), assignees: [who(bimal), pixel] });
    await makeTask(project, { title: 'In review', status: 'in_review' });
    await makeTask(project, { title: 'Stuck', status: 'blocked', dueOn: dayOffset(-3), assignees: [who(asha)] });
    // never counted as open
    await makeTask(project, { title: 'Cancelled', status: 'cancelled', dueOn: dayOffset(-10) });
    await makeTask(project, { title: 'Archived open', status: 'todo', archivedAt: new Date(), dueOn: dayOffset(-10) });
    await makeTask(project, { title: 'Done late', status: 'done', dueOn: dayOffset(-30), completedAt: ago(1), startedAt: ago(3) });
    return { client, project, asha, bimal, vendor };
  }

  it('counts open tasks by status, overdue, unassigned and blocked, leaving out cancelled, done and archived ones', async () => {
    await seed();
    const d = await getTasksDashboard(await sessionFor(await makeSuperadmin()), period());
    expect(d.openByStatus).toEqual({ backlog: 1, todo: 2, in_progress: 1, in_review: 1, blocked: 1 });
    expect(d.openTotal).toBe(6);
    expect(d.overdue).toBe(2); // Late todo, Stuck: the done, cancelled and archived tasks are not overdue
    expect(d.unassigned).toBe(2); // Backlog item, In review
    expect(d.blocked).toBe(1);
  });

  it('stacks open tasks per assignee by status, people and third parties alike, with an Unassigned row', async () => {
    await seed();
    const d = await getTasksDashboard(await sessionFor(await makeSuperadmin()), period());
    const row = (name: string) => d.openPerAssignee.find((r) => r.name === name);
    expect(row('Asha')).toMatchObject({ kind: 'admin', todo: 2, blocked: 1, total: 3 });
    expect(row('Bimal')).toMatchObject({ kind: 'admin', todo: 1, in_progress: 1, total: 2 });
    expect(row('Pixel Studio')).toMatchObject({ kind: 'thirdParty', in_progress: 1, total: 1 });
    expect(row('Unassigned')).toMatchObject({ kind: 'none', backlog: 1, in_review: 1, total: 2 });
    expect(d.openPerAssignee[0]?.name).toBe('Asha'); // heaviest load first
  });

  it('counts what was completed in the period, with the median cycle time of those that were started', async () => {
    const client = await makeClient();
    const project = await makeProject(client);
    await makeTask(project, { status: 'done', startedAt: ago(12), completedAt: ago(10) }); // 2 days
    await makeTask(project, { status: 'done', startedAt: ago(9), completedAt: ago(5) }); // 4 days
    await makeTask(project, { status: 'done', completedAt: ago(4) }); // never started: counted, not in the cycle
    await makeTask(project, { status: 'done', startedAt: ago(200), completedAt: ago(100) }); // outside the period
    await makeTask(project, { status: 'todo', startedAt: ago(5) }); // not done
    const d = await getTasksDashboard(await sessionFor(await makeSuperadmin()), period());
    expect(d.completedInPeriod).toBe(3);
    expect(d.cycleSampleSize).toBe(2);
    expect(d.medianCycleMs).toBe(3 * DAY);
  });

  it('buckets completions into the last 12 weeks, oldest first, and ignores older ones', async () => {
    const client = await makeClient();
    const project = await makeProject(client);
    await makeTask(project, { status: 'done', completedAt: new Date() });
    await makeTask(project, { status: 'done', completedAt: new Date() });
    await makeTask(project, { status: 'done', completedAt: ago(7) });
    await makeTask(project, { status: 'done', completedAt: ago(7 * 11) });
    await makeTask(project, { status: 'done', completedAt: ago(7 * 20) }); // before the window
    const d = await getTasksDashboard(await sessionFor(await makeSuperadmin()), period());
    expect(d.completedPerWeek).toHaveLength(12);
    expect(d.completedPerWeek.at(-1)?.completed).toBe(2);
    expect(d.completedPerWeek.at(-2)?.completed).toBe(1);
    expect(d.completedPerWeek[0]?.completed).toBe(1);
    expect(d.completedPerWeek.reduce((s, w) => s + w.completed, 0)).toBe(4);
    expect((d.completedPerWeek[0]?.weekStart ?? '') < (d.completedPerWeek.at(-1)?.weekStart ?? '')).toBe(true);
  });

  it('narrows every task figure to one project or client', async () => {
    const { project, client } = await seed();
    const otherProject = await makeProject(await makeClient());
    await makeTask(otherProject, { status: 'todo', dueOn: dayOffset(-1) });
    const sa = await sessionFor(await makeSuperadmin());
    expect((await getTasksDashboard(sa, period())).openTotal).toBe(7);
    expect((await getTasksDashboard(sa, period(), { projectId: String(project._id) })).openTotal).toBe(6);
    expect((await getTasksDashboard(sa, period(), { clientId: String(client._id) })).overdue).toBe(2);
    expect((await getTasksDashboard(sa, period(), { projectId: String(otherProject._id) })).openTotal).toBe(1);
  });
});

describe('hours', () => {
  async function seedHours() {
    const w = await makeWorkspace();
    const peer = await makeAdmin({ name: 'Peer Person' });
    const second = await makeProject(w.client, { name: 'Second Project' });
    const secondTask = await makeTask(second);
    await makeWorkLog(w.admin, w.task, { minutes: 60, workedOn: dayOffset(0), billable: true });
    await makeWorkLog(w.admin, w.task, { minutes: 120, workedOn: dayOffset(-7) });
    await makeWorkLog(peer, secondTask, { minutes: 30, workedOn: dayOffset(0), billable: true });
    await makeWorkLog(peer, secondTask, { minutes: 90, workedOn: dayOffset(-70) }); // in the 12 weeks, not in the period
    await makeWorkLog(w.admin, w.task, { minutes: 45, workedOn: dayOffset(-120) }); // in neither
    return { ...w, peer, second };
  }

  it('totals the period and the billable share for a viewer who may see everyone\'s hours', async () => {
    const w = await seedHours();
    const d = await getTasksDashboard(w.superSession, period());
    expect(d.hours).toEqual({ scope: 'all', minutes: 210, billableMinutes: 90, billableShare: 90 / 210 });
    expect(d.hoursByProject.map((p) => [p.name, p.minutes])).toEqual([[w.project.name, 180], ['Second Project', 30]]);
  });

  it('draws hours per person per week for 12 weeks, zero-filled', async () => {
    const w = await seedHours();
    const d = await getTasksDashboard(w.superSession, period());
    expect(d.hoursPerWeek.weeks).toHaveLength(12);
    const person = (name: string) => d.hoursPerWeek.people.find((p) => p.name === name);
    expect(person(w.admin.name)?.minutes).toHaveLength(12);
    expect(person(w.admin.name)?.minutes.at(-1)).toBe(60);
    expect(person(w.admin.name)?.minutes.at(-2)).toBe(120);
    expect(person('Peer Person')?.minutes.at(-1)).toBe(30);
    expect(person('Peer Person')?.minutes[1]).toBe(90); // 70 days back is week 2 of 12
    expect(d.hoursPerWeek.people.flatMap((p) => p.minutes).reduce((a, b) => a + b, 0)).toBe(300);
  });

  it('shows a viewer without worklog:viewAll only their own hours, and no estimate-against-logged chart', async () => {
    const w = await seedHours();
    const d = await getTasksDashboard(w.adminSession, period());
    expect(d.hours).toMatchObject({ scope: 'own', minutes: 180, billableMinutes: 60 });
    expect(d.hoursPerWeek.scope).toBe('own');
    expect(d.hoursPerWeek.people.map((p) => p.name)).toEqual([w.admin.name]);
    expect(d.hoursByProject).toHaveLength(1);
    expect(d.estimateVsLogged).toBeNull();
    expect(JSON.stringify(d)).not.toContain('Peer Person');
    // the same task figures are visible to them
    expect(d.openTotal).toBe(2);
  });

  it('lists estimate against logged minutes for tasks done in the period, biggest overrun first, only those with an estimate', async () => {
    const w = await makeWorkspace();
    await makeTask(w.project, { title: 'Under', status: 'done', completedAt: ago(2), estimateMinutes: 120, loggedMinutes: 60 });
    await makeTask(w.project, { title: 'Over', status: 'done', completedAt: ago(2), estimateMinutes: 60, loggedMinutes: 200 });
    await makeTask(w.project, { title: 'No estimate', status: 'done', completedAt: ago(2), loggedMinutes: 500 });
    await makeTask(w.project, { title: 'Too old', status: 'done', completedAt: ago(100), estimateMinutes: 60, loggedMinutes: 900 });
    const d = await getTasksDashboard(w.superSession, period());
    expect(d.estimateVsLogged?.map((t) => [t.title, t.estimateMinutes, t.loggedMinutes])).toEqual([['Over', 60, 200], ['Under', 120, 60]]);
  });

  it('keeps the biggest people and folds the rest into Others', async () => {
    const w = await makeWorkspace();
    for (let i = 0; i < 10; i++) {
      const person = await makeAdmin({ name: `Person ${String.fromCharCode(65 + i)}` });
      await makeWorkLog(person, w.task, { minutes: 10 + i * 10, workedOn: dayOffset(0) });
    }
    const d = await getTasksDashboard(w.superSession, period());
    expect(d.hoursPerWeek.people).toHaveLength(9);
    expect(d.hoursPerWeek.people.at(-1)).toMatchObject({ id: 'others', name: 'Others' });
    expect(d.hoursPerWeek.people.at(-1)?.minutes.at(-1)).toBe(10 + 20); // the two smallest
  });
});

describe('who may see it', () => {
  it('needs task:view', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    await expect(getTasksDashboard(without(sa, 'task:view'), period())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a grant of worklog:viewAll switches everyone\'s hours on', async () => {
    const w = await seedHoursFor();
    const granted = holding(w.adminSession, 'task:view', 'worklog:own', 'worklog:viewAll');
    expect((await getTasksDashboard(granted, period())).hours.scope).toBe('all');
    expect((await getTasksDashboard(w.adminSession, period())).hours.scope).toBe('own');
  });
});

async function seedHoursFor() {
  const w = await makeWorkspace();
  await makeWorkLog(w.admin, w.task, { minutes: 60 });
  return w;
}
