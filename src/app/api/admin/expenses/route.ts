import { adminRoute } from '@/lib/api/admin-route';
import { created, ok } from '@/lib/api/response';
import { first, parseListParams } from '@/lib/admin/search-params';
import { createExpenseSchema, EXPENSE_SORT_KEYS, parseExpenseFilter, parseRangeParams, type CreateExpenseBody } from '@/lib/validation/expense';
import { createExpense, searchExpenses, type ExpenseSort } from '@/services/expense.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * No route-level capability on this file's reads and writes: who may do what depends on the expense (company-paid or out of
 * pocket) and on whose it is, so the SERVICE decides. A plain admin lists only their own out-of-pocket expenses.
 *
 * GET /api/admin/expenses?q=&status=&scope=&category=&projectId=&person=&paidFrom=&from=&to=&sort=&dir=&page=&pageSize=
 */
export const GET = adminRoute({}, async ({ admin, request }) => {
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const list = parseListParams(sp, { sortable: EXPENSE_SORT_KEYS, defaultSort: 'spentOn', pageSize: Number(first(sp, 'pageSize')) || 25 });
  const page = await searchExpenses(admin, {
    ...parseExpenseFilter(sp),
    range: parseRangeParams(sp),
    sort: list.sort as ExpenseSort,
    dir: list.dir,
    page: list.page,
    pageSize: list.pageSize,
  });
  return ok(page);
});

/** paidFrom "company" records a paid expense (expense:record); "admin" submits one out of pocket (expense:submit). */
export const POST = adminRoute<CreateExpenseBody>(
  { schema: createExpenseSchema },
  async ({ admin, body, meta }) => created({ expense: await createExpense(admin, body, meta) }),
);
