import { ChartCard } from '@/components/admin/chart-card';
import { StatBand, type Stat } from '@/components/admin/stat-band';
import { CHART_COLORS } from '@/lib/admin/chart-colors';
import { formatCount, formatPercent, humanize } from '@/lib/admin/format';
import { withParams, type RawSearchParams } from '@/lib/admin/search-params';
import type { Period } from '@/lib/dates/ranges';
import type { AuditDashboard } from '@/services/dashboards/audit';

const PATH = '/admin/audit';

/** "2026-10-12" as "12 Oct". The day is already a calendar date in the organisation's zone, so no zone is applied. */
function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Chart rows are keyed by their label, so two people with the same name must not share one. */
function uniqueLabels<T extends { label: string }>(rows: T[]): T[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const n = (seen.get(row.label) ?? 0) + 1;
    seen.set(row.label, n);
    return n === 1 ? row : { ...row, label: `${row.label} (${n})` };
  });
}

/** Links from a tile keep the period but drop every other filter, so the list matches the number. */
function tileHref(sp: RawSearchParams, overrides: Record<string, string>): string {
  const keep: RawSearchParams = { period: sp.period, from: sp.from, to: sp.to };
  return withParams(PATH, keep, overrides);
}

export function AuditDashboardBand({ dashboard, period, sp }: { dashboard: AuditDashboard; period: Pick<Period, 'label' | 'fyLabel'>; sp: RawSearchParams }) {
  const { sensitive } = dashboard;
  const all = dashboard.scope === 'all';
  const periodLabel = period.fyLabel ? `${period.label}, ${period.fyLabel}` : period.label;
  const share = formatPercent(sensitive.total, dashboard.actions);

  const stats: Stat[] = [
    { label: all ? 'Actions' : 'Your actions', value: formatCount(dashboard.actions), sub: periodLabel },
    {
      label: 'Sensitive actions',
      value: formatCount(sensitive.total),
      sub: share ? `${share} of all actions` : undefined,
      href: sensitive.total > 0 ? tileHref(sp, { sensitive: '1' }) : undefined,
    },
  ];
  // Failed sign-ins are recorded under the system, not under the person who was targeted, and account
  // management and voids are superadmin work, so for everyone else these three would only ever read zero.
  if (all) {
    stats.push(
      { label: 'Account management', value: formatCount(sensitive.adminManagement) },
      { label: 'Voids', value: formatCount(sensitive.voids) },
      {
        label: 'Failed sign-ins',
        value: formatCount(sensitive.failedSignIns),
        href: sensitive.failedSignIns > 0 ? tileHref(sp, { action: 'auth.login_failed' }) : undefined,
      },
    );
  }

  const byDay = dashboard.actionsByDay.map((d) => ({ day: formatDay(d.day), actions: d.actions }));
  const byPerson = uniqueLabels(dashboard.byPerson.map((p) => ({ label: p.name, actions: p.actions }))).map((p) => ({ person: p.label, actions: p.actions }));
  const byType = uniqueLabels(dashboard.byEntityType.map((e) => ({ label: e.type === null ? 'Other' : humanize(e.type), actions: e.actions }))).map((e) => ({ type: e.label, actions: e.actions }));

  return (
    <>
      <StatBand stats={stats} className="mb-6" />
      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <ChartCard
          className="lg:col-span-2"
          title="Actions per day"
          hint="Last 30 days"
          type="bar"
          data={byDay}
          xKey="day"
          xLabel="Day"
          series={[{ key: 'actions', label: 'Actions', color: CHART_COLORS.blue }]}
          kind="count"
          totals
          height={200}
          emptyBody="Nothing was recorded in the last 30 days."
        />
        {all ? (
          <ChartCard
            title="Actions by person"
            hint={`${period.label}, top 10`}
            type="ranked"
            data={byPerson}
            xKey="person"
            xLabel="Person"
            series={[{ key: 'actions', label: 'Actions', color: CHART_COLORS.blue }]}
            kind="count"
            totals
            emptyBody="Nothing was recorded in this period."
          />
        ) : null}
        <ChartCard
          className={all ? undefined : 'lg:col-span-2'}
          title="Actions by record type"
          hint={period.label}
          type="ranked"
          data={byType}
          xKey="type"
          xLabel="Record type"
          series={[{ key: 'actions', label: 'Actions', color: CHART_COLORS.violet }]}
          kind="count"
          totals
          emptyBody="Nothing was recorded in this period."
        />
      </div>
    </>
  );
}
