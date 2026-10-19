import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Paperclip } from 'lucide-react';
import { AuditFeed } from '@/components/admin/audit-feed';
import { formatNative } from '@/components/admin/money';
import { PageHeader } from '@/components/admin/page-header';
import { StatBand, type Stat } from '@/components/admin/stat-band';
import { Badge } from '@/components/ui/badge';
import { DescriptionList, Panel, PanelHeader } from '@/components/ui/panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDate, formatDateTime, formatInr, humanize } from '@/lib/admin/format';
import { formatBytes } from '@/lib/media/rules';
import { AppError } from '@/lib/api/errors';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { getCurrentAdmin, requireAdminPage } from '@/lib/auth/page-guard';
import { parseObjectId } from '@/lib/validation/common';
import { getActivity } from '@/services/activity.service';
import { getSettings } from '@/services/settings.service';
import { getPayout, type PayoutDTO } from '@/services/third-party-payout.service';
import { captureText, payoutFormInitial } from '../../_components/form-initials';
import { PATHS } from '../../_components/labels';
import { PayoutActions } from '../../_components/payout-actions';

async function loadOrNull(load: () => Promise<PayoutDTO>): Promise<PayoutDTO | null> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ payoutId: string }> }): Promise<Metadata> {
  const { admin } = await getCurrentAdmin();
  if (!admin || !admin.capabilities.has('payout:view')) return { title: 'Payout' };
  const payout = await loadOrNull(async () => getPayout(admin, (await params).payoutId)).catch(() => null);
  return { title: payout?.ref ?? 'Payout' };
}

