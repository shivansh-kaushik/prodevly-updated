import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditFeed } from '@/components/admin/audit-feed';
import { PageHeader } from '@/components/admin/page-header';
import { StatBand } from '@/components/admin/stat-band';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { DescriptionList, Panel, PanelHeader } from '@/components/ui/panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { TabLinks } from '@/components/ui/tabs';
import { formatCount, formatDateTime, formatInr, humanize } from '@/lib/admin/format';
import { oneOf, type RawSearchParams } from '@/lib/admin/search-params';
import { AppError } from '@/lib/api/errors';
import { getCurrentAdmin, requireAdminPage } from '@/lib/auth/page-guard';
import { parseObjectId } from '@/lib/validation/common';
import { getActivity } from '@/services/activity.service';
import { getSettings } from '@/services/settings.service';
import { getThirdParty, type ThirdPartyDTO } from '@/services/third-party.service';
import { searchPayouts } from '@/services/third-party-payout.service';
import { searchWorkOrders } from '@/services/work-order.service';
import { thirdPartyFormInitial } from '../_components/form-initials';
import { PATHS } from '../_components/labels';
import { PaymentNotePanel } from '../_components/payment-note-panel';
import { PayoutTable } from '../_components/payout-table';
import { ThirdPartyActions } from '../_components/third-party-actions';
import { WorkOrderTable } from '../_components/work-order-table';

/** A missing or malformed id is a 404; anything else (the database is down) is a real error. */
async function loadOrNull(load: () => Promise<ThirdPartyDTO>): Promise<ThirdPartyDTO | null> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ thirdPartyId: string }> }): Promise<Metadata> {
  const { admin } = await getCurrentAdmin();
  if (!admin) return { title: 'Third party' };
  const party = await loadOrNull(async () => getThirdParty(admin, (await params).thirdPartyId)).catch(() => null);
  return { title: party?.name ?? 'Third party' };
}

