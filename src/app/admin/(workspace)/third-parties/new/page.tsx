import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { getSettings } from '@/services/settings.service';
import { PATHS } from '../_components/labels';
import { ThirdPartyForm } from '../_components/third-party-form';

export const metadata: Metadata = { title: 'New third party' };

export default async function NewThirdPartyPage() {
  const viewer = await requireAdminPage(`${PATHS.directory}/new`, { capability: 'thirdParty:edit' });
  const settings = await getSettings();
  return (
    <>
      <PageHeader
        title="New third party"
        description="A freelancer, agency or vendor we pay. You raise work orders and record payouts against them afterwards."
        crumbs={[{ label: 'Third parties', href: PATHS.directory }, { label: 'New third party' }]}
      />
      <ThirdPartyForm types={settings.thirdPartyTypes} currencies={settings.enabledCurrencies} canPayDetails={viewer.capabilities.has('thirdParty:payDetails')} />
    </>
  );
}
