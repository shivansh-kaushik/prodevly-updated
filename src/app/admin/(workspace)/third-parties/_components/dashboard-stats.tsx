import { formatNative } from '@/components/admin/money';
import { StatBand, type Stat } from '@/components/admin/stat-band';
import { formatCount, formatInr, humanize } from '@/lib/admin/format';
import { withParams } from '@/lib/admin/search-params';
import type { ThirdPartiesDashboard } from '@/services/dashboards/third-parties';
import { PATHS } from './labels';

/**
 * The totals band at the top of /admin/third-parties. Every figure was computed from records by
 * `getThirdPartiesDashboard`. The money tiles are only passed for viewers with payout:view (`dashboard.money`),
 * never shown as zero.
 */
export function ThirdPartiesStatBand({ dashboard: d, periodLabel }: { dashboard: ThirdPartiesDashboard; periodLabel: string }) {
  const types = d.typeCounts.slice(0, 3).map((t) => `${humanize(t.type)} ${formatCount(t.count)}`).join(', ');
  const stats: Stat[] = [
    { label: 'Active third parties', value: formatCount(d.activeThirdParties), sub: types || 'None yet', href: withParams(PATHS.directory, {}, { status: 'active' }) },
  ];
  const m = d.money;
  if (m) {
    const foreign = m.paid.byCurrency.filter((c) => c.currency !== 'INR');
    const open = m.openWorkOrders;
    stats.push(
      {
        label: 'Paid',
        value: formatInr(m.paid.inr),
        sub: foreign.length > 0 ? `${foreign.map((c) => formatNative(c.nativeMinor, c.currency)).join(', ')}. ${periodLabel}` : `${formatCount(m.paid.count)} ${m.paid.count === 1 ? 'payout' : 'payouts'}, ${periodLabel}`,
        href: withParams(PATHS.payouts, {}, { status: 'paid' }),
      },
      {
        label: 'Due now',
        value: formatInr(m.due.inr),
        sub: m.due.overdueCount > 0 ? `${formatCount(m.due.overdueCount)} overdue, ${formatInr(m.due.overdueInr)}` : `${formatCount(m.due.count)} ${m.due.count === 1 ? 'payout' : 'payouts'}`,
        attention: m.due.overdueCount > 0,
        href: withParams(PATHS.payouts, {}, { status: 'due' }),
      },
      { label: 'Open work orders', value: formatCount(open.count), sub: 'Open or delivered', href: withParams(PATHS.workOrders, {}, { status: 'current' }) },
      {
        label: 'Open work-order balance',
        value: open.balanceInr === null ? 'Needs a rate' : formatInr(open.balanceInr),
        sub:
          open.missingRates.length > 0
            ? `No exchange rate for ${open.missingRates.join(', ')}`
            : open.byCurrency.some((c) => c.currency !== 'INR')
              ? 'Not yet paid or due, at latest rates'
              : 'Not yet paid or due',
      },
    );
  }
  return <StatBand stats={stats} className="mb-6" />;
}
