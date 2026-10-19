import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditFeed } from '@/components/admin/audit-feed';
import { formatRate } from '@/components/admin/fx-field-model';
import { Money, formatNative } from '@/components/admin/money';
import { PageHeader } from '@/components/admin/page-header';
import { StatusHistory } from '@/components/admin/status-history';
import { Badge } from '@/components/ui/badge';
import { DescriptionList, Panel, PanelHeader } from '@/components/ui/panel';
import { AppError } from '@/lib/api/errors';
import { formatDate, formatDateTime, humanize } from '@/lib/admin/format';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { getExpense, type ExpenseDTO } from '@/services/expense.service';
import { getActivity } from '@/services/activity.service';
import { getSettings } from '@/services/settings.service';
import { expenseIdParam, requireExpensePage } from '../_lib/access';
import { ExpenseActions } from '../_components/expense-actions';
import { ReceiptsList } from '../_components/receipts-list';
import { ExpenseStatusBadge } from '../_components/status';

// The expense's own name is data only people who may open it should see, so the tab title stays generic.
export const metadata: Metadata = { title: 'Expense' };

const RATE_SOURCE: Record<string, string> = { table: 'table rate', manual: 'rate entered by hand', bank: 'worked out from the INR that arrived', identity: 'INR' };

function fxLine(e: ExpenseDTO): string | null {
  if (e.amount.currency === 'INR') return null;
  return `1 ${e.amount.currency} = INR ${formatRate(e.fx.rate)} (${RATE_SOURCE[e.fx.source] ?? e.fx.source}, ${formatDate(e.fx.rateOn)})`;
}

export default async function ExpensePage({ params }: { params: Promise<{ expenseId: string }> }) {
  const viewer = await requireExpensePage('/admin/expenses');
  const id = expenseIdParam((await params).expenseId);
  let expense: ExpenseDTO;
  try {
    expense = await getExpense(viewer, id);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const [activity, settings] = await Promise.all([getActivity({ entityType: 'expense', entityId: id }, { limit: 20 }), getSettings()]);
  const today = formatDateOnly(todayDateOnly(new Date(), settings.timezone));

  const e = expense;
  const outOfPocket = e.paidFrom === 'admin';
  const payer = e.paidBy?.name ?? null;
  const amountText = formatNative(e.amount.amountMinor, e.amount.currency);
  const fx = fxLine(e);
  const withdraw = e.can.void && !viewer.capabilities.has('money:void');
  const showPayment = e.status === 'paid' || (!outOfPocket && e.paidOn);

  return (
    <>
      <PageHeader
        title={e.description}
        description={
          <span>
            <span className="font-pd-mono">{e.ref}</span> · {outOfPocket ? `Paid out of pocket by ${payer ?? 'an admin'}` : 'Paid by the company'}
          </span>
        }
        crumbs={[{ label: 'Expenses', href: '/admin/expenses' }, { label: e.ref }]}
        meta={<ExpenseStatusBadge status={e.status} paidFrom={e.paidFrom} />}
      />

      {e.status === 'rejected' || e.status === 'void' ? (
        <p role="status" className="pd-margin-flag mb-6 rounded-pd-md bg-pd-leaf p-4 text-[14px] text-pd-ink shadow-[0_0_0_1px_var(--color-pd-rule)]">
          <span className="font-medium">{e.status === 'rejected' ? 'Rejected' : 'Voided'}:</span> {(e.status === 'rejected' ? e.rejectReason : e.voidReason) ?? ''}
          <span className="block text-[13px] text-pd-ink-3">It stays on record and is not counted in any total.</span>
        </p>
      ) : e.status === 'approved' && outOfPocket ? (
        <p role="status" className="mb-6 rounded-pd-md bg-pd-amber-wash p-4 text-[14px] text-pd-ink">
          <span className="font-medium">{payer ?? 'The person who paid'} is owed {amountText}.</span> It is counted as spent and waits to be paid back.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-6">
          <Panel>
            <PanelHeader title="Details" />
            <DescriptionList
              items={[
                { label: 'Amount', value: <Money amountMinor={e.amount.amountMinor} currency={e.amount.currency} inrMinor={e.amount.inrMinor} inline className="text-[16px] font-semibold" /> },
                ...(fx ? [{ label: 'Exchange rate', value: <span className="pd-figure">{fx}</span> }] : []),
                { label: 'Date spent', value: formatDate(e.spentOn) },
                { label: 'Category', value: humanize(e.category) },
                {
                  label: 'Charged to',
                  value: e.project ? (
                    <span>
                      <Link href={`/admin/projects/${e.project.id}`} prefetch={false} className="underline-offset-2 hover:underline">{e.project.name}</Link>
                      <span className="block text-[12px] text-pd-ink-3"><span className="font-pd-mono">{e.project.ref}</span> · {e.project.clientName}</span>
                    </span>
                  ) : (
                    <Badge>Company overhead</Badge>
                  ),
                },
                ...(e.task ? [{ label: 'Task', value: <Link href={`/admin/tasks/${e.task.id}`} prefetch={false} className="underline-offset-2 hover:underline"><span className="font-pd-mono text-[12px] text-pd-ink-3">{e.task.ref}</span> {e.task.title}</Link> }] : []),
                { label: 'Paid to', value: e.payee },
                { label: outOfPocket ? 'Submitted by' : 'Recorded by', value: e.recordedBy },
                ...(e.approvedBy ? [{ label: 'Approved by', value: `${e.approvedBy}${e.approvedAt ? `, ${formatDateTime(e.approvedAt)}` : ''}` }] : []),
              ]}
            />
          </Panel>

          {showPayment ? (
            <Panel>
              <PanelHeader title={outOfPocket ? 'Reimbursement' : 'Payment'} />
              <DescriptionList
                items={[
                  { label: 'Date paid', value: e.paidOn ? formatDate(e.paidOn) : '' },
                  { label: 'Paid by', value: e.mode ? humanize(e.mode) : '' },
                  { label: 'Reference', value: e.transactionRef ? <span className="font-pd-mono text-[13px]">{e.transactionRef}</span> : '' },
                ]}
              />
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader title="Receipts" />
            <ReceiptsList receipts={e.receipts} attached={e.receiptCount} />
          </Panel>

          <Panel>
            <PanelHeader title="Approval trail" hint="Every status change, with who and why." />
            <StatusHistory items={e.statusHistory} />
          </Panel>

          <Panel>
            <PanelHeader title="Activity" hint="Every change, with the values before and after." />
            <AuditFeed entries={activity} emptyTitle="No activity on this expense yet" />
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel>
            <PanelHeader title="Actions" />
            <ExpenseActions id={e.id} can={e.can} amountText={amountText} payerName={payer} withdraw={withdraw} today={today} paymentModes={settings.paymentModes} />
          </Panel>
        </div>
      </div>
    </>
  );
}
