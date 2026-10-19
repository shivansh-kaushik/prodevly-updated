import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { DataToolbar } from '@/components/admin/data-toolbar';
import { ExportButton } from '@/components/admin/export-button';
import { PageHeader } from '@/components/admin/page-header';
import { PeriodPicker } from '@/components/admin/period-picker';
import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { PAYMENT_STATUSES, PAYMENT_TYPES } from '@/config/statuses';
import { formatInr } from '@/lib/admin/format';
import { getPeriod } from '@/lib/admin/period';
import { first, parseListParams, withParams, type RawSearchParams } from '@/lib/admin/search-params';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { formatDateOnly } from '@/lib/dates/date-only';
import { PAYMENT_SORT_KEYS, parsePaymentFilters, type PaymentSortKey } from '@/lib/validation/payment';
import { getFilterLabels, searchPayments } from '@/services/client-payment.service';
import { getPaymentsDashboard } from '@/services/dashboards/payments';
import { getSettings } from '@/services/settings.service';
import { ReceivedByCurrencyPanel, ReceivedByModeChart, ReceivedPerMonthChart } from './_components/payments-charts';
import { PaymentsStatBand } from './_components/payments-stat-band';
import { PaymentsTable } from './_components/payments-table';
import { OutstandingPanel } from './_components/outstanding-panel';
import { ScopeFilters } from './_components/scope-filters';
import { UpcomingMilestones } from './_components/upcoming-milestones';
import { modeLabel, TYPE_LABELS } from './_components/labels';

export const metadata: Metadata = { title: 'Client payments' };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage('/admin/payments', { capability: 'payment:view' });
  const sp = await searchParams;
  const period = await getPeriod(sp);
  const list = parseListParams(sp, { sortable: PAYMENT_SORT_KEYS, defaultSort: 'receivedOn', defaultDir: 'desc' });
  const filters = parsePaymentFilters(sp);
  const canRecord = viewer.capabilities.has('payment:record');
  const canExport = viewer.capabilities.has('export:data');

  const [settings, dashboard, page, labels] = await Promise.all([
    getSettings(),
    getPaymentsDashboard(viewer, period, { clientId: filters.clientId, projectId: filters.projectId }),
    searchPayments(viewer, {
      ...filters,
      from: period.from,
      to: period.to,
      sort: list.sort as PaymentSortKey,
      dir: list.dir,
      page: list.page,
      pageSize: list.pageSize,
    }),
    getFilterLabels(viewer, filters),
  ]);
  const filtered = Boolean(filters.q || filters.clientId || filters.projectId || filters.status || filters.type || filters.mode || filters.currency);
  const newHref = filters.projectId ? `/admin/payments/new?projectId=${filters.projectId}` : '/admin/payments/new';
  // A mode that Settings no longer lists can still be on old entries: keep it filterable.
  const modes = filters.mode && !settings.paymentModes.includes(filters.mode) ? [...settings.paymentModes, filters.mode] : settings.paymentModes;
  const { summary } = page;

  return (
    <>
      <PageHeader
        title="Client payments"
        description="Money received from clients, and refunds to them. A recorded receipt is final until it is voided."
        actions={
          canRecord || canExport ? (
            <>
              <ExportButton section="payments" params={sp} canExport={canExport} />
              {canRecord ? <LinkButton href={newHref} variant="primary"><Plus className="size-4" aria-hidden /> Record payment</LinkButton> : null}
            </>
          ) : undefined
        }
      />

      <PaymentsStatBand dashboard={dashboard} periodLabel={period.label} params={sp} />

      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ReceivedPerMonthChart dashboard={dashboard} periodLabel={period.label} />
        <ReceivedByModeChart dashboard={dashboard} />
      </div>
      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <ReceivedByCurrencyPanel dashboard={dashboard} />
        <OutstandingPanel outstanding={dashboard.outstanding} />
      </div>
      <div className="mb-8">
        <UpcomingMilestones upcoming={dashboard.upcoming} total={dashboard.dueSoon.count + dashboard.overdue.count} />
      </div>

      <ScopeFilters
        client={labels.client}
        project={labels.project}
        canPickClient={viewer.capabilities.has('client:view')}
        canPickProject={viewer.capabilities.has('project:view')}
      />
      <DataToolbar
        searchPlaceholder="Search reference, transaction or invoice"
        filters={[
          { key: 'status', label: 'Status', options: PAYMENT_STATUSES.map((s) => ({ value: s, label: s === 'void' ? 'Void' : 'Received' })) },
          { key: 'type', label: 'Type', options: PAYMENT_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] })) },
          { key: 'mode', label: 'Mode', options: modes.map((m) => ({ value: m, label: modeLabel(m) })) },
          { key: 'currency', label: 'Currency', options: settings.enabledCurrencies.map((c) => ({ value: c, label: c })) },
        ]}
      >
        <PeriodPicker current={period.key} from={period.key === 'custom' ? formatDateOnly(period.from) : undefined} to={period.key === 'custom' ? formatDateOnly(period.to) : undefined} />
      </DataToolbar>
      {(labels.client || labels.project) && !first(sp, 'q') ? (
        <p className="mb-3 -mt-2 text-[13px] text-pd-ink-2">
          Showing payments for <span className="font-medium text-pd-ink">{[labels.project?.label, labels.client?.label].filter(Boolean).join(', ')}</span>.{' '}
          <Link href={withParams('/admin/payments', sp, { client: undefined, project: undefined })} className="underline underline-offset-2">Show every client and project</Link>
        </p>
      ) : null}
      <p className="mb-3 -mt-2 text-[12px] text-pd-ink-3">The list and the figures above show {period.label.toLowerCase()}, by the date the money was received.</p>

      {page.items.length === 0 ? (
        <div className="rounded-pd-md bg-pd-leaf shadow-[0_0_0_1px_var(--color-pd-rule)]">
          <EmptyState
            title={filtered ? 'No payments match' : dashboard.hasRecords ? 'No payments in this period' : 'No payments yet'}
            body={
              filtered
                ? 'Try a different search, or clear the filters.'
                : dashboard.hasRecords
                  ? 'Pick another period to see earlier entries.'
                  : canRecord
                    ? 'Record the first payment to start tracking what clients have paid and what is outstanding.'
                    : 'Payments appear here once someone records them.'
            }
            action={
              filtered ? (
                <Link href="/admin/payments" className="text-[14px] underline">Clear filters</Link>
              ) : !dashboard.hasRecords && canRecord ? (
                <LinkButton href={newHref} variant="primary">Record the first payment</LinkButton>
              ) : undefined
            }
            className="py-12"
          />
        </div>
      ) : (
        <>
          <PaymentsTable items={page.items} params={sp} sort={list.sort} dir={list.dir} />
          <p className="pd-figure pt-3 text-[13px] text-pd-ink-2">
            Matching entries: <span className="font-semibold text-pd-ink">{formatInr(summary.receivedInr)}</span> received, net of refunds
            {summary.voided > 0 ? <span className="text-pd-ink-3"> ({summary.voided} void {summary.voided === 1 ? 'entry is' : 'entries are'} listed but not counted)</span> : null}.
          </p>
          <Pagination meta={page.meta} path="/admin/payments" params={sp} noun="payments" />
        </>
      )}
    </>
  );
}
