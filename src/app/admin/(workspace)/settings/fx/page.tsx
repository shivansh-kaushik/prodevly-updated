import type { Metadata } from 'next';
import { AuditFeed } from '@/components/admin/audit-feed';
import { ChartCard } from '@/components/admin/chart-card';
import { DataToolbar } from '@/components/admin/data-toolbar';
import { PageHeader } from '@/components/admin/page-header';
import { PeriodPicker } from '@/components/admin/period-picker';
import { StatBand, type Stat } from '@/components/admin/stat-band';
import { LinkButton } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { BASE_CURRENCY, CURRENCY_CODES } from '@/config/currencies';
import { FX_RATE_SOURCES } from '@/config/statuses';
import { formatCount, formatDate } from '@/lib/admin/format';
import { getPeriod } from '@/lib/admin/period';
import { first, oneOf, parseListParams, type RawSearchParams } from '@/lib/admin/search-params';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { getActivity } from '@/services/activity.service';
import { getFxDashboard } from '@/services/dashboards/fx';
import { searchFxRates } from '@/services/fx.service';
import { getSettings } from '@/services/settings.service';
import { LatestRates } from '../_components/latest-rates';
import { AddRateButton } from '../_components/rate-dialog';
import { RatesTable } from '../_components/rates-table';
import { SettingsNav } from '../_components/settings-nav';

export const metadata: Metadata = { title: 'Settings: FX rates' };

const FOREIGN = CURRENCY_CODES.filter((c) => c !== BASE_CURRENCY);

/**
 * Open to every signed-in admin: reading rates needs no capability ("A can read FX rates"). Changing
 * them needs fx:edit, which only decides whether the add and edit buttons appear: the routes check it again.
 */
export default async function FxRatesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage('/admin/settings/fx');
  const sp = await searchParams;
  const canEdit = viewer.capabilities.has('fx:edit');
  const canEditSettings = viewer.capabilities.has('settings:edit');
  const [settings, period] = await Promise.all([getSettings(), getPeriod(sp)]);
  const enabled = settings.enabledCurrencies.filter((c) => c !== BASE_CURRENCY);
  const currency = oneOf(sp, 'currency', FOREIGN);
  const source = oneOf(sp, 'source', FX_RATE_SOURCES);
  const list = parseListParams(sp, { sortable: [], defaultSort: 'rateOn' });

  const [dash, table, activity] = await Promise.all([
    getFxDashboard(viewer, period, { currency }),
    searchFxRates(viewer, { currency, source, q: list.q, from: period.from, to: period.to, page: list.page, pageSize: 25 }),
    canEdit || viewer.capabilities.has('audit:viewAll') ? getActivity({ entityType: 'fxRate' }, { limit: 8 }) : Promise.resolve([]),
  ]);
  const filtered = Boolean(list.q || currency || source);

  const stats: Stat[] = [
    {
      label: 'Rates out of date',
      value: formatCount(dash.stale.length),
      sub: enabled.length === 0 ? 'No foreign currency is turned on' : dash.stale.length > 0 ? dash.stale.join(', ') : `All ${formatCount(enabled.length)} current`,
      attention: dash.stale.length > 0,
    },
    { label: 'Currencies tracked', value: formatCount(enabled.length), sub: `A rate may be up to ${dash.staleDays} days old` },
  ];
  if (dash.manualOrBank) {
    const parts = dash.manualOrBank.byKind.filter((k) => k.count > 0).map((k) => `${k.label} ${formatCount(k.count)}`);
    const partial = dash.manualOrBank.counted.length < 4;
    stats.push({
      label: 'On a manual or bank rate',
      value: formatCount(dash.manualOrBank.total),
      sub: `${parts.length > 0 ? parts.join(', ') : `None in ${period.fyLabel ?? period.label.toLowerCase()}`}${partial ? '. Only the ledgers you can view.' : ''}`,
    });
  }

  const history = dash.history;
  const chartTitle = history.currency ? `Rate history, ${history.currency}` : 'Rate history';
  const chartHint = !history.currency
    ? 'INR per 1 unit over the period'
    : `${history.points.length < 2 ? 'Fewer than two rates in this period, so there is no line yet. ' : ''}INR per 1 ${history.currency}, shown to 2 decimals here.${currency ? '' : ' Filter by currency to change it.'}`;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Rates turn foreign-currency entries into INR. An entry keeps the rate it was saved with, whatever happens here afterwards."
        actions={
          <>
            {canEditSettings ? <LinkButton href="/admin/settings" variant="secondary">Currency settings</LinkButton> : null}
            {canEdit ? <AddRateButton currencies={enabled} today={dash.today} /> : null}
          </>
        }
      />
      <SettingsNav active="fx" canEditSettings={canEditSettings} />
      {!canEdit ? <p className="mb-4 text-[13px] text-pd-ink-3">You can read rates here. Adding or correcting one needs FX access, which a superadmin can give you.</p> : null}

      <StatBand stats={stats} className="mb-6" />

      <div className="mb-8 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <LatestRates rows={dash.currencies} staleDays={dash.staleDays} canEditSettings={canEditSettings} />
        <ChartCard
          title={chartTitle}
          hint={chartHint}
          type="line"
          data={history.points.map((p) => ({ day: formatDate(p.day), rate: p.rate }))}
          xKey="day"
          xLabel="Date"
          series={[{ key: 'rate', label: history.currency ? `${history.currency} in INR` : 'Rate' }]}
          kind="rate"
          height={240}
          emptyBody="No rates in this period."
        />
      </div>

      <DataToolbar
        searchPlaceholder="Search currency or person"
        filters={[
          { key: 'currency', label: 'Currency', options: FOREIGN.map((c) => ({ value: c, label: c })) },
          { key: 'source', label: 'Source', options: [{ value: 'ecb', label: 'ECB' }, { value: 'manual', label: 'Manual' }] },
        ]}
      >
        <PeriodPicker current={period.key} from={first(sp, 'from')} to={first(sp, 'to')} />
      </DataToolbar>

      <RatesTable rows={table.rows} canEdit={canEdit} currencies={enabled} today={dash.today} filtered={filtered} />
      <Pagination meta={table.meta} path="/admin/settings/fx" params={sp} noun="rates" />

      {activity.length > 0 || canEdit ? (
        <Panel className="mt-8">
          <PanelHeader title="Recent rate changes" />
          <AuditFeed entries={activity} emptyTitle="No rate changes yet" />
        </Panel>
      ) : null}
    </>
  );
}
