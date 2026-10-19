import { getPeriod } from '@/lib/admin/period';
import { parseListParams } from '@/lib/admin/search-params';
import { EXPENSE_SORT_KEYS, parseExpenseFilter } from '@/lib/validation/expense';
import { forbidden } from '@/lib/api/errors';
import { canSubmitExpenses, canViewAllExpenses, searchExpenses, type ExpenseSort } from '@/services/expense.service';
import { amount, describePeriod, filterLines, inr, words } from './format';
import { gather } from './gather';
import type { ExportSection } from './types';

/**
 * Expenses, with the same filters, period and sort as /admin/expenses. The section is open to anyone who can submit their own
 * out-of-pocket expenses, and searchExpenses confines such a viewer to those: their export holds their own rows and nothing else.
 */
export const expensesExport: ExportSection = {
  id: 'expenses',
  noun: 'expenses',
  assertAccess(viewer) {
    if (!canViewAllExpenses(viewer) && !canSubmitExpenses(viewer)) throw forbidden('Your access does not allow this action');
  },
  async build({ viewer, sp, cap }) {
    const all = canViewAllExpenses(viewer);
    const period = await getPeriod(sp);
    const sorting = parseListParams(sp, { sortable: EXPENSE_SORT_KEYS, defaultSort: 'spentOn' });
    const filter = parseExpenseFilter(sp);

    const { items, total, truncated } = await gather(cap, async (page, pageSize) => {
      const result = await searchExpenses(viewer, { ...filter, range: { from: period.from, to: period.to }, sort: sorting.sort as ExpenseSort, dir: sorting.dir, page, pageSize });
      return { items: result.items, total: result.meta.total };
    });

    return {
      header: [
        'Reference', 'Spent on', 'Status', 'Charged to', 'Category', 'Description', 'Payee', 'Client', 'Project reference', 'Project', 'Amount', 'Currency', 'Amount (INR)', 'Paid from', 'Paid by', 'Paid on', 'Receipts attached',
      ],
      rows: items.map((e) => [
        e.ref,
        e.spentOn,
        words(e.status),
        e.scope === 'company' ? 'Company overhead' : 'Client project',
        words(e.category),
        e.description,
        e.payee,
        e.project?.clientName,
        e.project?.ref,
        e.project?.name,
        amount(e.amount.amountMinor, e.amount.currency),
        e.amount.currency,
        inr(e.amount.inrMinor),
        e.paidFrom === 'company' ? 'Company' : 'Out of pocket',
        e.paidBy?.name,
        e.paidOn,
        e.receiptCount,
      ]),
      total,
      truncated,
      filters: [
        ...filterLines([
          ['scope', all ? undefined : 'own out-of-pocket expenses only'], ['search', filter.q], ['status', filter.status], ['charged to', filter.scope], ['category', filter.category], ['project', filter.projectId],
          ['person', all ? filter.personId : undefined], ['paid from', all ? filter.paidFrom : undefined], ['sort', `${sorting.sort} ${sorting.dir}`],
        ]),
        describePeriod(period),
      ],
    };
  },
};
