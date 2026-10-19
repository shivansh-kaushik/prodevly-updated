import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/admin/page-header';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { CONTENT_LABELS, isContentType } from '@/lib/content/types';
import { ContentNav } from '../../_components/content-nav';
import { EditorFor } from '../../_components/editor-for';

export const metadata: Metadata = { title: 'New item' };

export default async function NewContentPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const viewer = await requireAdminPage(isContentType(type) ? `/admin/content/${type}/new` : '/admin/content', { capability: 'content:edit' });
  if (!isContentType(type)) notFound();
  const labels = CONTENT_LABELS[type];
  return (
    <>
      <PageHeader
        title={`New ${labels.singular}`}
        description="It starts as a draft. Nothing is public until someone with publish permission publishes it."
        crumbs={[{ label: 'Website content', href: '/admin/content' }, { label: labels.plural, href: `/admin/content/${type}` }, { label: 'New' }]}
      />
      <ContentNav active={type} />
      <EditorFor viewer={viewer} type={type} />
    </>
  );
}
