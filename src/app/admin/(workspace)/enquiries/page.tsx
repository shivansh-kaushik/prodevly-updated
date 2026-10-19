import type { Metadata } from 'next';
import Link from 'next/link';
import { DataToolbar } from '@/components/admin/data-toolbar';
import { ExportButton } from '@/components/admin/export-button';
import { PageHeader } from '@/components/admin/page-header';
import { PeriodPicker } from '@/components/admin/period-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { LEAD_STATUSES } from '@/config/statuses';
import { humanize } from '@/lib/admin/format';
import { getPeriod } from '@/lib/admin/period';
import { first, objectIdParam, oneOf, parseListParams, withParams, type RawSearchParams } from '@/lib/admin/search-params';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { parseSourceFilter, sourceFilterValue } from '@/lib/validation/lead';
import { getEnquiriesDashboard } from '@/services/dashboards/enquiries';
import { LEAD_SORT_KEYS, listAssignableAdmins, listLeadSources, searchLeads } from '@/services/lead.service';
import { getSettings } from '@/services/settings.service';
import { DashboardBand } from './_components/dashboard-band';
import { EnquiryTable } from './_components/enquiry-table';

export const metadata: Metadata = { title: 'Enquiries' };

export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage('/admin/enquiries', { capability: 'lead:view' });
  const sp = await searchParams;
  const canExport = viewer.capabilities.has('export:data');

  const list = parseListParams(sp, { sortable: LEAD_SORT_KEYS, defaultSort: 'createdAt', defaultDir: 'desc' });
  const status = oneOf(sp, 'status', [...LEAD_STATUSES, 'open']);
  const assignee = oneOf(sp, 'assignee', ['me', 'unassigned']) ?? objectIdParam(sp, 'assignee');
  const followUp = oneOf(sp, 'followUp', ['due']);
  const source = parseSourceFilter(first(sp, 'source'));
  const period = await getPeriod(sp);
  const settings = await getSettings();
  const now = new Date();

  const [dashboard, result, admins, sources] = await Promise.all([
    getEnquiriesDashboard(viewer, period, { now, timeZone: settings.timezone }),
    searchLeads(viewer, {
      q: list.q,
      status,
      assignee,
      followUp,
      source,
      period,
      sort: list.sort as (typeof LEAD_SORT_KEYS)[number],
      dir: list.dir,
      page: list.page,
      pageSize: list.pageSize,
      now,
    }),
    listAssignableAdmins(viewer),
    listLeadSources(viewer),
  ]);

  const periodText = period.fyLabel ? `${period.label} (${period.fyLabel})` : period.label;
  const today = formatDateOnly(todayDateOnly(now, settings.timezone));
  const filtered = Boolean(list.q || status || assignee || followUp || source);
  const clearHref = withParams('/admin/enquiries', sp, { q: undefined, status: undefined, assignee: undefined, followUp: undefined, source: undefined });

  return (
    <>
      <PageHeader
        title="Enquiries"
        description="Messages sent through the contact form on the public site."
        actions={canExport ? <ExportButton section="enquiries" params={sp} canExport={canExport} /> : undefined}
      />

      <DashboardBand dashboard={dashboard} periodText={periodText} sp={sp} />

      <DataToolbar
        searchPlaceholder="Search name, email, company or reference"
        filters={[
          {
            key: 'status',
            label: 'Status',
            allLabel: 'Any status except spam',
            options: [{ value: 'open', label: 'Open (still being worked)' }, ...LEAD_STATUSES.map((s) => ({ value: s, label: humanize(s) }))],
          },
          {
            key: 'assignee',
            label: 'Assignee',
            allLabel: 'Anyone',
            options: [{ value: 'me', label: 'Assigned to me' }, { value: 'unassigned', label: 'Unassigned' }, ...admins.filter((a) => a.id !== viewer.id).map((a) => ({ value: a.id, label: a.name }))],
          },
          { key: 'followUp', label: 'Follow-up', allLabel: 'Any follow-up', options: [{ value: 'due', label: 'Due today or earlier' }] },
          {
            key: 'source',
            label: 'Source',
            allLabel: 'Any source',
            options: [
              ...sources.pages.map((p) => ({ value: sourceFilterValue('page', p), label: `Page: ${p}` })),
              ...sources.utmSources.map((u) => ({ value: sourceFilterValue('utm', u), label: `UTM: ${u}` })),
            ],
          },
        ]}
      >
        <PeriodPicker current={period.key} from={first(sp, 'from')} to={first(sp, 'to')} />
      </DataToolbar>

      {followUp ? <p className="mb-3 text-[13px] text-pd-ink-3">Follow-ups due are shown across all dates, whatever the period.</p> : null}

      {result.items.length > 0 ? (
        <>
          <EnquiryTable items={result.items} today={today} sp={sp} sort={list.sort} dir={list.dir} />
          <Pagination meta={result.meta} path="/admin/enquiries" params={sp} noun="enquiries" />
        </>
      ) : (
        <div className="rounded-pd-md bg-pd-leaf shadow-[0_0_0_1px_var(--color-pd-rule)]">
          <EmptyState
            title={filtered ? 'No enquiries match' : 'No enquiries yet'}
            body={
              filtered
                ? 'Try a different search, or clear the filters. Spam is hidden unless you filter by it.'
                : followUp
                  ? 'Nothing is waiting for a follow-up.'
                  : `Nothing was received in ${periodText.toLowerCase()}. Enquiries appear here when someone sends the contact form on the public site.`
            }
            action={filtered ? <Link href={clearHref} className="text-[14px] underline">Clear filters</Link> : undefined}
            className="py-10"
          />
        </div>
      )}
    </>
  );
}
