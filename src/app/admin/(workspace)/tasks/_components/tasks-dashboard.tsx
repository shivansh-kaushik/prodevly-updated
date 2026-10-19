import { ChartCard } from '@/components/admin/chart-card';
import { formatCycleTime, formatWeek } from '@/components/admin/person-dashboard';
import { StatBand } from '@/components/admin/stat-band';
import { CHART_COLORS, SERIES_PALETTE } from '@/lib/admin/chart-colors';
import { formatCount, formatHours, formatPercent } from '@/lib/admin/format';
import { withParams, type RawSearchParams } from '@/lib/admin/search-params';
import type { TasksDashboard } from '@/services/dashboards/tasks';

const short = (name: string, max = 14) => (name.length > max ? `${name.slice(0, max - 1)}…` : name);

/** Chart axis labels must be unique (they key the table view), so a second "Asha" becomes "Asha (2)". */
function uniqueLabels(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const count = (seen.get(n) ?? 0) + 1;
    seen.set(n, count);
    return count === 1 ? n : `${n} (${count})`;
  });
}

/** The band above the task list: totals, then the charts. Every number was computed from records by `getTasksDashboard`. */
export function TasksDashboardBand({ data, sp }: { data: TasksDashboard; sp: RawSearchParams }) {
  const list = (overrides: Record<string, string | undefined>) => withParams('/admin/tasks', sp, { view: 'list', status: undefined, overdue: undefined, assignee: undefined, ...overrides });
  const share = formatPercent(data.hours.billableMinutes, data.hours.minutes);
  const own = data.hours.scope === 'own';

  const assigneeNames = uniqueLabels(data.openPerAssignee.map((a) => short(a.name)));
  const people = uniqueLabels(data.hoursPerWeek.people.map((p) => short(p.name, 16)));

  return (
    <div className="mb-8 flex flex-col gap-6">
      <StatBand
        stats={[
          { label: 'Open tasks', value: formatCount(data.openTotal), sub: `${formatCount(data.openByStatus.in_progress)} in progress`, href: list({ status: 'open' }) },
          { label: 'Overdue', value: formatCount(data.overdue), attention: data.overdue > 0, href: list({ overdue: '1' }) },
          { label: 'Unassigned', value: formatCount(data.unassigned), href: list({ status: 'open', assignee: 'unassigned' }) },
          { label: 'Blocked', value: formatCount(data.blocked), attention: data.blocked > 0, href: list({ status: 'blocked' }) },
          { label: 'Completed', value: formatCount(data.completedInPeriod), sub: data.period.label, href: list({ status: 'done' }) },
          {
            label: 'Median cycle time',
            value: data.medianCycleMs !== null ? formatCycleTime(data.medianCycleMs) : '–',
            sub: data.medianCycleMs !== null ? `First in progress to done, ${data.cycleSampleSize} ${data.cycleSampleSize === 1 ? 'task' : 'tasks'}` : 'No finished tasks that were started',
          },
          { label: own ? 'My hours logged' : 'Hours logged', value: formatHours(data.hours.minutes), sub: own ? `${data.period.label}, your time only` : data.period.label },
          ...(share ? [{ label: 'Billable share', value: share, sub: `${formatHours(data.hours.billableMinutes)} billable` }] : []),
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Tasks completed per week"
          hint="Last 12 weeks, weeks start on Monday"
          type="bar"
          data={data.completedPerWeek.map((w) => ({ week: formatWeek(w.weekStart), completed: w.completed }))}
          xKey="week"
          xLabel="Week of"
          series={[{ key: 'completed', label: 'Completed', color: CHART_COLORS.credit }]}
          kind="count"
          totals
          height={220}
          emptyBody="No tasks were completed in the last 12 weeks."
        />
        <ChartCard
          title="Open tasks per assignee"
          hint="By status. A task with two people counts for both."
          type="bar"
          data={data.openPerAssignee.map((a, i) => ({ name: assigneeNames[i] ?? a.name, backlog: a.backlog, todo: a.todo, in_progress: a.in_progress, in_review: a.in_review, blocked: a.blocked }))}
          xKey="name"
          xLabel="Assignee"
          series={[
            { key: 'backlog', label: 'Backlog', color: CHART_COLORS.slate, stackId: 's' },
            { key: 'todo', label: 'Todo', color: CHART_COLORS.blue, stackId: 's' },
            { key: 'in_progress', label: 'In progress', color: CHART_COLORS.violet, stackId: 's' },
            { key: 'in_review', label: 'In review', color: CHART_COLORS.amber, stackId: 's' },
            { key: 'blocked', label: 'Blocked', color: CHART_COLORS.rubric, stackId: 's' },
          ]}
          kind="count"
          totals
          height={220}
          emptyBody="There are no open tasks."
        />
        <ChartCard
          title={own ? 'My hours per week' : 'Hours per person per week'}
          hint="Last 12 weeks"
          type="bar"
          data={data.hoursPerWeek.weeks.map((w, i) => ({ week: formatWeek(w), ...Object.fromEntries(data.hoursPerWeek.people.map((p, j) => [`p${j}`, p.minutes[i] ?? 0])) }))}
          xKey="week"
          xLabel="Week of"
          series={data.hoursPerWeek.people.map((_, j) => ({ key: `p${j}`, label: people[j] ?? '', color: SERIES_PALETTE[j % SERIES_PALETTE.length], stackId: 'h' }))}
          kind="minutes"
          totals
          height={240}
          emptyBody="No time was logged in the last 12 weeks."
        />
        <ChartCard
          title="Hours by project"
          hint={data.period.label}
          type="ranked"
          data={data.hoursByProject.map((p) => ({ project: short(p.name, 24), minutes: p.minutes }))}
          xKey="project"
          xLabel="Project"
          series={[{ key: 'minutes', label: 'Time logged', color: CHART_COLORS.blue }]}
          kind="minutes"
          totals
          emptyBody="No time was logged in this period."
        />
        {data.estimateVsLogged ? (
          <ChartCard
            className="lg:col-span-2"
            title="Estimate against logged"
            hint={`Tasks completed in ${data.period.label}, biggest logged time first`}
            type="bar"
            data={data.estimateVsLogged.map((t) => ({ task: t.ref, estimate: t.estimateMinutes, logged: t.loggedMinutes }))}
            xKey="task"
            xLabel="Task"
            series={[
              { key: 'estimate', label: 'Estimated', color: CHART_COLORS.slate },
              { key: 'logged', label: 'Logged', color: CHART_COLORS.blue },
            ]}
            kind="minutes"
            height={240}
            emptyBody="No tasks with an estimate were completed in this period."
          />
        ) : null}
      </div>
    </div>
  );
}
