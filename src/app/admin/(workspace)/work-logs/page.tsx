import type { Metadata } from 'next';
import { ExportButton } from '@/components/admin/export-button';
import { PageHeader } from '@/components/admin/page-header';
import { PeriodPicker } from '@/components/admin/period-picker';
import { StatBand } from '@/components/admin/stat-band';
import { Pagination } from '@/components/ui/pagination';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { formatCount, formatHours, formatPercent } from '@/lib/admin/format';
import { getPeriod } from '@/lib/admin/period';
import { pageMeta, parseListParams, type RawSearchParams } from '@/lib/admin/search-params';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { parseWorkLogFilter } from '@/lib/validation/work-log';
import { getSettings } from '@/services/settings.service';
import { getFilterLabels, listWorkLogs } from '@/services/work-log.service';
import { WorkLogFilters } from './_components/work-log-filters';
import { WorkLogTable } from './_components/work-log-table';

export const metadata: Metadata = { title: 'Work logs' };

const PAGE_SIZE = 25;

export default async function WorkLogsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage('/admin/work-logs', { capability: 'worklog:viewAll' });
  const sp = await searchParams;
  const canExport = viewer.capabilities.has('export:data');
  const period = await getPeriod(sp);
  const settings = await getSettings();
  const { page } = parseListParams(sp, { sortable: [], defaultSort: 'workedOn' });
  const { adminId, projectId, billable } = parseWorkLogFilter(sp);
  const rest = { adminId, projectId, billable };
  // The period decides the dates (it has already validated any custom range).
  const from = formatDateOnly(period.from);
  const to = formatDateOnly(period.to);

  const [data, labels] = await Promise.all([
    listWorkLogs(viewer, { ...rest, from, to, page, pageSize: PAGE_SIZE }),
    getFilterLabels(viewer, { adminId: rest.adminId, projectId: rest.projectId }),
  ]);
  const meta = pageMeta(page, PAGE_SIZE, data.total);
  const share = formatPercent(data.totals.billableMinutes, data.totals.minutes);
  const today = formatDateOnly(todayDateOnly(new Date(), settings.timezone));
  const filtered = Boolean(rest.adminId || rest.projectId || rest.billable !== undefined);

  return (
    <>
      <PageHeader
        title="Work logs"
        description="Everyone's logged time. Open a task to log or correct time against it."
        actions={canExport ? <ExportButton section="work-logs" params={sp} canExport={canExport} /> : undefined}
      />

      <StatBand
        stats={[
          { label: 'Hours logged', value: formatHours(data.totals.minutes), sub: period.label },
          { label: 'Billable', value: formatHours(data.totals.billableMinutes), sub: share ? `${share} of hours` : undefined },
          { label: 'Entries', value: formatCount(data.totals.entries) },
          { label: 'People logging', value: formatCount(data.totals.people) },
        ]}
        className="mb-6"
      />

      <div className="mb-4 flex flex-col gap-3">
        <WorkLogFilters
          person={labels.person ? { id: labels.person.id, label: labels.person.label } : null}
          project={labels.project ? { id: labels.project.id, label: labels.project.label, ref: labels.project.ref } : null}
        />
        <PeriodPicker current={period.key} from={period.key === 'custom' ? from : undefined} to={period.key === 'custom' ? to : undefined} />
      </div>

      <WorkLogTable
        logs={data.items}
        today={today}
        showPerson
        showTask
        caption="Logged time"
        total={data.total > 0 ? { label: `Total, ${formatCount(data.totals.entries)} ${data.totals.entries === 1 ? 'entry' : 'entries'}`, minutes: data.totals.minutes } : undefined}
        emptyTitle={filtered ? 'No time matches these filters' : 'No time logged in this period'}
        emptyBody={filtered ? 'Try a different person or project, or clear the filters.' : 'Time shows here once someone logs it against a task.'}
      />
      <Pagination meta={meta} path="/admin/work-logs" params={sp} noun="entries" />
    </>
  );
}
