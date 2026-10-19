import { describe, expect, it } from 'vitest';
import { getTeamDashboard } from '@/services/dashboards/team';
import { setupTestDb } from '@/test/db';
import { makeClient, makeProject, makeTask } from '@/test/domain-factories';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { mongoose } from '@/lib/db/mongoose';
import { Admin, TeamRole } from '@/models';
import { day, makeAssignedTask, makeMember, makeTeamPayout, makeTeamRole, makeWorkLog } from '@/test/team-factories';

setupTestDb();

const NOW = new Date('2026-10-12T10:00:00Z'); // 12 Oct 2026 in India
const FY27 = { from: day('2026-04-01'), to: day('2027-03-31') };

const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string };
  }
  throw new Error('expected the call to be rejected');
};

/** A small studio: five active people, one removed, work, tasks and payouts, including rows that must NOT count. */
async function seedStudio() {
  const sa = await makeSuperadmin({ name: 'Sam Founder' });
  const dev = await makeTeamRole({ name: 'Developer' });
  const designer = await makeTeamRole({ name: 'Designer' });
  const asha = await makeMember({ name: 'Asha Rao', jobRole: dev, weeklyCapacityHours: 40, joinedOn: '2026-04-01' });
  const ben = await makeMember({ name: 'Ben Das', jobRole: dev });
  const chen = await makeMember({ name: 'Chen Li', jobRole: designer, weeklyCapacityHours: 20 });
  const dee = await makeMember({ name: 'Dee Roy' });
  const gone = await makeMember({ name: 'Gone Away', jobRole: dev, status: 'deactivated' });

  const project = await makeProject(await makeClient());
  const task = await makeTask(project);

  // Hours: Asha 3 x 12h in the period; Ben 5h; the removed account 2h; one log BEFORE the period.
  for (const d of ['2026-05-10', '2026-05-11', '2026-06-02']) await makeWorkLog(asha, task, { workedOn: d, minutes: 720 });
  await makeWorkLog(ben, task, { workedOn: '2026-06-01', minutes: 300 });
  await makeWorkLog(gone, task, { workedOn: '2026-05-05', minutes: 120 });
  await makeWorkLog(asha, task, { workedOn: '2026-03-30', minutes: 600 });

  // Open work: Asha two (one overdue), Ben one (shared with Asha), the removed account one; done and cancelled do not count.
  await makeAssignedTask(project, [asha], { status: 'in_progress', due: '2026-10-01' });
  await makeAssignedTask(project, [asha, ben], { status: 'todo', due: '2026-12-01' });
  await makeAssignedTask(project, [gone], { status: 'blocked' });
  await makeAssignedTask(project, [chen], { status: 'done', due: '2026-09-01' });
  await makeAssignedTask(project, [chen], { status: 'cancelled' });

  // Payouts. Paid in the period: Asha 5,000 and 3,000 INR; Ben USD 100 at 80 = INR 8,000.
  await makeTeamPayout(asha, { status: 'paid', amountMinor: 500_000, paidOn: '2026-05-05' });
  await makeTeamPayout(asha, { status: 'paid', amountMinor: 300_000, paidOn: '2026-06-05' });
  await makeTeamPayout(ben, { status: 'paid', amountMinor: 10_000, currency: 'USD', fxRate: 80, paidOn: '2026-05-20' });
  // Not counted as paid: void, paid before the period, paid after it.
  await makeTeamPayout(asha, { status: 'void', amountMinor: 9_999_900, paidOn: '2026-05-06' });
  await makeTeamPayout(asha, { status: 'paid', amountMinor: 7_000_000, paidOn: '2026-03-30' });
  await makeTeamPayout(asha, { status: 'paid', amountMinor: 8_000_000, paidOn: '2027-04-02' });
  // Due: one overdue, one in the future, one with no due date. Due ignores the period.
  await makeTeamPayout(chen, { status: 'due', amountMinor: 250_000, dueOn: '2026-09-01' });
  await makeTeamPayout(dee, { status: 'due', amountMinor: 100_000, dueOn: '2026-12-01' });
  await makeTeamPayout(dee, { status: 'due', amountMinor: 50_000 });

  return { sa, asha, ben, chen, dee, gone, dev, designer };
}

describe('who may open the team dashboard', () => {
  it('needs team:view', async () => {
    const s = await sessionFor(await makeAdmin());
    const viewer = { ...s, capabilities: new Set([...s.capabilities].filter((c) => c !== 'team:view')) };
    expect((await rejects(getTeamDashboard(viewer, FY27, NOW))).code).toBe('FORBIDDEN');
  });
});

