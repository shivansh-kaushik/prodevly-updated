import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Paperclip } from 'lucide-react';
import { AuditFeed } from '@/components/admin/audit-feed';
import { formatNative } from '@/components/admin/money';
import { PageHeader } from '@/components/admin/page-header';
import { Badge } from '@/components/ui/badge';
import { DescriptionList, Panel, PanelHeader } from '@/components/ui/panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDate, formatDateTime, formatInr } from '@/lib/admin/format';
import { AppError } from '@/lib/api/errors';
import { getCurrentAdmin, requireAdminPage } from '@/lib/auth/page-guard';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { formatBytes } from '@/lib/media/rules';
import { getActivity } from '@/services/activity.service';
import type { PaymentDTO } from '@/services/client-payment.dto';
import { getPayment } from '@/services/client-payment.service';
import { describeMedia } from '@/services/media.service';
import { getSettings } from '@/services/settings.service';
import { fxCaptureLine, modeLabel } from '../_components/labels';
import { PaymentActions } from '../_components/payment-actions';

/** A missing or malformed payment is a 404; anything else (the database is down) is a real error. */
async function loadOrNull(load: () => Promise<PaymentDTO>): Promise<PaymentDTO | null> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ paymentId: string }> }): Promise<Metadata> {
  const { admin } = await getCurrentAdmin();
  if (!admin) return { title: 'Payment' };
  const payment = await loadOrNull(async () => getPayment(admin, (await params).paymentId)).catch(() => null);
  return { title: payment?.ref ?? 'Payment' };
}

