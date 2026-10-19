import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { DataToolbar } from '@/components/admin/data-toolbar';
import { PageHeader } from '@/components/admin/page-header';
import { PeriodPicker } from '@/components/admin/period-picker';
import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { formatDateOnly } from '@/lib/dates/date-only';
import { humanize } from '@/lib/admin/format';
import { getPeriod } from '@/lib/admin/period';
import { parseListParams, type RawSearchParams } from '@/lib/admin/search-params';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { THIRD_PARTY_SORTS, parseThirdPartyFilter, type ThirdPartySort } from '@/lib/validation/third-party';
import { getThirdPartiesDashboard } from '@/services/dashboards/third-parties';
import { getSettings } from '@/services/settings.service';
import { searchThirdParties } from '@/services/third-party.service';
import { PayoutCharts, TypePanel } from './_components/dashboard-charts';
import { ThirdPartiesStatBand } from './_components/dashboard-stats';
import { PATHS } from './_components/labels';
import { OpenWorkOrdersTable } from './_components/open-work-orders-table';
import { SectionNav } from './_components/section-nav';
import { ThirdPartyTable } from './_components/third-party-table';

export const metadata: Metadata = { title: 'Third parties' };

export default async function ThirdPartiesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage(PATHS.directory, { capability: 'thirdParty:view' });
  const sp = await searchParams;
  const period = await getPeriod(sp);
  const list = parseListParams(sp, { sortable: THIRD_PARTY_SORTS, defaultSort: 'name', defaultDir: 'asc' });
  const filter = parseThirdPartyFilter(sp);
  const canEdit = viewer.capabilities.has('thirdParty:edit');
  const showMoney = viewer.capabilities.has('payout:view');

  const [settings, dashboard, directory] = await Promise.all([
    getSettings(),
    getThirdPartiesDashboard(viewer, { from: period.from, to: period.to }),
    searchThirdParties(viewer, { ...filter, sort: list.sort as ThirdPartySort, dir: list.dir, page: list.page, pageSize: list.pageSize }),
  ]);
  const filtered = Boolean(filter.q || filter.type || filter.status || filter.archived);
  const types = filter.type && !settings.thirdPartyTypes.includes(filter.type) ? [filter.type, ...settings.thirdPartyTypes] : settings.thirdPartyTypes;

  return (
    <>
      <PageHeader
        title="Third parties"
        description="Freelancers, agencies and vendors we pay: who they are, what we agreed and what we have paid."
        actions={canEdit ? <LinkButton href={`${PATHS.directory}/new`} variant="primary"><Plus className="size-4" aria-hidden /> New third party</LinkButton> : undefined}
      />
      <SectionNav active="directory" showMoney={showMoney} />

      <ThirdPartiesStatBand dashboard={dashboard} periodLabel={period.label} />
      {dashboard.money ? (
        <>
          <PayoutCharts money={dashboard.money} periodLabel={period.label} />
          <OpenWorkOrdersTable open={dashboard.money.openWorkOrders} canRecord={viewer.capabilities.has('payout:record')} />
        </>
      ) : (
        <TypePanel dashboard={dashboard} />
      )}

      <DataToolbar
        searchPlaceholder="Search name, reference, email or contact"
        filters={[
          { key: 'type', label: 'Type', allLabel: 'All types', options: types.map((t) => ({ value: t, label: humanize(t) })) },
          { key: 'status', label: 'Status', allLabel: 'Any status', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
          { key: 'archived', label: 'Archived', allLabel: 'Hide archived', options: [{ value: 'include', label: 'Include archived' }, { value: 'only', label: 'Archived only' }] },
        ]}
      >
        {showMoney ? <PeriodPicker current={period.key} from={period.key === 'custom' ? formatDateOnly(period.from) : undefined} to={period.key === 'custom' ? formatDateOnly(period.to) : undefined} /> : null}
      </DataToolbar>
      {showMoney ? <p className="-mt-2 mb-3 text-[12px] text-pd-ink-3">The period drives the figures and charts above. The directory below shows every third party that matches the filters.</p> : null}

      {directory.items.length === 0 ? (
        <div className="rounded-pd-md bg-pd-leaf shadow-[0_0_0_1px_var(--color-pd-rule)]">
          <EmptyState
            title={filtered ? 'No third parties match' : 'No third parties yet'}
            body={filtered ? 'Try a different search or clear the filters.' : canEdit ? 'Add the first freelancer, agency or vendor you pay.' : 'Third parties appear here once they are added.'}
            action={
              filtered ? (
                <Link href={PATHS.directory} className="text-[14px] underline">Clear filters</Link>
              ) : canEdit ? (
                <LinkButton href={`${PATHS.directory}/new`} variant="primary">Add the first third party</LinkButton>
              ) : undefined
            }
            className="py-12"
          />
        </div>
      ) : (
        <>
          <ThirdPartyTable items={directory.items} params={sp} sort={list.sort} dir={list.dir} />
          <Pagination meta={directory.meta} path={PATHS.directory} params={sp} noun="third parties" />
        </>
      )}
    </>
  );
}