describe('the figures', () => {
  it('counts people, groups them by job role, and adds up hours from work logs in the period only', async () => {
    const { sa } = await seedStudio();
    const d = await getTeamDashboard(await sessionFor(sa), FY27, NOW);
    expect(d.period).toEqual({ from: '2026-04-01', to: '2027-03-31' });
    expect(d.activeMembers).toBe(5);
    expect(d.removedMembers).toBe(1);
    // Active only (the removed Developer is not counted); people without a role come last
    expect(d.membersByRole).toEqual([
      { id: expect.any(String), name: 'Developer', count: 2, archived: false },
      { id: expect.any(String), name: 'Designer', count: 1, archived: false },
      { id: null, name: 'No job role', count: 2, archived: false },
    ]);
    expect(d.loggedMinutes).toBe(3 * 720 + 300 + 120); // the March log is outside the period
    expect(d.hoursByPerson.map((p) => [p.name, p.minutes])).toEqual([
      ['Asha Rao', 2160],
      ['Ben Das', 300],
      ['Gone Away', 120],
    ]);
  });

  it('counts open tasks per person: not done, not cancelled, once each, with overdue split out', async () => {
    const { sa, asha } = await seedStudio();
    const d = await getTeamDashboard(await sessionFor(sa), FY27, NOW);
    expect(d.openTasksByPerson).toEqual([
      { id: String(asha._id), name: 'Asha Rao', open: 2, overdue: 1, removed: false },
      { id: expect.any(String), name: 'Ben Das', open: 1, overdue: 0, removed: false },
      { id: expect.any(String), name: 'Gone Away', open: 1, overdue: 0, removed: true },
    ]);
  });

  it('computes utilisation over the people with a weekly capacity, for the part of the period that has passed', async () => {
    const { sa } = await seedStudio();
    const d = await getTeamDashboard(await sessionFor(sa), FY27, NOW);
    // 1 Apr to 12 Oct 2026 is 195 days. Asha 40 h/week, Chen 20 h/week: 66857 + 33429 minutes.
    expect(d.utilisation.members).toBe(2);
    expect(d.utilisation.capacityMinutes).toBe(66_857 + 33_429);
    // Only Asha's time counts (Chen logged none): 2160 / 100286
    expect(d.utilisation.loggedMinutes).toBe(2160);
    expect(d.utilisation.percent).toBe(2.2);
  });

  it('gives no utilisation when nobody has a capacity set, instead of 0% or NaN', async () => {
    const sa = await makeSuperadmin();
    await makeMember({ name: 'No Capacity' });
    const d = await getTeamDashboard(await sessionFor(sa), FY27, NOW);
    expect(d.utilisation).toEqual({ percent: null, loggedMinutes: 0, capacityMinutes: 0, members: 0 });
  });

  it('gives no utilisation for a period that has not started, even with a capacity set', async () => {
    const sa = await makeSuperadmin();
    await makeMember({ name: 'Has Capacity', weeklyCapacityHours: 40 });
    const d = await getTeamDashboard(await sessionFor(sa), { from: day('2027-01-01'), to: day('2027-01-31') }, NOW);
    expect(d.utilisation).toMatchObject({ percent: null, capacityMinutes: 0, members: 1 });
  });

  it('shows a person\'s current name even if their old logs carry the old one', async () => {
    const sa = await makeSuperadmin();
    const asha = await makeMember({ name: 'Asha Old' });
    const task = await makeTask(await makeProject(await makeClient()));
    await makeWorkLog(asha, task, { workedOn: '2026-05-10', minutes: 60 });
    await Admin.updateOne({ _id: asha._id }, { $set: { name: 'Asha New' } });
    const d = await getTeamDashboard(await sessionFor(sa), FY27, NOW);
    expect(d.hoursByPerson[0]?.name).toBe('Asha New');
  });

  it('files a role that was deleted after being assigned under "No job role"', async () => {
    const sa = await makeSuperadmin();
    const role = await makeTeamRole({ name: 'Short-lived' });
    await makeMember({ jobRole: role });
    await TeamRole.deleteOne({ _id: role._id });
    const d = await getTeamDashboard(await sessionFor(sa), FY27, NOW);
    expect(d.membersByRole).toEqual([{ id: null, name: 'No job role', count: 2, archived: false }]); // the member and the superadmin
  });
});

