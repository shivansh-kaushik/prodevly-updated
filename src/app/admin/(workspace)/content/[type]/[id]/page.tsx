import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AuditFeed } from '@/components/admin/audit-feed';
import { PageHeader } from '@/components/admin/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { DescriptionList, Panel, PanelHeader } from '@/components/ui/panel';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { formatDateTime } from '@/lib/admin/format';
import { CONTENT_LABELS, isContentType } from '@/lib/content/types';
import { AppError } from '@/lib/api/errors';
import { getActivity } from '@/services/activity.service';
import { getContent } from '@/services/content.service';
import { KINDS } from '@/services/content/registry';
import { ContentNav } from '../../_components/content-nav';
import { EditorFor } from '../../_components/editor-for';
import { PermissionBadge } from '../../_components/permission-badge';
import { StatusActions } from '../../_components/status-actions';

export const metadata: Metadata = { title: 'Edit' };

export default async function EditContentPage({ params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id: rawId } = await params;
  const wellFormed = isContentType(type) && /^[a-f\d]{24}$/i.test(rawId);
  const viewer = await requireAdminPage(wellFormed ? `/admin/content/${type}/${rawId}` : '/admin/content', { capability: 'content:edit' });
  // An unknown type or a malformed id is a missing page, not an error page; any other failure (the database) still reaches error.tsx.
  if (!wellFormed || !isContentType(type)) notFound();
  const id = rawId.toLowerCase();
  const item = await getContent(viewer, type, id).catch((error: unknown) => {
    if (error instanceof AppError && error.code === 'NOT_FOUND') return null;
    throw error;
  });
  if (!item) notFound();

  const canPublish = viewer.capabilities.has('content:publish');
  const labels = CONTENT_LABELS[type];
  const readOnlyReason =
    item.status === 'archived'
      ? 'Archived items are read-only. Restore it to a draft to change it.'
      : item.status === 'published' && !canPublish
        ? 'This is live on the site, so changing it needs publish permission.'
        : undefined;
  const activity = await getActivity({ entityType: KINDS[type].entity, entityId: id }, { limit: 15 });

  return (
    <>
      <PageHeader
        title={item.title}
        description={`A ${labels.singular} in the ${labels.section} section.`}
        crumbs={[{ label: 'Website content', href: '/admin/content' }, { label: labels.plural, href: `/admin/content/${type}` }, { label: item.title }]}
        meta={<span className="flex flex-wrap items-center gap-1.5"><StatusBadge status={item.status} /><PermissionBadge item={item} /></span>}
      />
      <ContentNav active={type} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <EditorFor viewer={viewer} type={type} item={item} readOnlyReason={readOnlyReason} />
        </div>
        <div className="flex flex-col gap-6">
          <Panel>
            <PanelHeader title="Status" />
            <StatusActions type={type} id={item.id} title={item.title} status={item.status} blockers={item.blockers} canPublish={canPublish} noun={labels.singular} />
          </Panel>
          <Panel>
            <PanelHeader title="Details" />
            <DescriptionList
              columns={1}
              items={[
                ...(item.slug ? [{ label: 'Address name', value: <span className="font-pd-mono text-[13px]">{item.slug}</span> }] : []),
                { label: 'Last published', value: item.publishedAt ? `${formatDateTime(item.publishedAt)}${item.publishedBy ? ` by ${item.publishedBy}` : ''}` : 'Never' },
                { label: 'Last changed', value: `${formatDateTime(item.updatedAt)}${item.updatedBy ? ` by ${item.updatedBy}` : ''}` },
                { label: 'Created', value: formatDateTime(item.createdAt) },
              ]}
            />
          </Panel>
          <Panel>
            <PanelHeader title="Activity" />
            <AuditFeed entries={activity} emptyTitle="No activity yet" />
          </Panel>
        </div>
      </div>
    </>
  );
}
