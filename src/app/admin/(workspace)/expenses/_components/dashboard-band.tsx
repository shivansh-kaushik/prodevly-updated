import { ChartCard } from '@/components/admin/chart-card';
import { formatNative } from '@/components/admin/money';
import { StatBand } from '@/components/admin/stat-band';
import { CHART_COLORS, SERIES_PALETTE } from '@/lib/admin/chart-colors';
import { formatCount, formatInr, formatPercent, humanize } from '@/lib/admin/format';
import { withParams, type RawSearchParams } from '@/lib/admin/search-params';
import type { ExpensesDashboard } from '@/services/dashboards/expenses';

const short = (name: string, max = 16) => (name.length > max ? `${name.slice(0, max - 1)}…` : name);

/** Chart axis labels key the table view, so a second "Asha" becomes "Asha (2)". */
function uniqueLabels(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const count = (seen.get(n) ?? 0) + 1;
    seen.set(n, count);
    return count === 1 ? n : `${n} (${count})`;
  });
}

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

/**
 * The band above the expense list: totals, then the charts. Every figure was computed from records by
 * `getExpensesDashboard`; nothing here is typed in. Awaiting approval and owed-to-admins are open items, so they do not
 * follow the period (the sub-line says so). Ratios appear only when what they divide by is above zero.
 */
export function ExpensesDashboardBand({ data, periodLabel, sp }: { data: ExpensesDashboard; periodLabel: string; sp: RawSearchParams }) {
  const list = (overrides: Record<string, string | undefined>) => withParams('/admin/expenses', sp, { status: undefined, scope: undefined, paidFrom: undefined, ...overrides });
  const companyShare = formatPercent(data.company.inrMinor, data.spent.inrMinor);
  const projectShare = formatPercent(data.project.inrMinor, data.spent.inrMinor);
  const foreign = data.spent.foreign.map((f) => formatNative(f.nativeMinor, f.currency)).join(', ');

  const categories = data.perMonth.categories;
  const series = [
    ...categories.map((c, i) => ({ key: `c${i}`, label: humanize(c), color: SERIES_PALETTE[i % SERIES_PALETTE.length], stackId: 's' })),
    ...(data.perMonth.hasOther ? [{ key: 'other', label: 'Other categories', color: CHART_COLORS.slate, stackId: 's' }] : []),
  ];
  const projects = uniqueLabels(data.byProject.map((p) => short(p.ref ? `${p.ref} ${p.name}` : p.name, 24)));
  const people = uniqueLabels(data.owedToAdmins.byAdmin.map((a) => short(a.name)));
  const categoryNames = uniqueLabels(data.byCategory.map((c) => short(humanize(c.category), 24)));

  return (
    <div className="mb-8 flex flex-col gap-6">
      <StatBand
        stats={[
          {
            label: 'Spent',
            value: formatInr(data.spent.inrMinor),
            sub: foreign ? `${periodLabel}. Includes ${foreign}` : `${periodLabel}. Approved and paid`,
            href: list({ status: 'settled' }),
          },
          { label: 'Company overhead', value: formatInr(data.company.inrMinor), sub: companyShare ? `${companyShare} of spend` : plural(data.company.count, 'expense', 'expenses'), href: list({ status: 'settled', scope: 'company' }) },
          { label: 'Charged to projects', value: formatInr(data.project.inrMinor), sub: projectShare ? `${projectShare} of spend` : plural(data.project.count, 'expense', 'expenses'), href: list({ status: 'settled', scope: 'project' }) },
          {
            label: 'Awaiting approval',
            value: formatCount(data.awaitingApproval.count),
            sub: `${formatInr(data.awaitingApproval.inrMinor)}, any date`,
            attention: data.awaitingApproval.count > 0,
            href: list({ status: 'submitted' }),
          },
          {
            label: 'Owed to admins',
            value: formatInr(data.owedToAdmins.inrMinor),
            sub: `${plural(data.owedToAdmins.count, 'reimbursement', 'reimbursements')} to pay, any date`,
            attention: data.owedToAdmins.count > 0,
            href: list({ status: 'approved', paidFrom: 'admin' }),
          },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          className="lg:col-span-2"
          title="Spend per month"
          hint={`${periodLabel}, by category (top five, the rest together)`}
          type="bar"
          data={data.perMonth.rows.map((r) => ({
            month: r.label,
            ...Object.fromEntries(categories.map((c, i) => [`c${i}`, r.byCategory[c] ?? 0])),
            other: r.other,
          }))}
          xKey="month"
          xLabel="Month"
          series={series}
          kind="inr"
          totals
          height={240}
          emptyBody="Nothing was spent in this period."
        />
        <ChartCard
          title="Spend by category"
          hint={periodLabel}
          type="ranked"
          data={data.byCategory.map((c, i) => ({ category: categoryNames[i] ?? c.category, spent: c.inrMinor }))}
          xKey="category"
          xLabel="Category"
          series={[{ key: 'spent', label: 'Spent', color: CHART_COLORS.blue }]}
          kind="inr"
          totals
          emptyBody="Nothing was spent in this period."
        />
        <ChartCard
          title="Spend by project"
          hint={`${periodLabel}, top ten`}
          type="ranked"
          data={data.byProject.map((p, i) => ({ project: projects[i] ?? p.name, spent: p.inrMinor }))}
          xKey="project"
          xLabel="Project"
          series={[{ key: 'spent', label: 'Spent', color: CHART_COLORS.credit }]}
          kind="inr"
          totals
          emptyBody="No expense was charged to a project in this period."
        />
        <ChartCard
          className="lg:col-span-2"
          title="Reimbursements owed per admin"
          hint="Approved and not yet paid, any date"
          type="ranked"
          data={data.owedToAdmins.byAdmin.map((a, i) => ({ admin: people[i] ?? a.name, owed: a.inrMinor }))}
          xKey="admin"
          xLabel="Admin"
          series={[{ key: 'owed', label: 'Owed', color: CHART_COLORS.amber }]}
          kind="inr"
          totals
          emptyBody="Nobody is waiting to be paid back."
        />
      </div>
    </div>
  );
}
