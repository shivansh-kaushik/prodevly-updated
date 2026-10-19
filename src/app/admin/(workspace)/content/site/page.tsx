import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { getActivity } from '@/services/activity.service';
import { getSiteInfo } from '@/services/site-info.service';
import { AuditFeed } from '@/components/admin/audit-feed';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { ContentNav } from '../_components/content-nav';
import { SiteForm } from '../_components/site-form';

export const metadata: Metadata = { title: 'Company info' };

export default async function SiteInfoPage() {
  const viewer = await requireAdminPage('/admin/content/site', { capability: 'content:edit' });
  const [site, activity] = await Promise.all([getSiteInfo(viewer), getActivity({ entityType: 'site_info' }, { limit: 10 })]);
  const canPublish = viewer.capabilities.has('content:publish');

  return (
    <>
      <PageHeader
        title="Company info"
        description="Shown in the footer and wherever the site gives contact details. A field you leave empty is not shown."
        crumbs={[{ label: 'Website content', href: '/admin/content' }, { label: 'Company info' }]}
      />
      <ContentNav active="site" />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <SiteForm
          site={site}
          readOnlyReason={canPublish ? undefined : 'These details go live on the site the moment they are saved, so changing them needs publish permission.'}
        />
        <Panel className="self-start">
          <PanelHeader title="Activity" />
          <AuditFeed entries={activity} emptyTitle="No changes yet" />
        </Panel>
      </div>
    </>
  );
}
