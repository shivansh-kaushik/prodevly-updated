import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { PeriodPicker } from '@/components/admin/period-picker';
import { formatDate } from '@/lib/admin/format';
import { getPeriod } from '@/lib/admin/period';
import type { RawSearchParams } from '@/lib/admin/search-params';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { formatDateOnly } from '@/lib/dates/date-only';
import { getOverviewDashboard } from '@/services/dashboards/overview';
import { ActivityPanel } from './_components/overview/activity-panel';
import { FirstSteps } from './_components/overview/first-steps';
import { CashFlowChart, NetChart, StatusPanel } from './_components/overview/overview-charts';
import { buildMoneyStats, buildWorkStats, OverviewBand } from './_components/overview/overview-stats';
import { TopProjectsPanel } from './_components/overview/top-projects';

export const metadata: Metadata = { title: 'Overview' };

/** Two panels side by side on a wide screen; one alone takes the full width, and the phone stacks them in this order. */
function Pair({ main, side }: { main: React.ReactNode; side: React.ReactNode }) {
  if (!main && !side) return null;
  if (!main || !side) return <div className="mb-6">{main ?? side}</div>;
  return <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">{main}{side}</div>;
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  // Every signed-in admin holds dashboard:view by default. What they see on it is decided per tile, by their own capabilities.
  const viewer = await requireAdminPage('/admin', { capability: 'dashboard:view' });
  const sp = await searchParams;
  const period = await getPeriod(sp);
  const d = await getOverviewDashboard(viewer, period);

  const range = `${formatDate(d.period.from)} to ${formatDate(d.period.to)}`;
  const named = d.period.fyLabel ? `${d.period.label} (${d.period.fyLabel})` : d.period.label;

  return (
    <>
      <PageHeader
        title="Overview"
        description={`${named}, ${range}. Every figure is totalled from records the team entered, and you see the ones your access covers.`}
        actions={<PeriodPicker current={period.key} from={period.key === 'custom' ? formatDateOnly(period.from) : undefined} to={period.key === 'custom' ? formatDateOnly(period.to) : undefined} />}
      />

      <FirstSteps setup={d.setup} canAddClient={viewer.capabilities.has('client:edit')} canAddProject={viewer.capabilities.has('project:edit')} />

      <OverviewBand id="overview-money" title="Money" stats={buildMoneyStats(d, sp)} />
      <OverviewBand id="overview-work" title="Work and enquiries" stats={buildWorkStats(d)} />

      <Pair
        main={d.cashFlow ? <CashFlowChart cashFlow={d.cashFlow} period={d.period} /> : null}
        side={d.topProjects ? <TopProjectsPanel projects={d.topProjects} period={d.period} /> : null}
      />
      <Pair
        main={d.cashFlow && d.money.net ? <NetChart cashFlow={d.cashFlow} period={d.period} /> : null}
        side={d.projects ? <StatusPanel projects={d.projects} /> : null}
      />

      <div className="mb-8">
        <ActivityPanel activity={d.activity} />
      </div>
    </>
  );
}
