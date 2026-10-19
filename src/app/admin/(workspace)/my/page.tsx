import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { PeriodPicker } from '@/components/admin/period-picker';
import { PersonDashboardView } from '@/components/admin/person-dashboard';
import { LinkButton } from '@/components/ui/button';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { getPeriod } from '@/lib/admin/period';
import type { RawSearchParams } from '@/lib/admin/search-params';
import { getPersonDashboard } from '@/services/dashboards/person';
import { getSettings } from '@/services/settings.service';
import { listMyTasks } from '@/services/task.service';
import { listMyRecentWorkLogs } from '@/services/work-log.service';
import { WorkLogTable } from '../work-logs/_components/work-log-table';
import { MyVisit } from './_components/my-visit';
import { MyWork } from './_components/my-work';
import { readMyVisit } from './_lib/read-visit';

export const metadata: Metadata = { title: 'My work' };

/** The signed-in person's own tasks, time and numbers. Any signed-in admin may open it: it only ever shows their own records. */
export default async function MyWorkPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage('/admin/my');
  const sp = await searchParams;
  const period = await getPeriod(sp);
  const settings = await getSettings();
  const since = await readMyVisit(viewer.id);
  const caps = viewer.capabilities;
  const canLog = caps.has('worklog:own');
  const today = formatDateOnly(todayDateOnly(new Date(), settings.timezone));
  // When this page was built: the cookie records exactly what this visit showed, so a task assigned a moment later still counts as new next time.
  const renderedAt = new Date().getTime();

  const [mine, recent, dashboard] = await Promise.all([
    caps.has('task:view') ? listMyTasks(viewer, { since }) : { tasks: [], newCount: 0 },
    canLog ? listMyRecentWorkLogs(viewer, 10) : [],
    getPersonDashboard(viewer, viewer.id, period),
  ]);

  return (
    <>
      <MyVisit adminId={viewer.id} renderedAt={renderedAt} />
      <PageHeader
        title="My work"
        description="Your tasks, your time and your numbers."
        actions={
          // The person page opens for its own person with team:view (every admin has it), on the Pay tab for what they are paid.
          caps.has('team:view') ? <LinkButton href={`/admin/team/${viewer.id}?tab=pay`} variant="secondary">My payouts</LinkButton> : undefined
        }
      />

      <div className="mb-8">
        <MyWork tasks={mine.tasks} newCount={mine.newCount} today={today} canLog={canLog} />
      </div>

      {canLog ? (
        <Panel flush className="mb-8 p-5">
          <PanelHeader title="My recent time" hint="Your latest 10 entries. You can change your own for a while after logging them." />
          <WorkLogTable
            logs={recent}
            today={today}
            showTask
            caption="My recent time entries"
            emptyTitle="No time logged yet"
            emptyBody="Log what you worked on above."
          />
        </Panel>
      ) : null}

      <section aria-labelledby="my-numbers">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="my-numbers" className="font-pd-serif text-[20px] leading-7 font-semibold text-pd-ink">My numbers</h2>
          <PeriodPicker current={period.key} from={period.key === 'custom' ? formatDateOnly(period.from) : undefined} to={period.key === 'custom' ? formatDateOnly(period.to) : undefined} />
        </div>
        <PersonDashboardView data={dashboard} isSelf tasksHref={caps.has('task:view') ? '/admin/tasks?assignee=me' : undefined} />
      </section>
    </>
  );
}
