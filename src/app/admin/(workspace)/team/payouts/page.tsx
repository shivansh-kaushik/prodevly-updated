import type { Metadata } from 'next';
import { Plus } from 'lucide-react';
import { DataToolbar } from '@/components/admin/data-toolbar';
import { ExportButton } from '@/components/admin/export-button';
import { PageHeader } from '@/components/admin/page-header';
import { PeriodPicker } from '@/components/admin/period-picker';
import { LinkButton } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { getPeriod } from '@/lib/admin/period';
import { first, parseListParams, type RawSearchParams } from '@/lib/admin/search-params';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { PAYOUT_SORTS, parsePayoutFilter } from '@/lib/validation/team-payout';
import { getSettings } from '@/services/settings.service';
import { getPayoutTotals, searchTeamPayouts, type PayoutSort } from '@/services/team-payout.service';
import { getTeamMember } from '@/services/team.service';
import { PayoutTotalsBand } from './_components/payout-totals';
import { PayoutsTable, PAYOUTS_PATH, ClearFilters } from './_components/payouts-table';
import { PersonFilter } from './_components/person-filter';

export const metadata: Metadata = { title: 'Team payouts' };

export default async function TeamPayoutsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage(PAYOUTS_PATH, { capability: 'team:payView' });
  const sp = await searchParams;
  const period = await getPeriod(sp);
  const range = { from: period.from, to: period.to };
  const list = parseListParams(sp, { sortable: PAYOUT_SORTS, defaultSort: 'createdAt', defaultDir: 'desc' });
  const filter = parsePayoutFilter(sp);
  const settings = await getSettings();
  const today = formatDateOnly(todayDateOnly(new Date(), settings.timezone));

  const [totals, result, person] = await Promise.all([
    getPayoutTotals(viewer, range, { adminId: filter.adminId }),
    searchTeamPayouts(viewer, { ...filter, ...range, page: list.page, pageSize: list.pageSize, sort: list.sort as PayoutSort, dir: list.dir }),
    // The name for the person filter, so it shows who is selected even when they have no payouts.
    filter.adminId ? getTeamMember(viewer, filter.adminId, range).catch(() => null) : null,
  ]);
  const filtered = Boolean(filter.adminId || filter.status || filter.q);
  const canRecord = viewer.capabilities.has('teamPayout:record');
  const canExport = viewer.capabilities.has('export:data');

  return (
    <>
      <PageHeader
        title="Team payouts"
        description="What the team is owed and what has been paid. Marking a payout paid locks the time it covers."
        crumbs={[{ label: 'Team', href: '/admin/team' }, { label: 'Payouts' }]}
        actions={
          canRecord || canExport ? (
            <>
              <ExportButton section="team-payouts" params={sp} canExport={canExport} />
              {canRecord ? (
                <LinkButton href={`${PAYOUTS_PATH}/new${filter.adminId ? `?adminId=${filter.adminId}` : ''}`} variant="primary">
                  <Plus className="size-4" aria-hidden /> Record a payout
                </LinkButton>
              ) : null}
            </>
          ) : undefined
        }
      />

      <PayoutTotalsBand totals={totals} periodLabel={period.label} />

      <DataToolbar
        searchPlaceholder="Search person or reference"
        filters={[
          {
            key: 'status',
            label: 'Status',
            allLabel: 'Any status',
            options: [
              { value: 'due', label: 'Due' },
              { value: 'paid', label: 'Paid' },
              { value: 'void', label: 'Void' },
            ],
          },
        ]}
      >
        <PersonFilter current={person && filter.adminId ? { id: filter.adminId, label: person.name } : null} />
        <PeriodPicker current={period.key} from={first(sp, 'from')} to={first(sp, 'to')} />
      </DataToolbar>

      <PayoutsTable
        payouts={result.items}
        today={today}
        sort={{ params: sp, active: list.sort, dir: list.dir }}
        empty={{
          title: filtered ? 'No payouts match' : 'No payouts in this period',
          body: filtered
            ? 'Try a different search, person or period, or clear the filters.'
            : canRecord
              ? 'A payout is dated by when it was paid, or by its due date until it is. Pick another period, or record the first one.'
              : 'A payout is dated by when it was paid, or by its due date until it is. Pick another period.',
          action: filtered ? <ClearFilters /> : canRecord ? <LinkButton href={`${PAYOUTS_PATH}/new`} variant="secondary">Record a payout</LinkButton> : undefined,
        }}
      />
      <Pagination meta={result.meta} path={PAYOUTS_PATH} params={sp} noun="payouts" />
    </>
  );
}
