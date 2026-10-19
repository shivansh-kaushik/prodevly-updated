import { formatNative } from '@/components/admin/money';
import { StatBand, type Stat } from '@/components/admin/stat-band';
import { formatCount, formatInr } from '@/lib/admin/format';
import type { PayoutTotals } from '@/services/team-payout.service';

const countText = (n: number, noun: string) => `${formatCount(n)} ${noun}${n === 1 ? '' : 's'}`;

/** "USD 4,000.00 (₹3,33,680.00)" for each foreign currency: the native amount is the secondary line, INR is the figure. */
const nativeLine = (lines: PayoutTotals['paid']['native']) => lines.map((l) => `${formatNative(l.amountMinor, l.currency)} (${formatInr(l.inrMinor)})`).join(', ');

/**
 * The totals band of the payouts list. Every figure is summed from payout records in INR; a period with nothing in it shows
 * zeros, and the sub-lines say what the figure is made of instead of leaving it bare.
 */
export function PayoutTotalsBand({ totals, periodLabel }: { totals: PayoutTotals; periodLabel: string }) {
  const { paid, due, owed } = totals;
  const stats: Stat[] = [
    {
      label: `Paid, ${periodLabel}`,
      value: formatInr(paid.inrMinor),
      sub: paid.native.length > 0 ? nativeLine(paid.native) : paid.count > 0 ? countText(paid.count, 'payout') : 'Nothing paid in this period',
    },
    {
      label: 'Due in this period',
      value: formatInr(due.inrMinor),
      sub: due.overdueCount > 0 ? `${countText(due.count, 'payout')}, ${formatCount(due.overdueCount)} overdue` : due.native.length > 0 ? nativeLine(due.native) : due.count > 0 ? countText(due.count, 'payout') : 'Nothing falls due',
      attention: due.overdueCount > 0,
    },
    {
      label: 'Owed now',
      value: formatInr(owed.inrMinor),
      sub: owed.count > 0 ? `${countText(owed.count, 'payout')} waiting to be paid, any date` : 'Nothing waiting',
    },
    {
      label: 'Not charged to a project',
      value: formatInr(paid.unallocatedInrMinor),
      sub: paid.count > 0 ? 'Paid in this period, company overhead' : 'Nothing paid in this period',
    },
  ];
  return <StatBand stats={stats} className="mb-6" />;
}
