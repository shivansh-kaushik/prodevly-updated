import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/admin/page-header';
import { BASE_CURRENCY } from '@/config/currencies';
import { objectIdParam, type RawSearchParams } from '@/lib/admin/search-params';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { canRecordExpenses, canSubmitExpenses, getExpenseFilterLabels } from '@/services/expense.service';
import { getSettings } from '@/services/settings.service';
import { requireExpensePage } from '../_lib/access';
import { ExpenseForm } from '../_components/expense-form';
import { emptyState } from '../_components/form-model';

export const metadata: Metadata = { title: 'New expense' };

export default async function NewExpensePage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireExpensePage('/admin/expenses/new');
  const canRecord = canRecordExpenses(viewer);
  const canSubmit = canSubmitExpenses(viewer);
  if (!canRecord && !canSubmit) notFound();

  // `?projectId=` lets a project page link straight here with its project already chosen.
  const projectId = objectIdParam(await searchParams, 'projectId');
  const [settings, labels] = await Promise.all([getSettings(), projectId ? getExpenseFilterLabels(viewer, { projectId }) : null]);
  const today = formatDateOnly(todayDateOnly(new Date(), settings.timezone));
  const initial = emptyState({
    // A person who records expenses mostly records what the company paid; everyone else can only submit what they paid.
    paidFrom: canRecord ? 'company' : 'admin',
    today,
    currency: BASE_CURRENCY,
    project: labels?.project ? { id: labels.project.id, label: labels.project.label, ref: labels.project.ref } : null,
  });

  return (
    <>
      <PageHeader
        title={canRecord ? 'New expense' : 'Submit an expense'}
        description={
          canRecord && canSubmit
            ? 'Record something the company paid, or submit what you paid yourself and want back.'
            : 'Submit something you paid out of pocket. A superadmin reviews it and pays you back.'
        }
        crumbs={[{ label: 'Expenses', href: '/admin/expenses' }, { label: canRecord ? 'New expense' : 'Submit an expense' }]}
      />
      <ExpenseForm
        options={{
          currencies: settings.enabledCurrencies.includes(BASE_CURRENCY) ? settings.enabledCurrencies : [BASE_CURRENCY, ...settings.enabledCurrencies],
          categories: settings.expenseCategories,
          paymentModes: settings.paymentModes,
          today,
        }}
        canRecord={canRecord}
        canSubmit={canSubmit}
        initial={initial}
      />
    </>
  );
}
