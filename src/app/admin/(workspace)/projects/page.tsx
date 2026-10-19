import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { DataToolbar } from '@/components/admin/data-toolbar';
import { ExportButton } from '@/components/admin/export-button';
import { PageHeader } from '@/components/admin/page-header';
import { PeriodPicker } from '@/components/admin/period-picker';
import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { PROJECT_HEALTH, PROJECT_STATUSES, PROJECT_TYPES } from '@/config/statuses';
import { getPeriod } from '@/lib/admin/period';
import { first, objectIdParam, oneOf, parseListParams, withParams, type RawSearchParams } from '@/lib/admin/search-params';
import { formatDateOnly } from '@/lib/dates/date-only';
import { humanize } from '@/lib/admin/format';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { getProjectsDashboard } from '@/services/dashboards/projects';
import { getClientOption, listProjects, PROJECT_SORTS } from '@/services/project.service';
import { BudgetPanel } from './_components/budget-panel';
import { ProjectsStatBand } from './_components/dashboard-stats';
import { StartedDeliveredChart, StatusPanel, TypeChart } from './_components/dashboard-charts';
import { typeLabel } from './_components/labels';
import { MarginTable } from './_components/margin-table';
import { ProjectsTable } from './_components/projects-table';

export const metadata: Metadata = { title: 'Projects' };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage('/admin/projects', { capability: 'project:view' });
  const sp = await searchParams;
  const period = await getPeriod(sp);
  const list = parseListParams(sp, { sortable: PROJECT_SORTS, defaultSort: 'updatedAt', defaultDir: 'desc' });
  const status = oneOf(sp, 'status', PROJECT_STATUSES);
  const health = oneOf(sp, 'health', PROJECT_HEALTH);
  const type = oneOf(sp, 'type', PROJECT_TYPES);
  const archived = oneOf(sp, 'archived', ['only', 'include'] as const);
  const clientId = objectIdParam(sp, 'client');
  const canEdit = viewer.capabilities.has('project:edit');
  const canExport = viewer.capabilities.has('export:data');
  const showMoney = viewer.capabilities.has('payment:view');

  const [dashboard, projects, client] = await Promise.all([
    getProjectsDashboard(viewer, period, { clientId }),
    listProjects(viewer, { q: list.q, status, health, type, archived, clientId, sort: list.sort as (typeof PROJECT_SORTS)[number], dir: list.dir, page: list.page, pageSize: list.pageSize }),
    clientId && viewer.capabilities.has('client:view') ? getClientOption(viewer, clientId) : Promise.resolve(null),
  ]);
  const filtered = Boolean(first(sp, 'q') || status || health || type || archived || clientId);
  const newHref = clientId ? `/admin/projects/new?client=${clientId}` : '/admin/projects/new';

  return (
    <>
      <PageHeader
        title="Projects"
        description="Everything we are building, with its status, health, deadline and margin."
        actions={
          canEdit || canExport ? (
            <>
              <ExportButton section="projects" params={sp} canExport={canExport} />
              {canEdit ? <LinkButton href={newHref} variant="primary"><Plus className="size-4" aria-hidden /> New project</LinkButton> : null}
            </>
          ) : undefined
        }
      />

      <ProjectsStatBand dashboard={dashboard} periodLabel={period.label} params={sp} />

      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <StartedDeliveredChart dashboard={dashboard} periodLabel={period.label} />
        <div className="flex flex-col gap-6">
          <StatusPanel dashboard={dashboard} />
          <TypeChart dashboard={dashboard} />
        </div>
      </div>

      {dashboard.money ? (
        <>
          <MarginTable money={dashboard.money} periodLabel={period.label} />
          <div className="mb-8">
            <BudgetPanel budgets={dashboard.money.budgets} />
          </div>
        </>
      ) : null}

      {clientId ? (
        <p className="mb-3 text-[14px] text-pd-ink-2">
          Showing projects for <span className="font-medium text-pd-ink">{client?.label ?? 'one client'}</span>.{' '}
          <Link href={withParams('/admin/projects', sp, { client: undefined })} className="underline underline-offset-2">Show all clients</Link>
        </p>
      ) : null}

      <DataToolbar
        searchPlaceholder="Search name, reference or client"
        filters={[
          { key: 'status', label: 'Status', options: PROJECT_STATUSES.map((s) => ({ value: s, label: humanize(s) })) },
          { key: 'health', label: 'Health', options: PROJECT_HEALTH.map((h) => ({ value: h, label: humanize(h) })) },
          { key: 'type', label: 'Type', options: PROJECT_TYPES.map((t) => ({ value: t, label: typeLabel(t) })) },
          { key: 'archived', label: 'Archived', allLabel: 'Hide archived', options: [{ value: 'include', label: 'Include archived' }, { value: 'only', label: 'Archived only' }] },
        ]}
      >
        <PeriodPicker current={period.key} from={period.key === 'custom' ? formatDateOnly(period.from) : undefined} to={period.key === 'custom' ? formatDateOnly(period.to) : undefined} />
      </DataToolbar>
      <p className="mb-3 -mt-2 text-[12px] text-pd-ink-3">The period drives the figures above. The list below shows every project that matches the filters.</p>

      {projects.items.length === 0 ? (
        <div className="rounded-pd-md bg-pd-leaf shadow-[0_0_0_1px_var(--color-pd-rule)]">
          <EmptyState
            title={filtered ? 'No projects match' : 'No projects yet'}
            body={filtered ? 'Try a different search or clear the filters.' : canEdit ? 'Create the first project to start tracking status, deadlines and margin.' : 'Projects appear here once they are created.'}
            action={
              filtered ? (
                <Link href="/admin/projects" className="text-[14px] underline">Clear filters</Link>
              ) : canEdit ? (
                <LinkButton href={newHref} variant="primary">Create the first project</LinkButton>
              ) : undefined
            }
            className="py-12"
          />
        </div>
      ) : (
        <>
          <ProjectsTable items={projects.items} params={sp} sort={list.sort} dir={list.dir} showMoney={showMoney} />
          <Pagination meta={projects.meta} path="/admin/projects" params={sp} noun="projects" />
        </>
      )}
    </>
  );
}
