import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { DataToolbar } from '@/components/admin/data-toolbar';
import { ExportButton } from '@/components/admin/export-button';
import { PageHeader } from '@/components/admin/page-header';
import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { WORK_ORDER_STATUSES } from '@/config/statuses';
import { humanize } from '@/lib/admin/format';
import { first, parseListParams, withParams, type RawSearchParams } from '@/lib/admin/search-params';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { WORK_ORDER_SORTS, parseWorkOrderFilter, type WorkOrderSort } from '@/lib/validation/work-order';
import { getProjectOption } from '@/services/third-party-payout.service';
import { getThirdPartyOption } from '@/services/third-party.service';
import { searchWorkOrders } from '@/services/work-order.service';
import { PATHS } from '../_components/labels';
import { SectionNav } from '../_components/section-nav';
import { WorkOrderTable } from '../_components/work-order-table';

export const metadata: Metadata = { title: 'Work orders' };

export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage(PATHS.workOrders, { capability: 'payout:view' });
  const sp = await searchParams;
  const list = parseListParams(sp, { sortable: WORK_ORDER_SORTS, defaultSort: 'updatedAt', defaultDir: 'desc' });
  const filter = parseWorkOrderFilter(sp);
  const canRecord = viewer.capabilities.has('payout:record');
  const canExport = viewer.capabilities.has('export:data');

  const [orders, party, project] = await Promise.all([
    searchWorkOrders(viewer, { ...filter, sort: list.sort as WorkOrderSort, dir: list.dir, page: list.page, pageSize: list.pageSize }),
    filter.thirdPartyId ? getThirdPartyOption(viewer, filter.thirdPartyId).catch(() => null) : Promise.resolve(null),
    filter.projectId ? getProjectOption(viewer, filter.projectId) : Promise.resolve(null),
  ]);
  const filtered = Boolean(filter.q || filter.status || filter.thirdPartyId || filter.projectId || filter.clientId);
  const newParams = new URLSearchParams();
  if (filter.thirdPartyId) newParams.set('thirdParty', filter.thirdPartyId);
  if (filter.projectId) newParams.set('project', filter.projectId);
  const newHref = `${PATHS.workOrders}/new${newParams.size ? `?${newParams}` : ''}`;
  const narrowedBy = [party ? `third party ${party.label}` : null, project ? `project ${project.label}` : null, filter.clientId ? 'one client' : null].filter(Boolean);

  return (
    <>
      <PageHeader
        title="Work orders"
        description="What we agreed to pay a third party for a client's project. Paid and due follow the payouts recorded against each one."
        actions={
          canRecord || canExport ? (
            <>
              <ExportButton section="work-orders" params={sp} canExport={canExport} />
              {canRecord ? <LinkButton href={newHref} variant="primary"><Plus className="size-4" aria-hidden /> New work order</LinkButton> : null}
            </>
          ) : undefined
        }
      />
      <SectionNav active="work-orders" showMoney />

      {narrowedBy.length > 0 ? (
        <p className="mb-3 text-[14px] text-pd-ink-2">
          Showing work orders for {narrowedBy.join(', ')}.{' '}
          <Link href={withParams(PATHS.workOrders, sp, { thirdParty: undefined, project: undefined, client: undefined })} className="underline underline-offset-2">Show all</Link>
        </p>
      ) : null}

      <DataToolbar
        searchPlaceholder="Search title, reference or third party"
        filters={[
          {
            key: 'status',
            label: 'Status',
            allLabel: 'Any status',
            options: [{ value: 'current', label: 'Open or delivered' }, ...WORK_ORDER_STATUSES.map((s) => ({ value: s, label: humanize(s) }))],
          },
        ]}
      />

      {orders.items.length === 0 ? (
        <div className="rounded-pd-md bg-pd-leaf shadow-[0_0_0_1px_var(--color-pd-rule)]">
          <EmptyState
            title={filtered || first(sp, 'q') ? 'No work orders match' : 'No work orders yet'}
            body={filtered ? 'Try a different search or clear the filters.' : canRecord ? 'Raise a work order to record what you agreed to pay a third party for a project.' : 'Work orders appear here once they are raised.'}
            action={
              filtered ? (
                <Link href={PATHS.workOrders} className="text-[14px] underline">Clear filters</Link>
              ) : canRecord ? (
                <LinkButton href={newHref} variant="primary">Raise the first work order</LinkButton>
              ) : undefined
            }
            className="py-12"
          />
        </div>
      ) : (
        <>
          <WorkOrderTable items={orders.items} params={sp} sort={list.sort} dir={list.dir} />
          <Pagination meta={orders.meta} path={PATHS.workOrders} params={sp} noun="work orders" />
        </>
      )}
    </>
  );
}
