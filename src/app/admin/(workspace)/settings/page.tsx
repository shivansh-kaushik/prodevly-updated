import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuditFeed } from '@/components/admin/audit-feed';
import { PageHeader } from '@/components/admin/page-header';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { getCurrentAdmin, requireAdminPage } from '@/lib/auth/page-guard';
import { timeZoneOptions } from '@/lib/validation/settings-text';
import { getActivity } from '@/services/activity.service';
import { readSettings } from '@/services/settings.service';
import { GeneralForm } from './_components/general-form';
import { SettingsNav } from './_components/settings-nav';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  // The sidebar's Settings link points here for anyone with settings:edit OR fx:edit. Someone who can
  // only edit rates belongs on the rates page, not on a 404.
  const { admin } = await getCurrentAdmin();
  if (admin && !admin.capabilities.has('settings:edit') && admin.capabilities.has('fx:edit')) redirect('/admin/settings/fx');

  const viewer = await requireAdminPage('/admin/settings', { capability: 'settings:edit' });
  const [settings, activity] = await Promise.all([readSettings(viewer), getActivity({ entityType: 'settings' }, { limit: 8 })]);
  const initial = {
    orgName: settings.orgName,
    timezone: settings.timezone,
    fyStartMonth: settings.fyStartMonth,
    workLogEditWindowDays: settings.workLogEditWindowDays,
    fxStaleDays: settings.fxStaleDays,
    enabledCurrencies: settings.enabledCurrencies,
  };

  return (
    <>
      <PageHeader title="Settings" description="Organisation details, the financial year and the currencies money entries can use. Only superadmins can change them." />
      <SettingsNav active="general" canEditSettings />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Keyed by the saved values: after a save the form starts again from what the server stored (it may have tidied the text). */}
        <GeneralForm key={JSON.stringify(initial)} initial={initial} zones={timeZoneOptions()} />
        <Panel className="h-fit">
          <PanelHeader title="Recent changes" />
          <AuditFeed entries={activity} emptyTitle="No changes yet" />
        </Panel>
      </div>
    </>
  );
}
