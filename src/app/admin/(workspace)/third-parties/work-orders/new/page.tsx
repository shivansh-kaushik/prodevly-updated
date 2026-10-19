import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { objectIdParam, type RawSearchParams } from '@/lib/admin/search-params';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { getSettings } from '@/services/settings.service';
import { getProjectOption } from '@/services/third-party-payout.service';
import { getThirdPartyOption } from '@/services/third-party.service';
import { PATHS } from '../../_components/labels';
import { WorkOrderForm } from '../../_components/work-order-form';

export const metadata: Metadata = { title: 'New work order' };

export default async function NewWorkOrderPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage(`${PATHS.workOrders}/new`, { capability: 'payout:record' });
  const sp = await searchParams;
  // `?thirdParty=` and `?project=` let a third party's page or a project's page link straight here with it chosen.
  const partyId = objectIdParam(sp, 'thirdParty');
  const projectId = objectIdParam(sp, 'project');
  const [settings, party, project] = await Promise.all([
    getSettings(),
    partyId ? getThirdPartyOption(viewer, partyId) : Promise.resolve(null),
    projectId ? getProjectOption(viewer, projectId) : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader
        title="New work order"
        description="What we agreed to pay a third party for a client's project. The client follows the project."
        crumbs={[{ label: 'Third parties', href: PATHS.directory }, { label: 'Work orders', href: PATHS.workOrders }, { label: 'New work order' }]}
      />
      <WorkOrderForm initialThirdParty={party} initialProject={project} currencies={settings.enabledCurrencies} />
    </>
  );
}