export default async function PaymentPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const viewer = await requireAdminPage('/admin/payments', { capability: 'payment:view' });
  // A malformed id and an unknown one are both a 404 (getPayment answers NOT_FOUND for either).
  const payment = await loadOrNull(async () => getPayment(viewer, (await params).paymentId));
  if (!payment) notFound();

  const [attachments, activity, settings] = await Promise.all([
    describeMedia(viewer, payment.attachmentMediaIds),
    getActivity({ entityType: 'payment', entityId: payment.id }, { limit: 20 }),
    getSettings(),
  ]);
  const caps = viewer.capabilities;
  const refund = payment.type === 'refund';
  const void_ = payment.status === 'void';
  const sign = refund ? -1 : 1;
  const { amount } = payment;
  const otherCurrency = payment.contractCurrency !== amount.currency;
  const edited = new Date(payment.updatedAt).getTime() - new Date(payment.createdAt).getTime() > 1000;

  return (
    <>
      <PageHeader
        title={payment.ref}
        description={
          <>
            {refund ? 'Refunded to ' : 'Received from '}
            {caps.has('client:view') ? <Link href={`/admin/clients/${payment.client.id}`} prefetch={false} className="underline underline-offset-2">{payment.client.name}</Link> : payment.client.name}
            {' for '}
            {caps.has('project:view') ? <Link href={`/admin/projects/${payment.project.id}?tab=money`} prefetch={false} className="underline underline-offset-2">{payment.project.name}</Link> : payment.project.name}
          </>
        }
        crumbs={[{ label: 'Client payments', href: '/admin/payments' }, { label: payment.ref }]}
        meta={
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={payment.status} label={void_ ? 'Void' : 'Received'} />
            {refund ? <Badge tone="amber">Refund</Badge> : null}
            {payment.recordedAsAdvance ? <Badge tone="violet">Recorded as advance</Badge> : null}
          </span>
        }
        actions={
          <PaymentActions
            payment={payment}
            attachments={attachments}
            canEdit={caps.has('payment:record')}
            canVoid={caps.has('money:void')}
            form={{
              settings: { currencies: settings.enabledCurrencies, modes: settings.paymentModes, today: formatDateOnly(todayDateOnly(new Date(), settings.timezone)) },
              canAdvance: caps.has('money:approve'),
              lookups: { clients: caps.has('client:view'), projects: caps.has('project:view'), tasks: caps.has('task:view') },
            }}
          />
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-6">
          {void_ ? (
            <Panel flush>
              {/* The red margin line sits on an inner block: the panel's own hairline ring would cover it. */}
              <div className="pd-margin-flag rounded-pd-md p-5">
                <PanelHeader title="This payment is void" hint="It stays in the ledger and is counted in no total." />
                <DescriptionList
                  items={[
                    { label: 'Reason', value: payment.voidReason },
                    { label: 'Voided by', value: payment.voidedBy },
                    { label: 'Voided on', value: payment.voidedAt ? formatDateTime(payment.voidedAt, settings.timezone) : null },
                  ]}
                />
              </div>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader title={refund ? 'Amount refunded' : 'Amount received'} hint={refund ? 'Counts against what was received.' : 'The net amount that reached the account.'} />
            <p className={`pd-figure font-pd-serif text-[32px] leading-10 font-semibold tracking-[-0.02em] text-pd-ink [overflow-wrap:anywhere] ${void_ ? 'line-through decoration-pd-ink-3' : ''}`}>
              {formatNative(sign * amount.amountMinor, amount.currency)}
            </p>
            {amount.currency !== 'INR' ? <p className="pd-figure text-[15px] text-pd-ink-2">{formatInr(sign * amount.inrMinor)} in INR</p> : null}
            <p className="pd-figure mt-2 text-[13px] text-pd-ink-3">{fxCaptureLine(amount)}</p>
            {otherCurrency ? (
              <p className="pd-figure mt-1 text-[13px] text-pd-ink-3">
                Counts as {formatNative(payment.contractEquivalentMinor, payment.contractCurrency)} toward the {payment.contractCurrency} contract.
              </p>
            ) : null}
          </Panel>

          <Panel>
            <PanelHeader title="Details" />
            <DescriptionList
              items={[
                { label: 'Received on', value: formatDate(payment.receivedOn) },
                { label: 'Mode', value: modeLabel(payment.mode) },
                { label: 'Transaction reference', value: payment.transactionRef ? <span className="font-pd-mono text-[13px]">{payment.transactionRef}</span> : null },
                { label: 'Invoice reference', value: payment.invoiceRef },
                { label: 'TDS deducted by the client', value: payment.tdsMinor ? formatNative(payment.tdsMinor, amount.currency) : null },
                { label: 'Bank or platform charges', value: payment.chargesMinor ? formatNative(payment.chargesMinor, amount.currency) : null },
                { label: 'Note', value: payment.note },
                { label: 'Recorded', value: `${payment.recordedBy}, ${formatDateTime(payment.createdAt, settings.timezone)}` },
                ...(edited ? [{ label: 'Last changed', value: formatDateTime(payment.updatedAt, settings.timezone) }] : []),
              ]}
            />
          </Panel>

          <Panel>
            <PanelHeader title="Attachments" hint="Private: only people who can see payments can open them." />
            {attachments.length === 0 ? (
              <p className="text-[14px] text-pd-ink-3">{payment.attachmentMediaIds.length > 0 ? 'The attached files are not available to you.' : 'No files attached.'}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-pd-rule-soft">
                {attachments.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                    <Paperclip className="size-4 shrink-0 text-pd-ink-3" aria-hidden />
                    <a href={m.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-[14px] underline-offset-2 hover:underline">{m.filename}</a>
                    <span className="pd-figure shrink-0 text-[12px] text-pd-ink-3">{formatBytes(m.size)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel>
            <PanelHeader title="Linked to" />
            <DescriptionList
              columns={1}
              items={[
                { label: 'Client', value: caps.has('client:view') ? <Link href={`/admin/clients/${payment.client.id}`} prefetch={false} className="underline underline-offset-2">{payment.client.name}</Link> : payment.client.name },
                {
                  label: 'Project',
                  value: (
                    <>
                      {caps.has('project:view') ? <Link href={`/admin/projects/${payment.project.id}?tab=money`} prefetch={false} className="underline underline-offset-2">{payment.project.name}</Link> : payment.project.name}
                      <span className="ml-1.5 font-pd-mono text-[12px] text-pd-ink-3">{payment.project.ref}</span>
                    </>
                  ),
                },
                {
                  label: 'Task',
                  value: payment.task ? (
                    <>
                      {caps.has('task:view') ? <Link href={`/admin/tasks/${payment.task.id}`} prefetch={false} className="underline underline-offset-2">{payment.task.title}</Link> : payment.task.title}
                      <span className="ml-1.5 font-pd-mono text-[12px] text-pd-ink-3">{payment.task.ref}</span>
                    </>
                  ) : null,
                },
                { label: 'Milestone', value: payment.milestone?.title },
              ]}
            />
          </Panel>
          <Panel>
            <PanelHeader title="Activity" />
            <AuditFeed entries={activity} emptyTitle="No activity on this payment yet" />
          </Panel>
        </div>
      </div>
    </>
  );
}
