import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/admin/page-header';
import { AppError } from '@/lib/api/errors';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { canRecordExpenses, canSubmitExpenses, getExpense, type ExpenseDTO } from '@/services/expense.service';
import { getSettings } from '@/services/settings.service';
import { expenseIdParam, requireExpensePage } from '../../_lib/access';
import { ExpenseForm } from '../../_components/expense-form';
import { stateFromExpense } from '../../_components/form-model';

export const metadata: Metadata = { title: 'Edit expense' };

export default async function EditExpensePage({ params }: { params: Promise<{ expenseId: string }> }) {
  const viewer = await requireExpensePage('/admin/expenses');
  const id = expenseIdParam((await params).expenseId);
  let expense: ExpenseDTO;
  try {
    expense = await getExpense(viewer, id);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  // Not allowed to edit (approved and theirs, rejected, void): back to the expense, which says what can be done.
  if (!expense.can.edit) redirect(`/admin/expenses/${id}`);

  const settings = await getSettings();
  const today = formatDateOnly(todayDateOnly(new Date(), settings.timezone));
  const openable = new Set(expense.receipts.map((r) => r.id));
  const outOfPocket = expense.paidFrom === 'admin';

  return (
    <>
      <PageHeader
        title="Edit expense"
        description={expense.status === 'submitted' ? 'Changes are kept in the history. The approver sees the updated expense.' : 'Changes are kept in the history, with the values before and after.'}
        crumbs={[{ label: 'Expenses', href: '/admin/expenses' }, { label: expense.ref, href: `/admin/expenses/${id}` }, { label: 'Edit' }]}
      />
      <ExpenseForm
        options={{
          currencies: settings.enabledCurrencies.includes(expense.amount.currency) ? settings.enabledCurrencies : [...settings.enabledCurrencies, expense.amount.currency],
          categories: settings.expenseCategories,
          paymentModes: settings.paymentModes,
          today,
        }}
        canRecord={canRecordExpenses(viewer)}
        canSubmit={canSubmitExpenses(viewer)}
        initial={stateFromExpense(expense)}
        edit={{
          id,
          editPayment: expense.can.editPayment,
          hiddenReceiptIds: expense.receiptIds.filter((r) => !openable.has(r)),
          initialClient: expense.project ? { id: expense.project.clientId, label: expense.project.clientName } : null,
          paidByLabel: outOfPocket ? `Paid out of pocket by ${expense.paidBy?.name ?? 'an admin'}.` : 'Paid by the company.',
        }}
      />
    </>
  );
}
