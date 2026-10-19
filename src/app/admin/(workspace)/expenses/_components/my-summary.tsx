import { StatBand } from '@/components/admin/stat-band';
import { formatCount, formatInr } from '@/lib/admin/format';
import { withParams, type RawSearchParams } from '@/lib/admin/search-params';
import type { MyExpensesSummary } from '@/services/dashboards/expenses';

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

/** What a plain admin sees above their list: only their own out-of-pocket expenses, in four figures. */
export function MyExpensesBand({ data, periodLabel, sp }: { data: MyExpensesSummary; periodLabel: string; sp: RawSearchParams }) {
  const list = (status: string) => withParams('/admin/expenses', sp, { status });
  return (
    <section aria-labelledby="my-expenses-heading" className="mb-8">
      <h2 id="my-expenses-heading" className="mb-2 font-pd-serif text-[20px] leading-7 font-semibold text-pd-ink">My expenses</h2>
      <StatBand
        stats={[
          {
            label: 'Waiting to be paid back',
            value: formatInr(data.toBePaid.inrMinor),
            sub: `${plural(data.toBePaid.count, 'expense', 'expenses')} approved, any date`,
            href: list('approved'),
            attention: data.toBePaid.count > 0,
          },
          { label: 'Awaiting approval', value: formatInr(data.awaitingApproval.inrMinor), sub: `${plural(data.awaitingApproval.count, 'expense', 'expenses')}, any date`, href: list('submitted') },
          { label: 'Paid back to you', value: formatInr(data.paidInPeriod.inrMinor), sub: `${plural(data.paidInPeriod.count, 'expense', 'expenses')}, ${periodLabel}`, href: list('paid') },
          { label: 'Rejected', value: formatCount(data.rejectedInPeriod.count), sub: periodLabel, href: list('rejected') },
        ]}
      />
    </section>
  );
}
