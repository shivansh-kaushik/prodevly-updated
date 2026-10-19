import type { Metadata } from 'next';
import Link from 'next/link';
import { ChartCard } from '@/components/admin/chart-card';
import { PageHeader } from '@/components/admin/page-header';
import { StatBand } from '@/components/admin/stat-band';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { RowLink, Table, TableFrame, Td, THead, Th, Tr } from '@/components/ui/table';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { CHART_COLORS } from '@/lib/admin/chart-colors';
import { formatAgo, formatCount, formatDateTime } from '@/lib/admin/format';
import { CONTENT_LABELS } from '@/lib/content/types';
import { getContentDashboard } from '@/services/dashboards/content';
import { ContentNav } from './_components/content-nav';

export const metadata: Metadata = { title: 'Website content' };

export default async function ContentOverviewPage() {
  const viewer = await requireAdminPage('/admin/content', { capability: 'content:edit' });
  const d = await getContentDashboard(viewer);
  const empty = d.totals.items === 0;

  return (
    <>
      <PageHeader
        title="Website content"
        description="What the public site shows. A home section appears only when it has at least one published item."
        actions={<LinkButton href="/admin/content/site" variant="secondary">Company info</LinkButton>}
      />
      <ContentNav active="overview" />

      <StatBand
        className="mb-6"
        stats={[
          { label: 'Published', value: formatCount(d.totals.published), sub: 'Live on the site now' },
          { label: 'Drafts', value: formatCount(d.totals.draft) },
          { label: 'Archived', value: formatCount(d.totals.archived) },
          { label: 'Home sections hidden', value: formatCount(d.hiddenSections.length), sub: `of ${d.sections.length}`, attention: d.hiddenSections.length > 0 },
          { label: 'Drafts needing attention', value: formatCount(d.attentionTotal), attention: d.attentionTotal > 0 },
        ]}
      />

      {empty ? (
        <Panel className="mb-6">
          <EmptyState
            title="No website content yet"
            body="Nothing is shown on the public site until you publish it. Start with a service, or a project the client has agreed to show."
            action={<LinkButton href="/admin/content/services" variant="primary">Add a service</LinkButton>}
          />
        </Panel>
      ) : null}

      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ChartCard
          title="Items by type"
          hint="Published, draft and archived"
          type="bar"
          data={d.types.map((t) => ({ type: t.label, published: t.published, draft: t.draft, archived: t.archived }))}
          xKey="type"
          xLabel="Type"
          series={[
            { key: 'published', label: 'Published', color: CHART_COLORS.credit, stackId: 'status' },
            { key: 'draft', label: 'Draft', color: CHART_COLORS.amber, stackId: 'status' },
            { key: 'archived', label: 'Archived', color: CHART_COLORS.slate, stackId: 'status' },
          ]}
          kind="count"
          totals
          height={240}
          emptyBody="No content has been added yet."
        />

        <Panel>
          <PanelHeader title="Home sections" hint="A section with nothing published does not appear, and neither does its nav link." />
          <ul className="flex flex-col">
            {d.sections.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-3 border-b border-pd-rule-soft py-2.5 last:border-b-0">
                <div className="min-w-0">
                  <Link href={`/admin/content/${s.type}`} className="font-medium text-pd-ink underline-offset-2 hover:underline" prefetch={false}>{s.label}</Link>
                  <p className="text-[12px] text-pd-ink-3">{s.visible ? `${formatCount(s.showing)} published` : s.published > 0 ? `${formatCount(s.published)} published, but none can be shown` : `No published ${CONTENT_LABELS[s.type].plural.toLowerCase()}`}</p>
                </div>
                <Badge tone={s.visible ? 'credit' : 'amber'}>{s.visible ? 'Shown' : 'Hidden'}</Badge>
              </li>
            ))}
            <li className="flex items-center justify-between gap-3 pt-2.5">
              <div className="min-w-0">
                <Link href="/admin/content/site" className="font-medium text-pd-ink underline-offset-2 hover:underline" prefetch={false}>Footer and contact details</Link>
                <p className="text-[12px] text-pd-ink-3">{d.siteInfo.hasContactDetails ? `Company info saved${d.siteInfo.updatedAt ? `, ${formatAgo(d.siteInfo.updatedAt)}` : ''}` : 'No contact details saved yet'}</p>
              </div>
              <Badge tone={d.siteInfo.hasContactDetails ? 'credit' : 'neutral'}>{d.siteInfo.hasContactDetails ? 'Filled in' : 'Empty'}</Badge>
            </li>
          </ul>
        </Panel>
      </div>

      <h2 className="mb-3 text-[15px] font-semibold text-pd-ink">By content type</h2>
      <TableFrame className="mb-8">
        <Table caption="Website content by type">
          <THead>
            <tr>
              <Th>Type</Th>
              <Th numeric>Published</Th>
              <Th numeric>Drafts</Th>
              <Th numeric>Archived</Th>
              <Th>Last published</Th>
            </tr>
          </THead>
          <tbody>
            {d.types.map((t) => (
              <Tr key={t.type}>
                <Td><RowLink href={`/admin/content/${t.type}`}>{t.label}</RowLink></Td>
                <Td numeric>{formatCount(t.published)}</Td>
                <Td numeric>{formatCount(t.draft)}</Td>
                <Td numeric>{formatCount(t.archived)}</Td>
                <Td muted>
                  {t.lastPublished ? (
                    <span title={formatDateTime(t.lastPublished.publishedAt)}>
                      <Link href={`/admin/content/${t.type}/${t.lastPublished.id}`} className="text-pd-ink underline-offset-2 hover:underline" prefetch={false}>{t.lastPublished.title}</Link>, {formatAgo(t.lastPublished.publishedAt)}
                    </span>
                  ) : (
                    'Nothing published'
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableFrame>

      <Panel>
        <PanelHeader title="Drafts that need attention" hint="Missing a permission tick, a price or an image." />
        {d.attention.length === 0 ? (
          <EmptyState title="Nothing is waiting" body="Every draft has its permission tick and image." className="py-8" />
        ) : (
          <ul className="flex flex-col">
            {d.attention.map((a) => (
              <li key={`${a.type}-${a.id}`} className="flex flex-col gap-0.5 border-b border-pd-rule-soft py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <Link href={`/admin/content/${a.type}/${a.id}`} className="font-medium text-pd-ink underline-offset-2 hover:underline" prefetch={false}>{a.title}</Link>
                  <span className="ml-2 text-[12px] text-pd-ink-3">{CONTENT_LABELS[a.type].singular}</span>
                </div>
                <p className="text-[13px] text-pd-amber">{a.problems.join('; ')}</p>
              </li>
            ))}
            {d.attentionTotal > d.attention.length ? <li className="pt-2.5 text-[12px] text-pd-ink-3">and {d.attentionTotal - d.attention.length} more</li> : null}
          </ul>
        )}
      </Panel>
    </>
  );
}
