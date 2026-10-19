import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { ChartCard } from '@/components/admin/chart-card';
import { DataToolbar } from '@/components/admin/data-toolbar';
import { ExportButton } from '@/components/admin/export-button';
import { PageHeader } from '@/components/admin/page-header';
import { PeriodPicker } from '@/components/admin/period-picker';
import { StatBand, type Stat } from '@/components/admin/stat-band';
import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { CLIENT_KINDS, CLIENT_STATUSES } from '@/config/statuses';
import { formatCount, formatDate, formatInr, humanize } from '@/lib/admin/format';
import { getPeriod } from '@/lib/admin/period';
import { first, oneOf, parseListParams, type RawSearchParams } from '@/lib/admin/search-params';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { getClientsDashboard } from '@/services/dashboards/clients';
import { CLIENT_SORTS, listClientCountries, listClients } from '@/services/client.service';
import { Money } from '@/components/admin/money';
import { ShareBar } from '@/components/admin/share-bar';
import { ClientsTable } from './_components/clients-table';
import { countryName } from './_components/countries';

export const metadata: Metadata = { title: 'Clients' };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage('/admin/clients', { capability: 'client:view' });
  const sp = await searchParams;
  const period = await getPeriod(sp);
  const list = parseListParams(sp, { sortable: CLIENT_SORTS, defaultSort: 'updatedAt', defaultDir: 'desc' });
  const status = oneOf(sp, 'status', CLIENT_STATUSES);
  const kind = oneOf(sp, 'kind', CLIENT_KINDS);
  const archived = oneOf(sp, 'archived', ['only', 'include'] as const);
  const country = first(sp, 'country')?.toUpperCase();

  const [dashboard, clients, countries] = await Promise.all([
    getClientsDashboard(viewer, period),
    listClients(viewer, { q: list.q, status, kind, country, archived, sort: list.sort as (typeof CLIENT_SORTS)[number], dir: list.dir, page: list.page, pageSize: list.pageSize }),
    listClientCountries(viewer),
  ]);
  const filtered = Boolean(first(sp, 'q') || status || kind || archived || country);
  const money = dashboard.money;
  const canEdit = viewer.capabilities.has('client:edit');
  const canExport = viewer.capabilities.has('export:data');

  const stats: Stat[] = [
    { label: 'Active clients', value: formatCount(dashboard.byStatus.active), sub: `${formatCount(dashboard.total)} in all` },
    { label: 'New in this period', value: formatCount(dashboard.newInPeriod) },
  ];
  if (money) {
    stats.push(
      { label: 'Received in this period', value: formatInr(money.receivedInrMinor), sub: `from ${formatCount(money.receivingClients)} ${money.receivingClients === 1 ? 'client' : 'clients'}` },
      {
        label: 'Outstanding',
        value: formatInr(money.outstandingInrMinor),
        sub: money.outstandingMissingRates.length > 0 ? `No rate yet for ${money.outstandingMissingRates.join(', ')}` : 'At the latest rates',
        attention: money.outstandingMissingRates.length > 0,
      },
      { label: 'From the top 3 payers', value: money.topThreeSharePct === null ? 'None yet' : `${money.topThreeSharePct}%`, sub: 'Share of this period\'s receipts' },
    );
  }

  return (
    <>
      <PageHeader
        title="Clients"
        description="The people and companies we build for, with what they owe and what they have paid."
        actions={
          canEdit || canExport ? (
            <>
              <ExportButton section="clients" params={sp} canExport={canExport} />
              {canEdit ? <LinkButton href="/admin/clients/new" variant="primary"><Plus className="size-4" aria-hidden /> New client</LinkButton> : null}
            </>
          ) : undefined
        }
      />

      <StatBand stats={stats} className="mb-6" />

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Clients by status" hint="Not archived" />
          {dashboard.total === 0 ? (
            <EmptyState title="No clients yet" body="Add the first client to see this fill in." className="py-8" />
          ) : (
            <ShareBar parts={CLIENT_STATUSES.map((s) => ({ label: humanize(s), value: dashboard.byStatus[s] }))} />
          )}
        </Panel>
        <ChartCard
          title="Clients by country"
          hint="Top 8, not archived"
          type="ranked"
          data={dashboard.byCountry.map((c) => ({ country: countryName(c.country) || c.country, clients: c.count }))}
          xKey="country"
          xLabel="Country"
          series={[{ key: 'clients', label: 'Clients' }]}
          kind="count"
          emptyBody="Set a country on a client to see this."
        />
        {money ? (
          <>
            <ChartCard
              title="Received by client"
              hint="Top 10 this period, in rupees"
              type="ranked"
              data={money.receivedByClient.map((r) => ({ client: r.name, received: r.inrMinor }))}
              xKey="client"
              xLabel="Client"
              series={[{ key: 'received', label: 'Received', color: '#1d6b49' }]}
              kind="inr"
              totals
              emptyBody="No receipts in this period."
            />
            <ChartCard
              title="Outstanding by client"
              hint="Top 10, at the latest rates"
              type="ranked"
              data={money.outstandingByClient.map((r) => ({ client: r.name, outstanding: r.inrMinor }))}
              xKey="client"
              xLabel="Client"
              series={[{ key: 'outstanding', label: 'Outstanding', color: '#a3680b' }]}
              kind="inr"
              totals
              emptyBody="Nothing is outstanding."
            />
            {money.overdueMilestones.length > 0 ? (
              <Panel className="lg:col-span-2">
                <PanelHeader title="Overdue milestones" hint="Billing milestones past their date and not yet paid" />
                <ul className="flex flex-col divide-y divide-pd-rule-soft">
                  {money.overdueMilestones.map((m, i) => (
                    <li key={`${m.projectId}-${i}`} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-2.5 text-[14px]">
                      <span className="min-w-0">
                        <Link href={`/admin/clients/${m.clientId}`} prefetch={false} className="font-medium hover:underline">{m.clientName}</Link>
                        <span className="text-pd-ink-3"> , {m.projectName}, {m.milestone}</span>
                      </span>
                      <span className="flex items-center gap-4">
                        <Money amountMinor={m.amountMinor} currency={m.currency} inline />
                        <span className="pd-figure text-[12px] font-medium text-pd-rubric">{m.daysLate} {m.daysLate === 1 ? 'day' : 'days'} late, due {formatDate(m.dueOn)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}
          </>
        ) : null}
      </div>

      <DataToolbar
        searchPlaceholder="Search name, reference or contact"
        filters={[
          { key: 'status', label: 'Status', options: CLIENT_STATUSES.map((s) => ({ value: s, label: humanize(s) })) },
          { key: 'kind', label: 'Kind', options: CLIENT_KINDS.map((k) => ({ value: k, label: humanize(k) })) },
          { key: 'country', label: 'Country', options: countries.map((c) => ({ value: c, label: countryName(c) })) },
          { key: 'archived', label: 'Archived', allLabel: 'Hide archived', options: [{ value: 'include', label: 'Include archived' }, { value: 'only', label: 'Only archived' }] },
        ]}
      >
        <PeriodPicker current={period.key} from={first(sp, 'from')} to={first(sp, 'to')} />
      </DataToolbar>

      {clients.items.length === 0 ? (
        <Panel flush>
          <EmptyState
            title={filtered ? 'No clients match' : 'No clients yet'}
            body={filtered ? 'Try a different search or clear the filters.' : 'Add your first client to start tracking projects and payments.'}
            action={filtered ? <Link href="/admin/clients" className="text-[14px] underline">Clear filters</Link> : viewer.capabilities.has('client:edit') ? <LinkButton href="/admin/clients/new" variant="primary">New client</LinkButton> : undefined}
          />
        </Panel>
      ) : (
        <>
          <ClientsTable items={clients.items} params={sp} sort={list.sort} dir={list.dir} />
          <Pagination meta={clients.meta} path="/admin/clients" params={sp} noun="clients" />
        </>
      )}
    </>
  );
}
