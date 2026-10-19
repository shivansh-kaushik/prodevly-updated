import { ChartCard } from '@/components/admin/chart-card';
import { ShareBar } from '@/components/admin/share-bar';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { CHART_COLORS } from '@/lib/admin/chart-colors';
import { formatCount, humanize } from '@/lib/admin/format';
import type { ProjectsDashboard } from '@/services/dashboards/projects';
import { STATUS_COLORS, typeLabel } from './labels';

export function StatusPanel({ dashboard: d }: { dashboard: ProjectsDashboard }) {
  return (
    <Panel>
      <PanelHeader title="Projects by status" hint={`${formatCount(d.total)} not archived`} />
      {d.total === 0 ? (
        <EmptyState title="No projects yet" body="Projects appear here by status as you add them." className="py-10" />
      ) : (
        <ShareBar parts={d.byStatus.map((s) => ({ label: humanize(s.status), value: s.count, color: STATUS_COLORS[s.status] }))} />
      )}
    </Panel>
  );
}

export function StartedDeliveredChart({ dashboard: d, periodLabel }: { dashboard: ProjectsDashboard; periodLabel: string }) {
  return (
    <ChartCard
      title="Started and delivered"
      hint={`Per month, ${periodLabel.toLowerCase()}`}
      type="bar"
      data={d.startedVsDelivered.map((m) => ({ month: m.label, started: m.started, delivered: m.delivered }))}
      xKey="month"
      xLabel="Month"
      series={[
        { key: 'started', label: 'Started', color: CHART_COLORS.blue },
        { key: 'delivered', label: 'Delivered', color: CHART_COLORS.credit },
      ]}
      kind="count"
      totals
      height={240}
      emptyBody="No project started or was delivered in this period."
    />
  );
}

export function TypeChart({ dashboard: d }: { dashboard: ProjectsDashboard }) {
  return (
    <ChartCard
      title="Projects by type"
      hint="Not archived"
      type="ranked"
      data={d.byType.map((t) => ({ type: typeLabel(t.type), count: t.count }))}
      xKey="type"
      xLabel="Type"
      series={[{ key: 'count', label: 'Projects', color: CHART_COLORS.blue }]}
      kind="count"
      totals
      emptyBody="No projects yet."
    />
  );
}