describe('payouts', () => {
  it('sums PAID payouts by paid-on date from inrMinor, excluding void and anything outside the period', async () => {
    const { sa, asha, ben } = await seedStudio();
    const p = (await getTeamDashboard(await sessionFor(sa), FY27, NOW)).payouts;
    expect(p).not.toBeNull();
    expect(p?.paidInrMinor).toBe(500_000 + 300_000 + 800_000); // USD 100.00 at 80 is INR 8,000.00
    expect(p?.paidCount).toBe(3);
    expect(p?.paidNative).toEqual([{ currency: 'USD', amountMinor: 10_000, inrMinor: 800_000 }]); // secondary line, INR is not repeated
    expect(p?.byPerson).toEqual([
      { id: String(asha._id), name: 'Asha Rao', inrMinor: 800_000 },
      { id: String(ben._id), name: 'Ben Das', inrMinor: 800_000 }, // tie: by name
    ]);
  });

  it('spreads paid payouts over every month of the period, zero-filled', async () => {
    const { sa } = await seedStudio();
    const p = (await getTeamDashboard(await sessionFor(sa), FY27, NOW)).payouts;
    expect(p?.byMonth).toHaveLength(12);
    expect(p?.byMonth[0]).toEqual({ month: '2026-04', inrMinor: 0 });
    expect(p?.byMonth.find((m) => m.month === '2026-05')).toEqual({ month: '2026-05', inrMinor: 500_000 + 800_000 });
    expect(p?.byMonth.find((m) => m.month === '2026-06')).toEqual({ month: '2026-06', inrMinor: 300_000 });
    expect(p?.byMonth.at(-1)).toEqual({ month: '2027-03', inrMinor: 0 });
    expect(p?.byMonth.reduce((s, m) => s + m.inrMinor, 0)).toBe(p?.paidInrMinor);
  });

  it('reports what is owed now: every open payout, whatever the period, with the overdue ones counted', async () => {
    const { sa } = await seedStudio();
    const inFuturePeriod = await getTeamDashboard(await sessionFor(sa), { from: day('2030-01-01'), to: day('2030-01-31') }, NOW);
    expect(inFuturePeriod.payouts).toMatchObject({ dueInrMinor: 250_000 + 100_000 + 50_000, dueCount: 3, overdueCount: 1, paidInrMinor: 0, paidCount: 0 });
  });

  it('is left out entirely for a viewer without team:payView, and nothing else changes', async () => {
    const { sa, ben } = await seedStudio();
    const full = await getTeamDashboard(await sessionFor(sa), FY27, NOW);
    const plain = await getTeamDashboard(await sessionFor(ben), FY27, NOW);
    expect(plain.payouts).toBeNull();
    expect(JSON.stringify(plain)).not.toMatch(/payouts":\{|inrMinor|paidNative/);
    expect({ ...full, payouts: null }).toEqual(plain);
  });

  it('keeps payout figures out of a viewer who was granted every money capability that CAN be granted', async () => {
    await seedStudio();
    const granted = await makeAdmin({ grants: ['payment:view', 'payment:record', 'payout:view', 'payout:record', 'expense:view', 'expense:record', 'export:data'] });
    expect((await getTeamDashboard(await sessionFor(granted), FY27, NOW)).payouts).toBeNull();
  });
});

describe('an empty database', () => {
  it('renders zeros and empty lists, never NaN, with the viewer as the only person', async () => {
    const sa = await makeSuperadmin();
    const d = await getTeamDashboard(await sessionFor(sa), FY27, NOW);
    expect(d).toMatchObject({
      activeMembers: 1,
      removedMembers: 0,
      loggedMinutes: 0,
      hoursByPerson: [],
      openTasksByPerson: [],
      membersByRole: [{ id: null, name: 'No job role', count: 1, archived: false }],
      utilisation: { percent: null, loggedMinutes: 0, capacityMinutes: 0, members: 0 },
    });
    expect(d.payouts).toMatchObject({ paidInrMinor: 0, paidCount: 0, paidNative: [], dueInrMinor: 0, dueCount: 0, overdueCount: 0, byPerson: [] });
    expect(d.payouts?.byMonth).toHaveLength(12);
    expect(d.payouts?.byMonth.every((m) => m.inrMinor === 0)).toBe(true);
    expect(JSON.stringify(d)).not.toMatch(/NaN|Infinity/);
  });

  it('renders zero people when even the admins collection is empty (a viewer whose row is gone)', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    await mongoose.connection.db?.collection('admins').deleteMany({});
    const d = await getTeamDashboard(sa, FY27, NOW);
    expect(d.activeMembers).toBe(0);
    expect(d.membersByRole).toEqual([]);
    expect(d.utilisation.percent).toBeNull();
  });
});

describe('periods', () => {
  it('follows a custom range: a single month covers one month bucket and only that month\'s hours and payouts', async () => {
    const { sa } = await seedStudio();
    const may = { from: day('2026-05-01'), to: day('2026-05-31') };
    const d = await getTeamDashboard(await sessionFor(sa), may, NOW);
    expect(d.payouts?.byMonth).toEqual([{ month: '2026-05', inrMinor: 1_300_000 }]);
    expect(d.payouts?.paidInrMinor).toBe(1_300_000);
    expect(d.loggedMinutes).toBe(720 * 2 + 120); // Asha's two May days and the removed account's May log
  });
});
