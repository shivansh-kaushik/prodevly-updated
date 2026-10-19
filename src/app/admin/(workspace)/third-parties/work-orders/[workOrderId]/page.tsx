import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditFeed } from '@/components/admin/audit-feed';
import { formatNative } from '@/components/admin/money';
import { PageHeader } from '@/components/admin/page-header';
import { StatBand } from '@/components/admin/stat-band';
import { StatusHistory } from '@/components/admin/status-history';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { DescriptionList, Panel, PanelHeader } from '@/components/ui/panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDate, formatDateTime } from '@/lib/admin/format';
import { AppError } from '@/lib/api/errors';
import { getCurrentAdmin, requireAdminPage } from '@/lib/auth/page-guard';
import { parseObjectId } from '@/lib/validation/common';
import { isCurrentStatus, getWorkOrder, type WorkOrderDTO } from '@/services/work-order.service';
import { getActivity } from '@/services/activity.service';
import { getSettings } from '@/services/settings.service';
import { searchPayouts } from '@/services/third-party-payout.service';
import { workOrderFormInitial } from '../../_components/form-initials';
import { PATHS } from '../../_components/labels';
import { PayoutTable } from '../../_components/payout-table';
import { WorkOrderActions } from '../../_components/work-order-actions';

async function loadOrNull(load: () => Promise<WorkOrderDTO>): Promise<WorkOrderDTO | null> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ workOrderId: string }> }): Promise<Metadata> {
  const { admin } = await getCurrentAdmin();
  if (!admin || !admin.capabilities.has('payout:view')) return { title: 'Work order' };
  const order = await loadOrNull(async () => getWorkOrder(admin, (await params).workOrderId)).catch(() => null);
  return { title: order?.title ?? 'Work order' };
}

export default async function WorkOrderPage({ params }: { params: Promise<{ workOrderId: string }> }) {
  const viewer = await requireAdminPage(PATHS.workOrders, { capability: 'payout:view' });
  const id = parseObjectId((await params).workOrderId);
  const order = await loadOrNull(() => getWorkOrder(viewer, id));
  if (!order) notFound();

  const caps = viewer.capabilities;
  const [payouts, activity, settings] = await Promise.all([
    searchPayouts(viewer, { workOrderId: order.id, sort: 'createdAt', dir: 'desc', pageSize: 100 }),
    getActivity({ entityType: 'workOrder', entityId: order.id }, { limit: 30 }),
    getSettings(),
  ]);
  const hasPayouts = payouts.items.some((p) => p.status !== 'void');
  const cur = order.agreed.currency;
  const current = isCurrentStatus(order.status);
  const over = order.balanceMinor < 0;

  return (
    <>
      <PageHeader
        title={order.title}
        description={
          <>
            For <Link href={`${PATHS.directory}/${order.thirdPartyId}`} prefetch={false} className="underline underline-offset-2">{order.thirdPartyName}</Link> on {order.projectName}
          </>
        }
        crumbs={[{ label: 'Third parties', href: PATHS.directory }, { label: 'Work orders', href: PATHS.workOrders }, { label: order.ref }]}
        meta={
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-pd-mono text-[12px] text-pd-ink-3">{order.ref}</span>
            <StatusBadge status={order.status} />
            {order.overdue ? <Badge tone="rubric">Overdue</Badge> : null}
          </span>
        }
        actions={
          <>
            {caps.has('payout:record') && current ? <LinkButton href={`${PATHS.payouts}/new?workOrder=${order.id}`} variant="secondary">Record a payout</LinkButton> : null}
            <WorkOrderActions
              order={{ id: order.id, title: order.title, status: order.status }}
              form={workOrderFormInitial(order, hasPayouts)}
              currencies={settings.enabledCurrencies}
              canEdit={caps.has('payout:record')}
            />
          </>
        }
      />

      <div className="flex flex-col gap-6">
        <StatBand
          stats={[
            { label: 'Agreed', value: formatNative(order.agreed.amountMinor, cur) },
            { label: 'Paid', value: formatNative(order.paidMinor, cur), sub: 'Payouts marked paid' },
            { label: 'Due', value: formatNative(order.dueMinor, cur), sub: 'Recorded, not yet paid' },
            {
              label: over ? 'Over the agreed amount' : 'Balance',
              value: formatNative(Math.abs(order.balanceMinor), cur),
              sub: over ? 'Paid and due add up to more than was agreed' : 'Agreed, not yet paid or due',
              attention: over,
            },
          ]}
        />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex flex-col gap-6">
            <Panel flush>
              <div className="px-5 pt-5"><PanelHeader title="Payouts" hint="Void payouts stay visible and count for nothing." /></div>
              {payouts.items.length === 0 ? (
                <EmptyState
                  title="No payouts yet"
                  body={current && caps.has('payout:record') ? 'Record a payout when a part of this work order falls due.' : 'Payouts recorded against this work order appear here.'}
                  className="py-8"
                />
              ) : (
                <PayoutTable items={payouts.items} params={{}} linkThirdParty={false} showWorkOrder={false} />
              )}
            </Panel>
            <Panel>
              <PanelHeader title="Activity" />
              <AuditFeed entries={activity} emptyTitle="No activity on this work order yet" />
            </Panel>
          </div>
          <div className="flex flex-col gap-6">
            <Panel>
              <PanelHeader title="Details" />
              <DescriptionList
                columns={1}
                items={[
                  { label: 'Third party', value: <Link href={`${PATHS.directory}/${order.thirdPartyId}`} prefetch={false} className="underline underline-offset-2">{order.thirdPartyName}</Link> },
                  { label: 'Client', value: caps.has('client:view') ? <Link href={`/admin/clients/${order.clientId}`} prefetch={false} className="underline underline-offset-2">{order.clientName}</Link> : order.clientName },
                  { label: 'Project', value: caps.has('project:view') ? <Link href={`/admin/projects/${order.projectId}`} prefetch={false} className="underline underline-offset-2">{order.projectName}</Link> : order.projectName },
                  { label: 'Task', value: order.taskId ? (caps.has('task:view') ? <Link href={`/admin/tasks/${order.taskId}`} prefetch={false} className="underline underline-offset-2">{order.taskRef} {order.taskTitle}</Link> : `${order.taskRef} ${order.taskTitle}`) : null },
                  { label: 'Due date', value: order.dueOn ? formatDate(order.dueOn) : null },
                  { label: 'Raised', value: `${formatDateTime(order.createdAt)}${order.createdBy ? ` by ${order.createdBy}` : ''}` },
                ]}
              />
              {order.scope ? <p className="mt-4 border-t border-pd-rule-soft pt-3 text-[14px] leading-5 whitespace-pre-wrap text-pd-ink-2">{order.scope}</p> : null}
            </Panel>
            <Panel>
              <PanelHeader title="Status history" />
              <StatusHistory items={order.statusHistory} />
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
