import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { DataToolbar } from '@/components/admin/data-toolbar';
import { ExportButton } from '@/components/admin/export-button';
import { PageHeader } from '@/components/admin/page-header';
import { PeriodPicker } from '@/components/admin/period-picker';
import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { EXPENSE_PAID_FROM, EXPENSE_SCOPES, EXPENSE_STATUSES } from '@/config/statuses';
import { humanize } from '@/lib/admin/format';
import { getPeriod } from '@/lib/admin/period';
import { first, parseListParams, type RawSearchParams } from '@/lib/admin/search-params';
import { formatDateOnly } from '@/lib/dates/date-only';
import { EXPENSE_SORT_KEYS, parseExpenseFilter } from '@/lib/validation/expense';
import { canRecordExpenses, canSubmitExpenses, canViewAllExpenses, getExpenseFilterLabels, searchExpenses, type ExpenseSort } from '@/services/expense.service';
import { getExpensesDashboard } from '@/services/dashboards/expenses';
import { getSettings } from '@/services/settings.service';
import { requireExpensePage } from './_lib/access';
import { ExpensesDashboardBand } from './_components/dashboard-band';
import { ExpenseFilters } from './_components/expense-filters';
import { ExpenseTable } from './_components/expense-table';
import { MyExpensesBand } from './_components/my-summary';

export const metadata: Metadata = { title: 'Expenses' };

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Awaiting approval',
  approved: 'Approved, to be paid',
  paid: 'Paid or reimbursed',
  rejected: 'Rejected',
  void: 'Void',
  settled: 'Approved or paid',
};

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireExpensePage('/admin/expenses');
  const sp = await searchParams;
  const all = canViewAllExpenses(viewer);
  const period = await getPeriod(sp);
  const list = parseListParams(sp, { sortable: EXPENSE_SORT_KEYS, defaultSort: 'spentOn' });
  const filter = parseExpenseFilter(sp);
  const settings = await getSettings();

  const [dashboard, page, labels] = await Promise.all([
    getExpensesDashboard(viewer, period),
    searchExpenses(viewer, { ...filter, range: { from: period.from, to: period.to }, sort: list.sort as ExpenseSort, dir: list.dir, page: list.page, pageSize: list.pageSize }),
    getExpenseFilterLabels(viewer, { projectId: filter.projectId, personId: filter.personId }),
  ]);
  const filtered = Boolean(first(sp, 'q') || filter.status || filter.scope || filter.category || filter.projectId || filter.personId || filter.paidFrom);
  const canCreate = canRecordExpenses(viewer) || canSubmitExpenses(viewer);
  const canExport = viewer.capabilities.has('export:data');
  const newLabel = canRecordExpenses(viewer) ? 'New expense' : 'Submit an expense';
  // A category that is no longer in Settings can still be filtered on when the URL asks for it.
  const categories = filter.category && !settings.expenseCategories.includes(filter.category) ? [...settings.expenseCategories, filter.category] : settings.expenseCategories;

  return (
    <>
      <PageHeader
        title="Expenses"
        description={all ? `What the company spends, and what it owes its people. ${period.label}.` : `What you have paid out of pocket and asked to be paid back. ${period.label}.`}
        actions={
          canCreate || canExport ? (
            <>
              <ExportButton section="expenses" params={sp} canExport={canExport} />
              {canCreate ? <LinkButton href="/admin/expenses/new" variant="primary"><Plus className="size-4" aria-hidden /> {newLabel}</LinkButton> : null}
            </>
          ) : undefined
        }
      />

      {dashboard.scope === 'all' ? (
        <ExpensesDashboardBand data={dashboard} periodLabel={period.label} sp={sp} />
      ) : (
        <MyExpensesBand data={dashboard} periodLabel={period.label} sp={sp} />
      )}

      <DataToolbar
        searchPlaceholder="Search description, payee or reference"
        filters={[
          { key: 'status', label: 'Status', allLabel: 'Any status', options: [...EXPENSE_STATUSES, 'settled'].map((s) => ({ value: s, label: STATUS_LABELS[s] ?? humanize(s) })) },
          { key: 'scope', label: 'Charged to', allLabel: 'Company and projects', options: EXPENSE_SCOPES.map((s) => ({ value: s, label: s === 'company' ? 'Company overhead' : 'Client projects' })) },
          { key: 'category', label: 'Category', allLabel: 'Any category', options: categories.map((c) => ({ value: c, label: humanize(c) })) },
          ...(all ? [{ key: 'paidFrom', label: 'Paid from', allLabel: 'Any payer', options: EXPENSE_PAID_FROM.map((p) => ({ value: p, label: p === 'company' ? 'Company' : 'Out of pocket' })) }] : []),
        ]}
      >
        <ExpenseFilters project={labels.project} person={labels.person} showPerson={all} />
        <PeriodPicker current={period.key} from={period.key === 'custom' ? formatDateOnly(period.from) : undefined} to={period.key === 'custom' ? formatDateOnly(period.to) : undefined} />
      </DataToolbar>
      <p className="mb-3 -mt-2 text-[12px] text-pd-ink-3">
        The period filters the list by the date spent. Expenses waiting for approval or for payment show for every date.
      </p>

      {page.items.length === 0 ? (
        <div className="rounded-pd-md bg-pd-leaf shadow-[0_0_0_1px_var(--color-pd-rule)]">
          <EmptyState
            title={filtered ? 'No expenses match' : 'No expenses in this period'}
            body={
              filtered
                ? 'Try a different search, or clear the filters.'
                : canCreate
                  ? all ? 'Record the first expense, or pick another period.' : 'Submit an expense you paid for, or pick another period.'
                  : 'Expenses appear here once they are recorded.'
            }
            action={
              filtered ? (
                <Link href="/admin/expenses" className="text-[14px] underline">Clear filters</Link>
              ) : canCreate ? (
                <LinkButton href="/admin/expenses/new" variant="primary">{all ? 'Record the first expense' : 'Submit an expense'}</LinkButton>
              ) : undefined
            }
            className="py-12"
          />
        </div>
      ) : (
        <>
          <ExpenseTable items={page.items} params={sp} sort={list.sort} dir={list.dir} settledInr={page.settledInr} showPerson={all} flagWaiting={viewer.capabilities.has('money:approve')} />
          <Pagination meta={page.meta} path="/admin/expenses" params={sp} noun="expenses" />
        </>
      )}
    </>
  );
}
