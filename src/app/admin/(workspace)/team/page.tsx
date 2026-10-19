import type { Metadata } from 'next';
import { DataToolbar, type ToolbarFilter } from '@/components/admin/data-toolbar';
import { PageHeader } from '@/components/admin/page-header';
import { PeriodPicker } from '@/components/admin/period-picker';
import { LinkButton } from '@/components/ui/button';
import { EMPLOYMENT_TYPES } from '@/config/statuses';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { humanize } from '@/lib/admin/format';
import { getPeriod } from '@/lib/admin/period';
import { first, objectIdParam, oneOf, parseListParams, type RawSearchParams } from '@/lib/admin/search-params';
import { getTeamDashboard } from '@/services/dashboards/team';
import { listTeamRoles } from '@/services/team-role.service';
import { searchTeam, TEAM_SORT_KEYS, type TeamSortKey } from '@/services/team.service';
import { TeamDashboardBand } from './_components/team-dashboard';
import { TeamTable } from './_components/team-table';

export const metadata: Metadata = { title: 'Team' };

const PATH = '/admin/team';

export default async function TeamPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage(PATH, { capability: 'team:view' });
  const sp = await searchParams;
  const period = await getPeriod(sp);
  const range = { from: period.from, to: period.to };
  const list = parseListParams(sp, { sortable: TEAM_SORT_KEYS, defaultSort: 'name', defaultDir: 'asc' });

  const status = oneOf(sp, 'status', ['deactivated', 'all'] as const);
  const employmentType = oneOf(sp, 'employment', EMPLOYMENT_TYPES);
  // "none" is a real choice (people without a job role); anything else must be a well-formed id.
  const jobRole = first(sp, 'jobRole') === 'none' ? 'none' : objectIdParam(sp, 'jobRole');

  const [dashboard, members, roles] = await Promise.all([
    getTeamDashboard(viewer, range),
    searchTeam(viewer, range, { q: list.q, status, jobRole, employmentType, sort: list.sort as TeamSortKey, dir: list.dir }),
    listTeamRoles(viewer),
  ]);
  const filtered = Boolean(list.q || status || jobRole || employmentType);
  const canSeePayouts = viewer.capabilities.has('team:payView');
  const canEditRoles = viewer.capabilities.has('settings:edit');

  const filters: ToolbarFilter[] = [
    {
      key: 'jobRole',
      label: 'Job role',
      allLabel: 'All job roles',
      options: [
        ...roles.map((r) => ({ value: r.id, label: r.archived ? `${r.name} (archived)` : r.name })),
        { value: 'none', label: 'No job role' },
      ],
    },
    { key: 'employment', label: 'Employment', allLabel: 'Any employment', options: EMPLOYMENT_TYPES.map((t) => ({ value: t, label: humanize(t) })) },
    { key: 'status', label: 'Status', allLabel: 'Active people', options: [{ value: 'deactivated', label: 'Removed' }, { value: 'all', label: 'Everyone' }] },
  ];

  return (
    <>
      <PageHeader
        title="Team"
        description="Who is on the team, what they do and how much is on their plate. Hours follow the period you pick."
        actions={
          canSeePayouts || canEditRoles ? (
            <>
              {canSeePayouts ? <LinkButton href="/admin/team/payouts" variant="secondary">Payouts</LinkButton> : null}
              {canEditRoles ? <LinkButton href="/admin/team/roles" variant="secondary">Job roles</LinkButton> : null}
            </>
          ) : undefined
        }
      />

      <TeamDashboardBand dashboard={dashboard} period={period} sp={sp} />

      <DataToolbar searchPlaceholder="Search name, email, title or skill" filters={filters}>
        <PeriodPicker current={period.key} from={first(sp, 'from')} to={first(sp, 'to')} />
      </DataToolbar>

      <TeamTable
        members={members}
        sp={sp}
        sort={list.sort}
        dir={list.dir}
        viewerId={viewer.id}
        filtered={filtered}
        canCreateAccounts={viewer.capabilities.has('admin:manage')}
        // The person page is for the person themself and for holders of audit:viewAll; linking anyone else's would be a 404.
        canOpenPeople={viewer.capabilities.has('audit:viewAll')}
      />
    </>
  );
}
