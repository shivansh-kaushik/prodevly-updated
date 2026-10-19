import { ChartCard } from '@/components/admin/chart-card';
import { ShareBar } from '@/components/admin/share-bar';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { CHART_COLORS } from '@/lib/admin/chart-colors';
import { formatCount, humanize } from '@/lib/admin/format';
import type { ThirdPartiesDashboard, ThirdPartiesMoney } from '@/services/dashboards/third-parties';
import { short, uniqueLabels } from './labels';

/** The four charts. Money only: the caller passes them for viewers with payout:view. */
export function PayoutCharts({ money, periodLabel }: { money: ThirdPartiesMoney; periodLabel: string }) {
  const partyNames = uniqueLabels(money.byThirdParty.map((p) => short(p.name, 22)));
  const projectNames = uniqueLabels(money.byProject.map((p) => short(p.name, 22)));
  return (
    <div className="mb-8 grid gap-6 lg:grid-cols-2">
      <ChartCard
        title="Paid per month"
        hint={`By paid date, ${periodLabel.toLowerCase()}`}
        type="bar"
        data={money.perMonth.map((m) => ({ month: m.label, paid: m.paidInr }))}
        xKey="month"
        xLabel="Month"
        series={[{ key: 'paid', label: 'Paid', color: CHART_COLORS.credit }]}
        kind="inr"
        totals
        height={240}
        emptyBody="No payout was marked paid in this period."
      />
      <ChartCard
        title="Paid by third party"
        hint={`Top 10, ${periodLabel.toLowerCase()}`}
        type="ranked"
        data={money.byThirdParty.map((p, i) => ({ name: partyNames[i] ?? p.name, paid: p.paidInr }))}
        xKey="name"
        xLabel="Third party"
        series={[{ key: 'paid', label: 'Paid', color: CHART_COLORS.blue }]}
        kind="inr"
        totals
        emptyBody="No payout was marked paid in this period."
      />
      <ChartCard
        title="Paid by project"
        hint={`Top 10, ${periodLabel.toLowerCase()}`}
        type="ranked"
        data={money.byProject.map((p, i) => ({ name: projectNames[i] ?? p.name, paid: p.paidInr }))}
        xKey="name"
        xLabel="Project"
        series={[{ key: 'paid', label: 'Paid', color: CHART_COLORS.violet }]}
        kind="inr"
        totals
        emptyBody="No payout was marked paid in this period."
      />
      <ChartCard
        title="Paid by third-party type"
        hint={periodLabel}
        type="ranked"
        data={money.byType.map((t) => ({ name: humanize(t.type), paid: t.paidInr }))}
        xKey="name"
        xLabel="Type"
        series={[{ key: 'paid', label: 'Paid', color: CHART_COLORS.amber }]}
        kind="inr"
        totals
        emptyBody="No payout was marked paid in this period."
      />
    </div>
  );
}

/** For viewers who may read the directory but not the money: who is active, by type. */
export function TypePanel({ dashboard: d }: { dashboard: ThirdPartiesDashboard }) {
  return (
    <Panel className="mb-8">
      <PanelHeader title="Third parties by type" hint={`${formatCount(d.activeThirdParties)} active`} />
      {d.activeThirdParties === 0 ? (
        <EmptyState title="No third parties yet" body="Freelancers, agencies and vendors appear here once they are added." className="py-8" />
      ) : (
        <ShareBar parts={d.typeCounts.map((t) => ({ label: humanize(t.type), value: t.count }))} />
      )}
    </Panel>
  );
}
