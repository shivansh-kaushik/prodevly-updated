import Link from 'next/link';
import { ChartCard } from '@/components/admin/chart-card';
import { StatBand, type Stat } from '@/components/admin/stat-band';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { CHART_COLORS } from '@/lib/admin/chart-colors';
import { formatCount, formatHours, formatInr } from '@/lib/admin/format';
import { withParams, type RawSearchParams } from '@/lib/admin/search-params';
import { formatMinor } from '@/lib/money/minor';
import type { Period } from '@/lib/dates/ranges';
import type { TeamDashboard } from '@/services/dashboards/team';

const monthFormat = new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const monthLabel = (month: string) => monthFormat.format(new Date(`${month}-01T00:00:00Z`));

/** "2.2%" under ten, "58%" above: a percent a person can read at a glance. */
const percentText = (p: number) => `${Number(p.toFixed(p < 10 ? 1 : 0))}%`;

/**
 * The band above the directory: tiles, members by job role and the charts. Payout tiles and charts exist only
 * when the dashboard carries payouts, which the service leaves out for anyone without `team:payView` (they are
 * omitted here, never drawn as zero).
 */
export function TeamDashboardBand({ dashboard, period, sp }: { dashboard: TeamDashboard; period: Period; sp: RawSearchParams }) {
  const { utilisation, payouts } = dashboard;

  const stats: Stat[] = [
    {
      label: 'Active people',
      value: formatCount(dashboard.activeMembers),
      sub: dashboard.removedMembers > 0 ? `${formatCount(dashboard.removedMembers)} removed` : undefined,
    },
    { label: 'Hours logged', value: formatHours(dashboard.loggedMinutes), sub: period.label },
    {
      label: 'Utilisation',
      value: utilisation.percent === null ? '–' : percentText(utilisation.percent),
      sub:
        utilisation.members === 0
          ? 'No one has a weekly capacity set'
          : utilisation.percent === null
            ? 'This period has not started'
            : `${formatCount(utilisation.members)} ${utilisation.members === 1 ? 'person has' : 'people have'} a weekly capacity`,
    },
  ];
  if (payouts) {
    stats.push(
      {
        label: 'Paid to the team',
        value: formatInr(payouts.paidInrMinor),
        sub:
          payouts.paidNative.length > 0
            ? payouts.paidNative.map((n) => `${formatMinor(n.amountMinor, n.currency)} (${formatInr(n.inrMinor)})`).join(' · ')
            : `${formatCount(payouts.paidCount)} ${payouts.paidCount === 1 ? 'payout' : 'payouts'}`,
      },
      {
        label: 'Due to the team',
        value: formatInr(payouts.dueInrMinor),
        sub: `${formatCount(payouts.dueCount)} open${payouts.overdueCount > 0 ? `, ${formatCount(payouts.overdueCount)} overdue` : ''}`,
        attention: payouts.overdueCount > 0,
      },
    );
  }

  const topRole = Math.max(1, ...dashboard.membersByRole.map((r) => r.count));

  return (
    <>
      <StatBand stats={stats} className="mb-6" />
      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="People by job role" hint="Active people. Pick one to filter the directory." />
          {dashboard.membersByRole.length === 0 ? (
            <EmptyState title="No people yet" body="Accounts appear here once they are created." className="py-8" />
          ) : (
            <ul className="flex flex-col">
              {dashboard.membersByRole.map((r) => (
                <li key={r.id ?? 'none'} className="border-b border-pd-rule-soft last:border-b-0">
                  <Link
                    href={withParams('/admin/team', sp, { jobRole: r.id ?? 'none' })}
                    prefetch={false}
                    className="flex min-h-10 items-center gap-3 py-2 text-[14px] hover:bg-pd-well/60 pointer-coarse:min-h-11"
                  >
                    <span className="min-w-0 flex-1 truncate text-pd-ink">
                      {r.name}
                      {r.archived ? <Badge className="ml-2">Archived</Badge> : null}
                    </span>
                    <span aria-hidden className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-pd-well sm:block">
                      <span className="block h-full rounded-full bg-pd-blue" style={{ width: `${Math.max(6, (r.count / topRole) * 100)}%` }} />
                    </span>
                    <span className="pd-figure w-8 text-right font-medium text-pd-ink">{formatCount(r.count)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <ChartCard
          title="Hours by person"
          hint={period.label}
          type="ranked"
          data={dashboard.hoursByPerson.map((p) => ({ name: p.name, minutes: p.minutes }))}
          xKey="name"
          xLabel="Person"
          series={[{ key: 'minutes', label: 'Hours logged', color: CHART_COLORS.blue }]}
          kind="minutes"
          totals
          emptyBody="No work was logged in this period."
        />

        <ChartCard
          title="Open tasks by person"
          hint="Right now, whatever the period"
          type="ranked"
          data={dashboard.openTasksByPerson.map((p) => ({ name: p.removed ? `${p.name} (removed)` : p.name, open: p.open, overdue: p.overdue }))}
          xKey="name"
          xLabel="Person"
          series={[
            { key: 'open', label: 'Open tasks', color: CHART_COLORS.blue },
            { key: 'overdue', label: 'Overdue', color: CHART_COLORS.rubric },
          ]}
          kind="count"
          emptyBody="No open tasks are assigned to anyone."
        />

        {payouts ? (
          <>
            <ChartCard
              title="Paid by person"
              hint={period.label}
              type="ranked"
              data={payouts.byPerson.map((p) => ({ name: p.name, inr: p.inrMinor }))}
              xKey="name"
              xLabel="Person"
              series={[{ key: 'inr', label: 'Paid (INR)', color: CHART_COLORS.credit }]}
              kind="inr"
              totals
              emptyBody="No team payouts were paid in this period."
            />
            <ChartCard
              title="Paid per month"
              hint={period.label}
              type="bar"
              data={payouts.byMonth.map((m) => ({ month: monthLabel(m.month), inr: m.inrMinor }))}
              xKey="month"
              xLabel="Month"
              series={[{ key: 'inr', label: 'Paid (INR)', color: CHART_COLORS.credit }]}
              kind="inr"
              totals
              emptyBody="No team payouts were paid in this period."
            />
          </>
        ) : null}
      </div>
    </>
  );
}
