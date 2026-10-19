import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { DataToolbar } from '@/components/admin/data-toolbar';
import { ExportButton } from '@/components/admin/export-button';
import { PageHeader } from '@/components/admin/page-header';
import { PeriodPicker } from '@/components/admin/period-picker';
import { LinkButton } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { cx } from '@/lib/cx';
import { formatDateOnly } from '@/lib/dates/date-only';
import { humanize } from '@/lib/admin/format';
import { getPeriod } from '@/lib/admin/period';
import { oneOf, pageMeta, parseListParams, withParams, type RawSearchParams } from '@/lib/admin/search-params';
import { PRIORITIES, TASK_STATUSES } from '@/config/statuses';
import { parseTaskFilter, TASK_SORT_KEYS } from '@/lib/validation/task';
import { getTasksDashboard } from '@/services/dashboards/tasks';
import { getBoard, getProjectLabel, searchTasks, type TaskSort } from '@/services/task.service';
import { TaskBoard } from './_components/task-board';
import { TaskFilters } from './_components/task-filters';
import { TaskList } from './_components/task-list';
import { TasksDashboardBand } from './_components/tasks-dashboard';

export const metadata: Metadata = { title: 'Tasks' };

const VIEWS = ['list', 'board'] as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage('/admin/tasks', { capability: 'task:view' });
  const sp = await searchParams;
  const period = await getPeriod(sp);
  const view = oneOf(sp, 'view', VIEWS) ?? 'list';
  const filter = parseTaskFilter(sp, { viewerId: viewer.id });
  const list = parseListParams(sp, { sortable: TASK_SORT_KEYS, defaultSort: 'updatedAt' });
  const canEdit = viewer.capabilities.has('task:edit');
  const canExport = viewer.capabilities.has('export:data');

  const [dashboard, project, board, page] = await Promise.all([
    // The same project and client filters narrow the tiles and the table together.
    getTasksDashboard(viewer, period, { projectId: filter.projectId, clientId: filter.clientId }),
    filter.projectId ? getProjectLabel(viewer, filter.projectId) : null,
    view === 'board' ? getBoard(viewer, { q: filter.q, priority: filter.priority, projectId: filter.projectId, clientId: filter.clientId, assignee: filter.assignee }) : null,
    view === 'list' ? searchTasks(viewer, { ...filter, sort: list.sort as TaskSort, dir: list.dir, page: list.page, pageSize: list.pageSize }) : null,
  ]);
  const filtered = Boolean(filter.q || filter.status || filter.priority || filter.projectId || filter.clientId || filter.assignee || filter.overdue);

  return (
    <>
      <PageHeader
        title="Tasks"
        description={`Work by project, with the time logged against it. ${dashboard.period.label}.`}
        actions={
          canEdit || canExport ? (
            <>
              <ExportButton section="tasks" params={sp} canExport={canExport} />
              {canEdit ? <LinkButton href="/admin/tasks/new" variant="primary"><Plus className="size-4" aria-hidden /> New task</LinkButton> : null}
            </>
          ) : undefined
        }
      />

      <TasksDashboardBand data={dashboard} sp={sp} />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-pd-serif text-[20px] leading-7 font-semibold text-pd-ink">{view === 'board' ? 'Board' : 'All tasks'}</h2>
        <nav aria-label="View" className="inline-flex rounded-pd-sm bg-pd-well p-0.5 text-[13px] font-medium">
          {VIEWS.map((v) => (
            <Link
              key={v}
              href={withParams('/admin/tasks', sp, { view: v === 'list' ? undefined : v })}
              prefetch={false}
              aria-current={view === v ? 'page' : undefined}
              className={cx('inline-flex h-7 items-center rounded-[3px] px-3 capitalize pointer-coarse:h-9', view === v ? 'bg-pd-sheet text-pd-ink shadow-[0_0_0_1px_var(--color-pd-rule)]' : 'text-pd-ink-3 hover:text-pd-ink')}
            >
              {v}
            </Link>
          ))}
        </nav>
      </div>

      <DataToolbar
        searchPlaceholder="Search title or reference"
        filters={[
          ...(view === 'list' ? [{ key: 'status', label: 'Status', allLabel: 'Any status', options: [{ value: 'open', label: 'Open' }, ...TASK_STATUSES.map((s) => ({ value: s, label: humanize(s) }))] }] : []),
          { key: 'priority', label: 'Priority', allLabel: 'Any priority', options: PRIORITIES.map((p) => ({ value: p, label: humanize(p) })) },
        ]}
      >
        <TaskFilters project={project} />
        <PeriodPicker current={period.key} from={period.key === 'custom' ? formatDateOnly(period.from) : undefined} to={period.key === 'custom' ? formatDateOnly(period.to) : undefined} />
      </DataToolbar>

      {board ? <TaskBoard columns={board} sp={sp} canEdit={canEdit} projectScoped={Boolean(filter.projectId)} /> : null}
      {page ? (
        <>
          <TaskList items={page.items} sp={sp} sort={list.sort} dir={list.dir} filtered={filtered} canCreate={canEdit} />
          <Pagination meta={pageMeta(page.page, page.pageSize, page.total)} path="/admin/tasks" params={sp} noun="tasks" />
        </>
      ) : null}
    </>
  );
}
