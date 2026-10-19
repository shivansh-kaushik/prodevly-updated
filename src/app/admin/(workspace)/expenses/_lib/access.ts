import { notFound } from 'next/navigation';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { parseObjectId } from '@/lib/validation/common';
import { canSubmitExpenses, canViewAllExpenses } from '@/services/expense.service';
import type { SessionUser } from '@/types/session';

/**
 * Every expense page starts here. The Expenses section is open to anyone who can submit their own out-of-pocket expenses
 * (every admin) or see everyone's (`expense:view`), so there is no single capability for `requireAdminPage`: the either-or is
 * checked right after it, and a viewer with neither gets the same "not found" as any page they may not use. The services behind the
 * page check again, and show a plain admin only their own expenses.
 */
export async function requireExpensePage(path: string): Promise<SessionUser> {
  const viewer = await requireAdminPage(path);
  if (!canViewAllExpenses(viewer) && !canSubmitExpenses(viewer)) notFound();
  return viewer;
}

/** A route id as a page param: an invalid one is a 404 page, not an error page. */
export function expenseIdParam(raw: string): string {
  try {
    return parseObjectId(raw);
  } catch {
    notFound();
  }
}
