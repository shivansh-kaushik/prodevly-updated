import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { DataToolbar } from '@/components/admin/data-toolbar';
import { ExportButton } from '@/components/admin/export-button';
import { PageHeader } from '@/components/admin/page-header';
import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { PAYOUT_STATUSES } from '@/config/statuses';
import { humanize } from '@/lib/admin/format';
import { first, parseListParams, withParams, type RawSearchParams } from '@/lib/admin/search-params';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { PAYOUT_SORTS, parsePayoutFilter, type PayoutSort } from '@/lib/validation/third-party-payout';
import { getProjectOption, searchPayouts } from '@/services/third-party-payout.service';
import { getThirdPartyOption } from '@/services/third-party.service';
import { PATHS } from '../_components/labels';
import { PayoutTable } from '../_components/payout-table';
import { SectionNav } from '../_components/section-nav';

export const metadata: Metadata = { title: 'Third-party payouts' };

export default async function PayoutsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage(PATHS.payouts, { capability: 'payout:view' });
  const sp = await searchParams;
  const list = parseListParams(sp, { sortable: PAYOUT_SORTS, defaultSort: 'createdAt', defaultDir: 'desc' });
  const filter = parsePayoutFilter(sp);
  const canRecord = viewer.capabilities.has('payout:record');
  const canExport = viewer.capabilities.has('export:data');

  const [payouts, party, project] = await Promise.all([
    searchPayouts(viewer, { ...filter, sort: list.sort as PayoutSort, dir: list.dir, page: list.page, pageSize: list.pageSize }),
    filter.thirdPartyId ? getThirdPartyOption(viewer, filter.thirdPartyId).catch(() => null) : Promise.resolve(null),
    filter.projectId ? getProjectOption(viewer, filter.projectId) : Promise.resolve(null),
  ]);
  const filtered = Boolean(filter.q || filter.status || filter.overdue || filter.thirdPartyId || filter.workOrderId || filter.projectId || filter.clientId);
  const newParams = new URLSearchParams();
  if (filter.thirdPartyId) newParams.set('thirdParty', filter.thirdPartyId);
  if (filter.workOrderId) newParams.set('workOrder', filter.workOrderId);
  const newHref = `${PATHS.payouts}/new${newParams.size ? `?${newParams}` : ''}`;
  const narrowedBy = [party ? `third party ${party.label}` : null, project ? `project ${project.label}` : null, filter.workOrderId ? 'one work order' : null, filter.clientId ? 'one client' : null].filter(Boolean);

  return (
    <>
      <PageHeader
        title="Third-party payouts"
        description="What we owe and what we have paid. A payout is recorded as due; a superadmin marks it paid or voids it."
        actions={
          canRecord || canExport ? (
            <>
              <ExportButton section="third-party-payouts" params={sp} canExport={canExport} />
              {canRecord ? <LinkButton href={newHref} variant="primary"><Plus className="size-4" aria-hidden /> Record a payout</LinkButton> : null}
            </>
          ) : undefined
        }
      />
      <SectionNav active="payouts" showMoney />

      {narrowedBy.length > 0 ? (
        <p className="mb-3 text-[14px] text-pd-ink-2">
          Showing payouts for {narrowedBy.join(', ')}.{' '}
          <Link href={withParams(PATHS.payouts, sp, { thirdParty: undefined, project: undefined, workOrder: undefined, client: undefined })} className="underline underline-offset-2">Show all</Link>
        </p>
      ) : null}

      <DataToolbar
        searchPlaceholder="Search reference, third party or transaction"
        filters={[
          { key: 'status', label: 'Status', allLabel: 'Any status', options: PAYOUT_STATUSES.map((s) => ({ value: s, label: humanize(s) })) },
          { key: 'overdue', label: 'Due date', allLabel: 'Any due date', options: [{ value: '1', label: 'Overdue only' }] },
        ]}
      />

      {payouts.items.length === 0 ? (
        <div className="rounded-pd-md bg-pd-leaf shadow-[0_0_0_1px_var(--color-pd-rule)]">
          <EmptyState
            title={filtered || first(sp, 'q') ? 'No payouts match' : 'No payouts yet'}
            body={filtered ? 'Try a different search or clear the filters.' : canRecord ? 'Record a payout when you owe a third party money.' : 'Payouts appear here once they are recorded.'}
            action={
              filtered ? (
                <Link href={PATHS.payouts} className="text-[14px] underline">Clear filters</Link>
              ) : canRecord ? (
                <LinkButton href={newHref} variant="primary">Record the first payout</LinkButton>
              ) : undefined
            }
            className="py-12"
          />
        </div>
      ) : (
        <>
          <PayoutTable items={payouts.items} params={sp} sort={list.sort} dir={list.dir} />
          <Pagination meta={payouts.meta} path={PATHS.payouts} params={sp} noun="payouts" />
        </>
      )}
    </>
  );
}

