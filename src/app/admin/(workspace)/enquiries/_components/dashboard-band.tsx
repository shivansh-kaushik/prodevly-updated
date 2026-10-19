import { ChartCard } from '@/components/admin/chart-card';
import { StatBand, type Stat } from '@/components/admin/stat-band';
import { CHART_COLORS } from '@/lib/admin/chart-colors';
import { formatCount, formatPercent, humanize } from '@/lib/admin/format';
import { withParams, type RawSearchParams } from '@/lib/admin/search-params';
import type { CountRow, EnquiriesDashboard } from '@/services/dashboards/enquiries';
import { formatReplyTime } from './reply-time';

const SERIES = [{ key: 'enquiries', label: 'Enquiries', color: CHART_COLORS.blue }];
const rows = (items: CountRow[]) => items.map((r) => ({ name: r.label, enquiries: r.count }));

/**
 * The Enquiries dashboard: one ruled band of tiles and the charts. Every figure comes from the
 * dashboard service (records only). A tile with no data says so instead of showing a made-up zero
 * ratio: the conversion rate and the median reply time need something to measure.
 */
export function DashboardBand({ dashboard: d, periodText, sp }: { dashboard: EnquiriesDashboard; periodText: string; sp: RawSearchParams }) {
  const decided = d.conversion.won + d.conversion.lost;
  const openParts = d.open.byStatus.filter((s) => s.count > 0).map((s) => `${formatCount(s.count)} ${humanize(s.status).toLowerCase()}`);

  const stats: Stat[] = [
    {
      label: 'New in the period',
      value: formatCount(d.newInPeriod),
      sub: d.spamInPeriod > 0 ? `${periodText}, ${formatCount(d.spamInPeriod)} held as spam` : periodText,
    },
    {
      label: 'Open now',
      value: formatCount(d.open.total),
      sub: openParts.length > 0 ? openParts.join(', ') : 'Nothing waiting',
      href: withParams('/admin/enquiries', sp, { status: 'open', followUp: undefined }),
      attention: d.waitingForFirstReply > 0,
    },
    {
      label: 'Median first reply',
      value: formatReplyTime(d.firstReply.medianMinutes),
      sub: d.firstReply.replied > 0 ? `From ${formatCount(d.firstReply.replied)} ${d.firstReply.replied === 1 ? 'reply' : 'replies'}` : 'No replies yet',
    },
    {
      label: 'Won of decided',
      value: formatPercent(d.conversion.won, decided) ?? 'No data',
      sub: decided > 0 ? `${formatCount(d.conversion.won)} won, ${formatCount(d.conversion.lost)} lost` : 'Nothing won or lost yet',
    },
    {
      label: 'Follow-ups due',
      value: formatCount(d.followUpsDue),
      sub: 'Today or earlier',
      href: withParams('/admin/enquiries', sp, { followUp: 'due', status: undefined }),
      attention: d.followUpsDue > 0,
    },
  ];

  const empty = 'No enquiries received in this period.';
  return (
    <>
      <StatBand stats={stats} className="mb-6" />
      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ChartCard
          title="Enquiries per week"
          hint={`Received, ${periodText}. Weeks start on Monday.`}
          type="bar"
          data={d.perWeek.map((w) => ({ name: w.label, enquiries: w.count }))}
          xKey="name"
          xLabel="Week starting"
          series={SERIES}
          kind="count"
          totals
          height={240}
          emptyBody={empty}
        />
        <ChartCard
          title="How far they got"
          hint="Each stage counts enquiries that reached it, or went past it."
          type="ranked"
          data={rows(d.funnel.map((f) => ({ label: f.label, count: f.count })))}
          xKey="name"
          xLabel="Stage"
          series={SERIES}
          kind="count"
          emptyBody={empty}
        />
      </div>
      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="By service interest"
          hint="An enquiry that ticked several services counts under each."
          type="ranked"
          data={rows(d.byService)}
          xKey="name"
          xLabel="Service"
          series={SERIES}
          kind="count"
          emptyBody={empty}
        />
        <ChartCard title="By budget range" type="ranked" data={rows(d.byBudget)} xKey="name" xLabel="Budget range" series={SERIES} kind="count" totals emptyBody={empty} />
        <ChartCard title="By source page" hint="The page the form was sent from." type="ranked" data={rows(d.bySourcePath)} xKey="name" xLabel="Page" series={SERIES} kind="count" totals emptyBody={empty} />
        <ChartCard title="By UTM source" hint="From the campaign tag on the link, when there was one." type="ranked" data={rows(d.byUtmSource)} xKey="name" xLabel="UTM source" series={SERIES} kind="count" totals emptyBody={empty} />
      </div>
    </>
  );
}
