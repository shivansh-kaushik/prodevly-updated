import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Plus } from 'lucide-react';
import { DataToolbar } from '@/components/admin/data-toolbar';
import { PageHeader } from '@/components/admin/page-header';
import { StatBand } from '@/components/admin/stat-band';
import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { formatCount } from '@/lib/admin/format';
import { first, oneOf, withParams, type RawSearchParams } from '@/lib/admin/search-params';
import { CONTENT_STATUSES } from '@/config/statuses';
import { CONTENT_LABELS, isContentType } from '@/lib/content/types';
import { listContent } from '@/services/content.service';
import { getContentDashboard } from '@/services/dashboards/content';
import { ContentList } from '../_components/content-list';
import { ContentNav } from '../_components/content-nav';

export async function generateMetadata({ params }: { params: Promise<{ type: string }> }): Promise<Metadata> {
  const { type } = await params;
  return { title: isContentType(type) ? CONTENT_LABELS[type].plural : 'Website content' };
}

export default async function ContentListPage({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: Promise<RawSearchParams> }) {
  const { type } = await params;
  // Sign-in and capability come first, so a stranger learns nothing about which addresses exist.
  const viewer = await requireAdminPage(isContentType(type) ? `/admin/content/${type}` : '/admin/content', { capability: 'content:edit' });
  if (!isContentType(type)) notFound();
  const sp = await searchParams;
  const status = oneOf(sp, 'status', CONTENT_STATUSES);
  const q = first(sp, 'q')?.slice(0, 80);
  const labels = CONTENT_LABELS[type];

  const [items, dashboard] = await Promise.all([
    listContent(viewer, type, { statuses: status ? [status] : ['draft', 'published'], q }),
    getContentDashboard(viewer),
  ]);
  const summary = dashboard.types.find((t) => t.type === type);
  const filtered = Boolean(q || status);
  const hidden = dashboard.hiddenSections.some((s) => s.type === type);

  return (
    <>
      <PageHeader
        title={labels.plural}
        description={labels.blurb}
        crumbs={[{ label: 'Website content', href: '/admin/content' }, { label: labels.plural }]}
        actions={<LinkButton href={`/admin/content/${type}/new`} variant="primary"><Plus className="size-4" aria-hidden /> Add {labels.singular}</LinkButton>}
      />
      <ContentNav active={type} />

      <StatBand
        className="mb-6"
        stats={[
          { label: 'Published', value: formatCount(summary?.published ?? 0), sub: hidden ? 'The home section is hidden' : 'Live on the site', attention: hidden, href: withParams(`/admin/content/${type}`, {}, { status: 'published' }) },
          { label: 'Drafts', value: formatCount(summary?.draft ?? 0), href: withParams(`/admin/content/${type}`, {}, { status: 'draft' }) },
          { label: 'Archived', value: formatCount(summary?.archived ?? 0), href: withParams(`/admin/content/${type}`, {}, { status: 'archived' }) },
        ]}
      />

      <DataToolbar
        searchPlaceholder={`Search ${labels.plural.toLowerCase()}`}
        filters={[{ key: 'status', label: 'Status', allLabel: 'Drafts and published', options: CONTENT_STATUSES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })) }]}
      />

      {items.length === 0 ? (
        <EmptyState
          title={filtered ? `No ${labels.plural.toLowerCase()} match` : `No ${labels.plural.toLowerCase()} yet`}
          body={filtered ? 'Try a different search or clear the filters.' : `Nothing is shown in the ${labels.section} section until you add and publish one.`}
          action={filtered ? <Link href={`/admin/content/${type}`} className="text-[14px] underline">Clear filters</Link> : <LinkButton href={`/admin/content/${type}/new`} variant="primary">Add {labels.singular}</LinkButton>}
          className="py-12"
        />
      ) : (
        <ContentList type={type} items={items} canPublish={viewer.capabilities.has('content:publish')} reorderable={!filtered} />
      )}
    </>
  );
}
