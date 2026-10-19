import { StatBand, type Stat } from '@/components/admin/stat-band';
import { formatCount, formatInr } from '@/lib/admin/format';
import { withParams, type RawSearchParams } from '@/lib/admin/search-params';
import type { PaymentsDashboard } from '@/services/dashboards/payments';
import { nativeList } from './labels';

/**
 * The totals band at the top of /admin/payments. Every figure is computed from payment records and project
 * milestones: INR sums of received entries (void left out, refunds subtracted), with native amounts only as
 * a quiet second line. The first tile leads.
 */
export function PaymentsStatBand({ dashboard: d, periodLabel, params }: { dashboard: PaymentsDashboard; periodLabel: string; params: RawSearchParams }) {
  const link = (overrides: Record<string, string>) => withParams('/admin/payments', params, overrides);
  const stats: Stat[] = [
    { label: 'Received', value: formatInr(d.receivedInr), sub: `${periodLabel}, net of refunds` },
    { label: 'Receipts', value: formatCount(d.receipts), sub: `${formatInr(d.receiptsInr)} before refunds`, href: link({ type: 'receipt', status: 'received' }) },
    {
      label: 'Refunds',
      value: formatInr(d.refundsInr),
      sub: d.refunds > 0 ? `${formatCount(d.refunds)} ${d.refunds === 1 ? 'refund' : 'refunds'} to clients` : 'None in this period',
      href: link({ type: 'refund', status: 'received' }),
    },
    { label: 'TDS deducted', value: formatInr(d.tdsInr), sub: 'By clients, on receipts' },
    {
      label: 'Milestones due, 30 days',
      value: formatCount(d.dueSoon.count),
      sub: d.dueSoon.remaining.length > 0 ? `To come: ${nativeList(d.dueSoon.remaining)}` : 'Nothing falls due',
    },
    {
      label: 'Overdue milestones',
      value: formatCount(d.overdue.count),
      sub: d.overdue.remaining.length > 0 ? `Owed: ${nativeList(d.overdue.remaining)}` : 'None overdue',
      attention: d.overdue.count > 0,
    },
  ];
  return <StatBand stats={stats} className="mb-6" />;
}
