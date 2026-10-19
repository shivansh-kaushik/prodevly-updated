import { ChartCard } from '@/components/admin/chart-card';
import type { Row, Series } from '@/components/admin/charts';
import { ShareBar } from '@/components/admin/share-bar';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { CHART_COLORS } from '@/lib/admin/chart-colors';
import { formatCount, humanize } from '@/lib/admin/format';
import type { CashFlow, OverviewDashboard } from '@/services/dashboards/overview';
import { STATUS_COLORS } from '../../projects/_components/labels';

type PeriodInfo = OverviewDashboard['period'];

/**
 * Cash in against cash out for every month of the period. Cash in is its own column; cash out is one stacked
 * column (third parties, expenses, team). A series the viewer may not see is left out of the data AND the
 * series list, so it cannot appear in the chart, the tooltip or the table view.
 */
export function CashFlowChart({ cashFlow, period }: { cashFlow: CashFlow; period: PeriodInfo }) {
  const { series: allowed } = cashFlow;
  const series: Series[] = [];
  // Cash in has no stack of its own: it is the one column beside the stacked cash out.
  if (allowed.cashIn) series.push({ key: 'cashIn', label: 'Cash in', color: CHART_COLORS.credit });
  if (allowed.thirdParties) series.push({ key: 'thirdParties', label: 'Third parties', color: CHART_COLORS.blue, stackId: 'out' });
  if (allowed.expenses) series.push({ key: 'expenses', label: 'Expenses', color: CHART_COLORS.amber, stackId: 'out' });
  if (allowed.team) series.push({ key: 'team', label: 'Team', color: CHART_COLORS.violet, stackId: 'out' });

  const data: Row[] = cashFlow.months.map((m) => {
    const row: Row = { month: m.label };
    if (m.cashInInr !== null) row.cashIn = m.cashInInr;
    if (m.thirdPartyInr !== null) row.thirdParties = m.thirdPartyInr;
    if (m.expenseInr !== null) row.expenses = m.expenseInr;
    if (m.teamInr !== null) row.team = m.teamInr;
    return row;
  });

  const hasOut = allowed.thirdParties || allowed.expenses || allowed.team;
  const title = allowed.cashIn && hasOut ? 'Cash in and out' : allowed.cashIn ? 'Cash in' : 'Cash out';
  // A stack needs its parts named: the legend is the tooltip and the table, so the hint says which parts there are.
  const outParts = [allowed.thirdParties && 'third parties', allowed.expenses && 'expenses', allowed.team && 'team'].filter((p): p is string => Boolean(p));
  const hint = `${period.label}, INR${outParts.length > 1 ? `, cash out stacked: ${outParts.join(', ')}` : ''}`;

  return (
    <ChartCard
      title={title}
      hint={hint}
      type="bar"
      data={data}
      xKey="month"
      xLabel="Month"
      series={series}
      kind="inr"
      totals
      height={260}
      emptyBody="No money moved in this period."
    />
  );
}

/** The chart cannot draw a net line over stacked columns, so the net is its own small chart (it can go below zero). */
export function NetChart({ cashFlow, period }: { cashFlow: CashFlow; period: PeriodInfo }) {
  return (
    <ChartCard
      title="Company net per month"
      hint={`${period.label}, INR. Below zero means more went out than came in.`}
      type="bar"
      data={cashFlow.months.map((m) => ({ month: m.label, net: m.netInr ?? 0 }))}
      xKey="month"
      xLabel="Month"
      series={[{ key: 'net', label: 'Company net', color: CHART_COLORS.blue }]}
      kind="inr"
      totals
      height={220}
      emptyBody="No money moved in this period."
    />
  );
}

export function StatusPanel({ projects }: { projects: NonNullable<OverviewDashboard['projects']> }) {
  return (
    <Panel>
      <PanelHeader title="Projects by status" hint={`${formatCount(projects.total)} not archived`} />
      {projects.total === 0 ? (
        <EmptyState title="No projects yet" body="Projects appear here by status as you add them." className="py-10" />
      ) : (
        <ShareBar parts={projects.byStatus.map((s) => ({ label: humanize(s.status), value: s.count, color: STATUS_COLORS[s.status] }))} />
      )}
    </Panel>
  );
}
