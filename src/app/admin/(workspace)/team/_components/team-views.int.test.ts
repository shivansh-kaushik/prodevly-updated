import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { resolvePeriod } from '@/lib/dates/ranges';
import { getTeamDashboard } from '@/services/dashboards/team';
import { searchTeam } from '@/services/team.service';
import { setupTestDb } from '@/test/db';
import { makeClient, makeProject, makeTask } from '@/test/domain-factories';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { day, makeAssignedTask, makeMember, makePayProfile, makeTeamPayout, makeTeamRole, makeWorkLog } from '@/test/team-factories';
import { TeamDashboardBand } from './team-dashboard';
import { TeamTable } from './team-table';

setupTestDb();

const NOW = new Date('2026-10-12T10:00:00Z');
const period = resolvePeriod({}, NOW);
const range = { from: period.from, to: period.to };

async function seed() {
  const role = await makeTeamRole({ name: 'Developer' });
  const asha = await makeMember({ name: 'Asha Rao', jobRole: role, designation: 'Engineer', skills: ['React', 'Node', 'CSS', 'SQL', 'Go', 'Rust'], weeklyCapacityHours: 40, joinedOn: '2026-04-01' });
  const project = await makeProject(await makeClient());
  const task = await makeTask(project);
  await makeWorkLog(asha, task, { workedOn: '2026-06-02', minutes: 600 });
  await makeAssignedTask(project, [asha], { status: 'todo', due: '2026-10-01' });
  await makePayProfile(asha, { rateMinor: 7_654_321, payoutNote: 'NOTE-MUST-NOT-LEAK' });
  await makeTeamPayout(asha, { status: 'paid', amountMinor: 123_400, paidOn: '2026-05-05' });
  await makeTeamPayout(asha, { status: 'due', amountMinor: 55_500, dueOn: '2026-09-01' });
  return asha;
}

const html = async (viewerSession: Awaited<ReturnType<typeof sessionFor>>) => {
  const dashboard = await getTeamDashboard(viewerSession, range, NOW);
  const members = await searchTeam(viewerSession, range, {}, NOW);
  return (
    renderToStaticMarkup(createElement(TeamDashboardBand, { dashboard, period, sp: {} })) +
    renderToStaticMarkup(createElement(TeamTable, { members, sp: {}, sort: 'name', dir: 'asc', viewerId: viewerSession.id, filtered: false, canCreateAccounts: false }))
  );
};

describe('the team page pieces render from real data', () => {
  it('shows payout tiles, the directory and the skills overflow to a superadmin, and never a pay rate or note', async () => {
    await seed();
    const out = await html(await sessionFor(await makeSuperadmin()));
    expect(out).toContain('Active people');
    expect(out).toContain('Paid to the team');
    expect(out).toContain('Due to the team');
    expect(out).toContain('1 open, 1 overdue');
    expect(out).toContain('Asha Rao');
    expect(out).toContain('+2 more'); // six skills, four shown
    expect(out).toContain('1 overdue');
    expect(out).not.toContain('76,543'); // the pay rate
    expect(out).not.toContain('NOTE-MUST-NOT-LEAK');
    expect(out).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('leaves payout tiles and charts out of the page for an admin without team:payView', async () => {
    await seed();
    const out = await html(await sessionFor(await makeAdmin()));
    expect(out).toContain('Active people');
    expect(out).toContain('Hours by person');
    expect(out).not.toContain('Paid to the team');
    expect(out).not.toContain('Due to the team');
    expect(out).not.toContain('Paid by person');
    expect(out).not.toContain('Paid per month');
    expect(out).not.toContain('1,234'); // the paid amount
  });

  it('renders an empty studio without a crash: zero tiles, empty states', async () => {
    const out = await html(await sessionFor(await makeSuperadmin()));
    expect(out).toContain('No one has a weekly capacity set');
    expect(out).toContain('No records yet'); // empty charts
    expect(out).not.toMatch(/NaN|Infinity/);
  });

  it('shows the empty directory message when a filter matches no one', async () => {
    const out = renderToStaticMarkup(createElement(TeamTable, { members: [], sp: { q: 'zzz' }, sort: 'name', dir: 'asc', viewerId: 'x', filtered: true, canCreateAccounts: false }));
    expect(out).toContain('No one matches');
    expect(out).toContain('Clear filters');
    expect(day('2026-04-01')).toBeTruthy();
  });
});