export default async function ThirdPartyPage({ params, searchParams }: { params: Promise<{ thirdPartyId: string }>; searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage(PATHS.directory, { capability: 'thirdParty:view' });
  const id = parseObjectId((await params).thirdPartyId);
  const sp = await searchParams;
  const party = await loadOrNull(() => getThirdParty(viewer, id));
  if (!party) notFound();

  const caps = viewer.capabilities;
  const showMoney = caps.has('payout:view');
  const canEdit = caps.has('thirdParty:edit');
  const canRecord = caps.has('payout:record');
  const tabs = [
    { key: 'overview', label: 'Overview' },
    ...(showMoney ? [{ key: 'work-orders', label: 'Work orders', count: party.money?.openWorkOrders }, { key: 'payouts', label: 'Payouts' }] : []),
    { key: 'activity', label: 'Activity' },
  ];
  const tab = oneOf(sp, 'tab', tabs.map((t) => t.key)) ?? 'overview';
  const base = `${PATHS.directory}/${party.id}`;
  const settings = await getSettings();

  let body: React.ReactNode;
  if (tab === 'work-orders' && showMoney) {
    const orders = await searchWorkOrders(viewer, { thirdPartyId: party.id, pageSize: 50 });
    body = (
      <div className="flex flex-col gap-4">
        {canRecord && !party.archived ? <div><LinkButton href={`${PATHS.workOrders}/new?thirdParty=${party.id}`} variant="secondary">Raise a work order</LinkButton></div> : null}
        {orders.items.length === 0 ? (
          <div className="rounded-pd-md bg-pd-leaf shadow-[0_0_0_1px_var(--color-pd-rule)]"><EmptyState title="No work orders yet" body="A work order records what we agreed to pay this third party for a client's project." className="py-10" /></div>
        ) : (
          <>
            <WorkOrderTable items={orders.items} params={sp} linkThirdParty={false} />
            {orders.meta.total > orders.items.length ? <p className="text-[12px] text-pd-ink-3">Showing {orders.items.length} of {formatCount(orders.meta.total)}. <Link href={`${PATHS.workOrders}?thirdParty=${party.id}`} className="underline">See them all</Link></p> : null}
          </>
        )}
      </div>
    );
  } else if (tab === 'payouts' && showMoney) {
    const payouts = await searchPayouts(viewer, { thirdPartyId: party.id, pageSize: 50 });
    body = (
      <div className="flex flex-col gap-4">
        {canRecord && !party.archived ? <div><LinkButton href={`${PATHS.payouts}/new?thirdParty=${party.id}`} variant="secondary">Record a payout</LinkButton></div> : null}
        {payouts.items.length === 0 ? (
          <div className="rounded-pd-md bg-pd-leaf shadow-[0_0_0_1px_var(--color-pd-rule)]"><EmptyState title="No payouts yet" body="Payouts record what we owe this third party and what we have paid." className="py-10" /></div>
        ) : (
          <>
            <PayoutTable items={payouts.items} params={sp} linkThirdParty={false} />
            {payouts.meta.total > payouts.items.length ? <p className="text-[12px] text-pd-ink-3">Showing {payouts.items.length} of {formatCount(payouts.meta.total)}. <Link href={`${PATHS.payouts}?thirdParty=${party.id}`} className="underline">See them all</Link></p> : null}
          </>
        )}
      </div>
    );
  } else if (tab === 'activity') {
    body = (
      <Panel>
        <AuditFeed entries={await getActivity({ entityType: 'thirdParty', entityId: party.id }, { limit: 40 })} emptyTitle="No activity on this third party yet" />
      </Panel>
    );
  } else {
    body = (
      <div className="flex flex-col gap-6">
        {party.money ? (
          <StatBand
            stats={[
              { label: 'Paid, all time', value: formatInr(party.money.paidInr), sub: `${formatCount(party.money.paidCount)} ${party.money.paidCount === 1 ? 'payout' : 'payouts'}` },
              { label: 'Due now', value: formatInr(party.money.dueInr), sub: `${formatCount(party.money.dueCount)} ${party.money.dueCount === 1 ? 'payout' : 'payouts'}`, attention: party.money.dueCount > 0 },
              { label: 'Open work orders', value: formatCount(party.money.openWorkOrders), sub: 'Open or delivered' },
            ]}
          />
        ) : null}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Panel>
            <PanelHeader title="Details" />
            <DescriptionList
              items={[
                { label: 'Type', value: humanize(party.type) },
                { label: 'Contact', value: party.contactName },
                { label: 'Email', value: party.email ? <a href={`mailto:${party.email}`} className="underline underline-offset-2">{party.email}</a> : null },
                { label: 'Phone', value: party.phone },
                { label: 'Country', value: party.country },
                { label: 'Usual currency', value: party.defaultCurrency },
                { label: 'GSTIN', value: party.gstin },
                { label: 'Skills', value: party.skills.length ? <span className="flex flex-wrap gap-1">{party.skills.map((s) => <Badge key={s}>{s}</Badge>)}</span> : null },
                { label: 'Added', value: `${formatDateTime(party.createdAt)}${party.createdBy ? ` by ${party.createdBy}` : ''}` },
                ...(party.archivedAt ? [{ label: 'Archived', value: `${formatDateTime(party.archivedAt)}${party.archivedBy ? ` by ${party.archivedBy}` : ''}` }] : []),
              ]}
            />
            {party.notes ? <p className="mt-4 border-t border-pd-rule-soft pt-3 text-[14px] leading-5 whitespace-pre-wrap text-pd-ink-2">{party.notes}</p> : null}
          </Panel>
          {party.payDetails ? <PaymentNotePanel id={party.id} note={party.payDetails.note} canEdit={canEdit && !party.archived} /> : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={party.name}
        description={party.contactName ?? party.email ?? undefined}
        crumbs={[{ label: 'Third parties', href: PATHS.directory }, { label: party.name }]}
        meta={
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-pd-mono text-[12px] text-pd-ink-3">{party.ref}</span>
            <StatusBadge status={party.status} />
            {party.archived ? <Badge>Archived</Badge> : null}
          </span>
        }
        actions={
          canEdit ? (
            <ThirdPartyActions
              form={thirdPartyFormInitial(party)}
              name={party.name}
              archived={party.archived}
              types={settings.thirdPartyTypes}
              currencies={settings.enabledCurrencies}
              canPayDetails={caps.has('thirdParty:payDetails')}
            />
          ) : undefined
        }
      />
      <div className="mb-6">
        <TabLinks tabs={tabs} active={tab} path={base} params={sp} />
      </div>
      {body}
    </>
  );
}
