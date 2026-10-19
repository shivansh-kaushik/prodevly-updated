import { Panel, PanelHeader } from '@/components/ui/panel';
import { formatCount, formatDateTime, formatDuration, formatHours, formatInr } from '@/lib/admin/format';
import type { PersonDashboard } from '@/services/dashboards/person';
import { AuditFeed } from './audit-feed';
import { ChartCard } from './chart-card';
import { formatNative } from './money';
import { StatBand, type Stat } from './stat-band';

/**
 * One person's dashboard, as plain props (no server imports, so it renders on My work and on a
 * team member's page alike). The service decides what the viewer may see: `data.pay` is null when
 * they may not see pay, and this component then simply leaves that section out.
 */
const DAY_MS = 86_400_000;

/** Cycle time as people say it: "6 h", "2.5 days". */
export function formatCycleTime(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 24) return `${Math.max(1, Math.round(hours))} h`;
  const days = Math.round((ms / DAY_MS) * 10) / 10;
  return `${days.toLocaleString('en-IN')} ${days === 1 ? 'day' : 'days'}`;
}

/** "2026-10-05" (a Monday) as "5 Oct" for a chart axis. */
export function formatWeek(weekStart: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${weekStart}T00:00:00Z`));
}

const trim = (name: string, max = 22) => (name.length > max ? `${name.slice(0, max - 1)}…` : name);

export function PersonDashboardView({ data, isSelf = false, tasksHref }: { data: PersonDashboard; isSelf?: boolean; tasksHref?: string }) {
  const { hours, tasks, pay } = data;
  const billableShare = hours.periodMinutes > 0 ? Math.round((hours.periodBillableMinutes / hours.periodMinutes) * 100) : null;

  const stats: Stat[] = [
    { label: 'Hours this week', value: formatHours(hours.thisWeekMinutes), sub: hours.thisWeekMinutes > 0 ? formatDuration(hours.thisWeekMinutes) : 'Nothing logged yet' },
    { label: 'Hours this month', value: formatHours(hours.thisMonthMinutes) },
    { label: `Hours, ${data.period.label}`, value: formatHours(hours.periodMinutes), sub: billableShare !== null ? `${billableShare}% billable` : undefined },
    { label: 'Open tasks', value: formatCount(tasks.open), href: tasksHref ? `${tasksHref}&status=open` : undefined },
    { label: 'Overdue', value: formatCount(tasks.overdue), attention: tasks.overdue > 0, href: tasksHref ? `${tasksHref}&overdue=1` : undefined },
    { label: 'Completed', value: formatCount(tasks.completedInPeriod), sub: data.period.label },
    ...(tasks.onTimePercent !== null ? [{ label: 'Completed on time', value: `${tasks.onTimePercent}%`, sub: `${tasks.onTime} of ${tasks.withDueDate} with a due date` }] : []),
    {
      label: 'Median cycle time',
      value: tasks.medianCycleMs !== null ? formatCycleTime(tasks.medianCycleMs) : '–',
      sub: tasks.medianCycleMs !== null ? `Started to done, ${tasks.cycleSampleSize} ${tasks.cycleSampleSize === 1 ? 'task' : 'tasks'}` : 'No finished tasks that were started',
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <StatBand stats={stats} />

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Hours per week"
          hint="Last 12 weeks, weeks start on Monday"
          type="bar"
          data={data.hoursPerWeek.map((w) => ({ week: formatWeek(w.weekStart), minutes: w.minutes }))}
          xKey="week"
          xLabel="Week of"
          series={[{ key: 'minutes', label: 'Time logged', color: '#2d4b8e' }]}
          kind="minutes"
          totals
          height={220}
          emptyBody="No time logged in the last 12 weeks."
        />
        <ChartCard
          title="Hours by project"
          hint={data.period.label}
          type="ranked"
          data={data.hoursByProject.map((p) => ({ project: trim(p.name), minutes: p.minutes }))}
          xKey="project"
          xLabel="Project"
          series={[{ key: 'minutes', label: 'Time logged', color: '#1d6b49' }]}
          kind="minutes"
          totals
          emptyBody="No time logged in this period."
        />
      </div>

      {pay ? (
        <Panel>
          <PanelHeader title={isSelf ? 'My payouts' : 'Payouts'} hint="Team payouts and out-of-pocket reimbursements" />
          <StatBand
            stats={[
              {
                label: `Paid, ${data.period.label}`,
                value: formatInr(pay.paidInPeriodInrMinor),
                sub:
                  pay.paidInPeriodNative.filter((p) => p.currency !== 'INR').length > 0
                    ? pay.paidInPeriodNative.filter((p) => p.currency !== 'INR').map((p) => `${formatNative(p.amountMinor, p.currency)} (${formatInr(p.inrMinor)})`).join(', ')
                    : pay.paidInPeriodCount > 0
                      ? `${pay.paidInPeriodCount} ${pay.paidInPeriodCount === 1 ? 'payout' : 'payouts'}`
                      : 'Nothing paid in this period',
              },
              { label: 'Payouts due', value: formatInr(pay.dueInrMinor), sub: pay.dueCount > 0 ? `${pay.dueCount} ${pay.dueCount === 1 ? 'payout' : 'payouts'} waiting to be paid` : 'Nothing due' },
              {
                label: 'Reimbursements waiting',
                value: formatInr(pay.reimbursements.owedInrMinor),
                sub:
                  pay.reimbursements.awaitingApprovalCount > 0
                    ? `${pay.reimbursements.awaitingApprovalCount} awaiting approval (${formatInr(pay.reimbursements.awaitingApprovalInrMinor)})`
                    : pay.reimbursements.owedCount > 0
                      ? `${pay.reimbursements.owedCount} approved, not yet paid back`
                      : 'Nothing waiting',
              },
            ]}
          />
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader
          title="Recent activity"
          hint={data.person.lastLoginAt ? `Last signed in ${formatDateTime(data.person.lastLoginAt)}` : 'Has not signed in yet'}
        />
        <AuditFeed entries={data.recentActivity} emptyTitle="No activity yet" />
      </Panel>
    </div>
  );
}
