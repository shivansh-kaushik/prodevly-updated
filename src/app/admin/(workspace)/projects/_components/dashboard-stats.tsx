import { StatBand, type Stat } from '@/components/admin/stat-band';
import { formatCount, formatInr } from '@/lib/admin/format';
import { withParams, type RawSearchParams } from '@/lib/admin/search-params';
import type { ProjectsDashboard } from '@/services/dashboards/projects';

/** "1 day late", "3 days early", "On time". Negative slip means delivered before the deadline. */
export function slipText(days: number): string {
  if (days === 0) return 'On time';
  const abs = Math.abs(days);
  return `${abs} ${abs === 1 ? 'day' : 'days'} ${days > 0 ? 'late' : 'early'}`;
}

/**
 * The totals band at the top of /admin/projects. Every figure is computed from project and ledger
 * records. The margin tile is only passed for viewers with payment:view, never shown as zero.
 */
export function ProjectsStatBand({ dashboard: d, periodLabel, params }: { dashboard: ProjectsDashboard; periodLabel: string; params: RawSearchParams }) {
  const link = (overrides: Record<string, string>) => withParams('/admin/projects', params, overrides);
  const stats: Stat[] = [
    { label: 'Active projects', value: formatCount(d.active), sub: `${formatCount(d.total)} in all`, href: link({ status: 'active' }) },
    { label: 'At risk', value: formatCount(d.atRisk), sub: 'Projects in progress', attention: d.atRisk > 0, href: link({ health: 'at_risk' }) },
    { label: 'Off track', value: formatCount(d.offTrack), sub: 'Projects in progress', attention: d.offTrack > 0, href: link({ health: 'off_track' }) },
    { label: 'Overdue', value: formatCount(d.overdue), sub: 'Deadline passed, not delivered', attention: d.overdue > 0 },
    { label: 'Delivered', value: formatCount(d.deliveredInPeriod), sub: periodLabel },
    {
      label: 'Average delivery slip',
      value: d.avgSlipDays === null ? 'None yet' : slipText(d.avgSlipDays),
      sub: d.slipSample > 0 ? `Across ${formatCount(d.slipSample)} ${d.slipSample === 1 ? 'delivery' : 'deliveries'} with a deadline` : 'No delivery with a deadline in this period',
    },
  ];
  if (d.money) {
    stats.push({
      label: 'Margin',
      value: formatInr(d.money.marginInr),
      sub: d.money.marginPct !== null ? `${d.money.marginPct}% of ${formatInr(d.money.receivedInr)} received` : 'Nothing received in this period',
      attention: d.money.marginInr < 0,
    });
  }
  return <StatBand stats={stats} className="mb-6" />;
}
