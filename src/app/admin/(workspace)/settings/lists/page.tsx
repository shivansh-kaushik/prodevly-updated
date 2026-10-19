import type { Metadata } from 'next';
import { AuditFeed } from '@/components/admin/audit-feed';
import { PageHeader } from '@/components/admin/page-header';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { getActivity } from '@/services/activity.service';
import { readSettings } from '@/services/settings.service';
import { ListsForm } from '../_components/lists-form';
import { SettingsNav } from '../_components/settings-nav';

export const metadata: Metadata = { title: 'Settings: lists' };

export default async function SettingsListsPage() {
  const viewer = await requireAdminPage('/admin/settings/lists', { capability: 'settings:edit' });
  const [settings, activity] = await Promise.all([readSettings(viewer), getActivity({ entityType: 'settings' }, { limit: 8 })]);
  const initial = {
    paymentModes: settings.paymentModes,
    expenseCategories: settings.expenseCategories,
    thirdPartyTypes: settings.thirdPartyTypes,
    budgetRanges: settings.budgetRanges,
  };

  return (
    <>
      <PageHeader title="Settings" description="The choices forms offer. Changing a list never changes a record that was already saved." />
      <SettingsNav active="lists" canEditSettings />
      <div className="flex flex-col gap-6">
        <ListsForm key={JSON.stringify(initial)} initial={initial} />
        <Panel>
          <PanelHeader title="Recent changes" />
          <AuditFeed entries={activity} emptyTitle="No changes yet" />
        </Panel>
      </div>
    </>
  );
}