export default async function PayoutPage({ params }: { params: Promise<{ payoutId: string }> }) {
  const viewer = await requireAdminPage(PATHS.payouts, { capability: 'payout:view' });
  const id = parseObjectId((await params).payoutId);
  const payout = await loadOrNull(() => getPayout(viewer, id));
  if (!payout) notFound();

  const caps = viewer.capabilities;
  const [settings, activity] = await Promise.all([getSettings(), getActivity({ entityType: 'thirdPartyPayout', entityId: payout.id }, { limit: 30 })]);
  const today = formatDateOnly(todayDateOnly(new Date(), settings.timezone));
  const { amount } = payout;
  const foreign = amount.currency !== 'INR';
  const stats: Stat[] = [
    { label: 'Amount', value: formatNative(amount.amountMinor, amount.currency), sub: foreign ? `${amount.fxSource === 'identity' ? 'INR' : humanize(amount.fxSource)} rate ${amount.fxRate}` : undefined },
    { label: 'In INR', value: formatInr(amount.inrMinor), sub: foreign ? `Captured for ${formatDate(amount.fxDate)}` : 'No conversion' },
    payout.status === 'paid'
      ? { label: 'Paid on', value: formatDate(payout.paidOn), sub: payout.mode ? humanize(payout.mode) : undefined }
      : { label: payout.overdue ? 'Overdue since' : 'Due on', value: payout.dueOn ? formatDate(payout.dueOn) : 'No date', attention: payout.overdue },
  ];
  if (payout.tdsMinor) stats.push({ label: 'TDS withheld', value: formatNative(payout.tdsMinor, amount.currency), sub: 'Part of the amount' });

  return (
    <>
      <PageHeader
        title={payout.ref}
        description={
          <>
            To <Link href={`${PATHS.directory}/${payout.thirdPartyId}`} prefetch={false} className="underline underline-offset-2">{payout.thirdPartyName}</Link> for {payout.projectName}
          </>
        }
        crumbs={[{ label: 'Third parties', href: PATHS.directory }, { label: 'Payouts', href: PATHS.payouts }, { label: payout.ref }]}
        meta={
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={payout.status} />
            {payout.overdue ? <Badge tone="rubric">Overdue</Badge> : null}
          </span>
        }
        actions={
          <PayoutActions
            payout={{ id: payout.id, ref: payout.ref, thirdPartyName: payout.thirdPartyName, amountMinor: amount.amountMinor, currency: amount.currency, capture: captureText(payout) }}
            status={payout.status}
            form={payoutFormInitial(payout)}
            currencies={settings.enabledCurrencies}
            modes={settings.paymentModes}
            today={today}
            can={{ edit: caps.has('payout:record'), approve: caps.has('money:approve'), void: caps.has('money:void') }}
          />
        }
      />

      <div className="flex flex-col gap-6">
        <StatBand stats={stats} />
        {payout.status === 'void' ? (
          <Panel className="pd-margin-flag">
            <PanelHeader title="Void" hint="This payout counts nowhere. It stays on record." />
            <p className="text-[14px] text-pd-ink-2"><span className="font-medium text-pd-ink">{payout.voidedBy ?? 'A superadmin'}</span> voided it: {payout.voidReason}</p>
          </Panel>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="flex flex-col gap-6">
            <Panel>
              <PanelHeader title="Details" />
              <DescriptionList
                items={[
                  { label: 'Third party', value: <Link href={`${PATHS.directory}/${payout.thirdPartyId}`} prefetch={false} className="underline underline-offset-2">{payout.thirdPartyName}</Link> },
                  { label: 'Work order', value: payout.workOrderId ? <Link href={`${PATHS.workOrders}/${payout.workOrderId}`} prefetch={false} className="underline underline-offset-2"><span className="font-pd-mono text-[13px]">{payout.workOrderRef}</span> {payout.workOrderTitle}</Link> : 'None: a one-off payout' },
                  { label: 'Client', value: caps.has('client:view') ? <Link href={`/admin/clients/${payout.clientId}`} prefetch={false} className="underline underline-offset-2">{payout.clientName}</Link> : payout.clientName },
                  { label: 'Project', value: caps.has('project:view') ? <Link href={`/admin/projects/${payout.projectId}`} prefetch={false} className="underline underline-offset-2">{payout.projectName}</Link> : payout.projectName },
                  { label: 'Task', value: payout.taskId ? (caps.has('task:view') ? <Link href={`/admin/tasks/${payout.taskId}`} prefetch={false} className="underline underline-offset-2">{payout.taskRef} {payout.taskTitle}</Link> : `${payout.taskRef} ${payout.taskTitle}`) : null },
                  { label: 'Exchange rate', value: foreign ? captureText(payout) : 'INR: no conversion' },
                  { label: 'Due date', value: payout.dueOn ? formatDate(payout.dueOn) : null },
                  { label: 'Paid on', value: payout.paidOn ? formatDate(payout.paidOn) : null },
                  { label: 'Paid by', value: payout.mode ? humanize(payout.mode) : null },
                  { label: 'Transaction reference', value: payout.transactionRef ? <span className="font-pd-mono text-[13px]">{payout.transactionRef}</span> : null },
                  { label: 'Marked paid by', value: payout.paidBy },
                  { label: 'Recorded', value: `${formatDateTime(payout.createdAt)} by ${payout.recordedBy}` },
                ]}
              />
              {payout.note ? <p className="mt-4 border-t border-pd-rule-soft pt-3 text-[14px] leading-5 whitespace-pre-wrap text-pd-ink-2">{payout.note}</p> : null}
            </Panel>
            <Panel>
              <PanelHeader title="Attachments" hint="Private. Only people who can read payouts can open them." />
              {payout.attachments.length === 0 ? (
                <p className="text-[14px] text-pd-ink-3">No attachments.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {payout.attachments.map((a) => (
                    <li key={a.id}>
                      <a href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-pd-sm bg-pd-well px-3 py-1.5 text-[13px] text-pd-ink hover:underline">
                        <Paperclip className="size-3.5 text-pd-ink-3" aria-hidden />
                        {a.filename}
                        <span className="text-pd-ink-3">{formatBytes(a.size)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {payout.attachmentCount > payout.attachments.length ? <p className="mt-2 text-[12px] text-pd-ink-3">{payout.attachmentCount - payout.attachments.length} more you cannot open.</p> : null}
            </Panel>
          </div>
          <Panel>
            <PanelHeader title="Activity" hint="Includes the exchange rate captured when it was recorded." />
            <AuditFeed entries={activity} emptyTitle="No activity on this payout yet" />
          </Panel>
        </div>
      </div>
    </>
  );
}
