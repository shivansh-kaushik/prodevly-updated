import type { Metadata } from 'next';
import Link from 'next/link';
import { DataToolbar, type ToolbarFilter } from '@/components/admin/data-toolbar';
import { ExportButton } from '@/components/admin/export-button';
import { PageHeader } from '@/components/admin/page-header';
import { PeriodPicker } from '@/components/admin/period-picker';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { describeAction } from '@/lib/admin/audit-text';
import { formatCount, humanize } from '@/lib/admin/format';
import { getPeriod } from '@/lib/admin/period';
import { first, parseListParams, withParams, type RawSearchParams } from '@/lib/admin/search-params';
import { AUDIT_PAGE_SIZE, parseAuditSearch } from '@/lib/validation/audit';
import { getSettings } from '@/services/settings.service';
import { getAuditFilterOptions, groupAuditByDay, listAudit, resolveAuditFilterLabels } from '@/services/audit-log.service';
import { getAuditDashboard } from '@/services/dashboards/audit';
import { AuditDashboardBand } from './_components/audit-dashboard';
import { AuditList } from './_components/audit-list';
import { AuditPickers } from './_components/audit-pickers';

export const metadata: Metadata = { title: 'Audit log' };

const PATH = '/admin/audit';
const FILTER_KEYS = ['q', 'entity', 'action', 'sensitive', 'client', 'project', 'actor'] as const;

/** "Voided payment", "Signed in": the feed's own wording, capitalised for a menu. */
function actionLabel(action: string): string {
  const text = describeAction(action);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  // No capability here on purpose: every signed-in admin has a trail. audit:viewAll only widens it
  // from "my entries" to everyone's, and listAudit enforces that, whatever the URL says.
  const viewer = await requireAdminPage(PATH);
  const sp = await searchParams;
  const settings = await getSettings();
  const period = await getPeriod(sp);
  const list = parseListParams(sp, { sortable: [], defaultSort: 'at', pageSize: AUDIT_PAGE_SIZE });
  const urlFilters = parseAuditSearch(sp);

  const [dashboard, result, options, labels] = await Promise.all([
    getAuditDashboard(viewer, period, { timeZone: settings.timezone }),
    listAudit(viewer, { ...urlFilters, from: period.fromInstant, to: period.toInstant }, { page: list.page, pageSize: list.pageSize }),
    getAuditFilterOptions(viewer),
    resolveAuditFilterLabels(viewer, urlFilters),
  ]);

  const all = result.scope === 'all';
  const canExport = viewer.capabilities.has('export:data');
  const { meta } = result;
  // An actor in the URL means nothing to a viewer who can only see themselves.
  const filtered = Boolean(
    urlFilters.q || urlFilters.entityType || urlFilters.action || urlFilters.sensitive || urlFilters.clientId || urlFilters.projectId || (all && urlFilters.actorId),
  );

  // A prefix typed into the URL ("payment.") is not one of the known actions: keep it selectable so the menu never lies.
  const actions = urlFilters.action && !options.actions.includes(urlFilters.action) ? [...options.actions, urlFilters.action] : options.actions;
  const entityTypes = urlFilters.entityType && !options.entityTypes.includes(urlFilters.entityType) ? [...options.entityTypes, urlFilters.entityType] : options.entityTypes;
  const filters: ToolbarFilter[] = [
    { key: 'entity', label: 'Record type', allLabel: 'All record types', options: entityTypes.map((t) => ({ value: t, label: humanize(t) })) },
    { key: 'action', label: 'Action', allLabel: 'All actions', options: actions.map((a) => ({ value: a, label: actionLabel(a) })) },
    { key: 'sensitive', label: 'Sensitive actions', allLabel: 'All entries', options: [{ value: '1', label: 'Sensitive actions only' }] },
  ];

  const clearHref = withParams(PATH, sp, Object.fromEntries(FILTER_KEYS.map((k) => [k, null])));
  const entriesNoun = meta.total === 1 ? 'entry' : 'entries';

  return (
    <>
      <PageHeader
        title="Audit log"
        description={
          all
            ? 'Everything that happened: every change and every sign-in, with who did it and when. Entries cannot be edited or removed.'
            : 'Your activity: what you changed and when you signed in. Only superadmins see everyone’s.'
        }
        actions={canExport ? <ExportButton section="audit" params={sp} canExport={canExport} /> : undefined}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={all ? 'violet' : 'neutral'}>{all ? 'Everyone' : 'Only you'}</Badge>
            <span className="pd-figure text-[13px] text-pd-ink-3">
              {formatCount(meta.total)} {entriesNoun}, {period.label.toLowerCase()}
            </span>
          </span>
        }
      />

      <AuditDashboardBand dashboard={dashboard} period={period} sp={sp} />

      <DataToolbar searchPlaceholder={all ? 'Search person, action or record' : 'Search action or record'} filters={filters}>
        <AuditPickers
          actor={labels.actor ?? null}
          client={labels.client ?? null}
          project={labels.project ?? null}
          showPerson={all}
          showClient={viewer.capabilities.has('client:view')}
          showProject={viewer.capabilities.has('project:view')}
        />
        <PeriodPicker current={period.key} from={first(sp, 'from')} to={first(sp, 'to')} />
      </DataToolbar>

      {result.entries.length === 0 ? (
        <Panel flush>
          {filtered ? (
            <EmptyState
              title="No entries match"
              body="Try a different search, or clear the filters."
              action={<Link href={clearHref} className="text-[14px] underline" prefetch={false}>Clear filters</Link>}
            />
          ) : (
            <EmptyState
              title="Nothing recorded in this period"
              body={all ? 'Entries appear here as soon as someone signs in or changes a record.' : 'Entries appear here when you sign in or change a record.'}
              action={
                period.key === 'this_fy' ? undefined : (
                  <Link href={withParams(PATH, sp, { period: null, from: null, to: null })} className="text-[14px] underline" prefetch={false}>Show this financial year</Link>
                )
              }
            />
          )}
        </Panel>
      ) : (
        <>
          <AuditList groups={groupAuditByDay(result.entries, settings.timezone)} timeZone={settings.timezone} />
          <Pagination meta={meta} path={PATH} params={sp} noun="entries" />
        </>
      )}
    </>
  );
}
