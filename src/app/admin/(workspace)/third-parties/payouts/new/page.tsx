import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { objectIdParam, type RawSearchParams } from '@/lib/admin/search-params';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { getSettings } from '@/services/settings.service';
import { getThirdPartyOption } from '@/services/third-party.service';
import { getProjectOption } from '@/services/third-party-payout.service';
import { getWorkOrder, isCurrentStatus, searchWorkOrders } from '@/services/work-order.service';
import { PATHS } from '../../_components/labels';
import { PayoutForm } from '../../_components/payout-form';

export const metadata: Metadata = { title: 'Record a payout' };

export default async function NewPayoutPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage(`${PATHS.payouts}/new`, { capability: 'payout:record' });
  const sp = await searchParams;
  // `?workOrder=`, `?thirdParty=` and `?project=` let a work order's, a third party's or a project's page link straight here.
  const workOrderId = objectIdParam(sp, 'workOrder');
  const order = workOrderId ? await getWorkOrder(viewer, workOrderId).catch(() => null) : null;
  const partyId = order?.thirdPartyId ?? objectIdParam(sp, 'thirdParty');
  const projectId = objectIdParam(sp, 'project');
  const [settings, party, project, orders] = await Promise.all([
    getSettings(),
    partyId ? getThirdPartyOption(viewer, partyId) : Promise.resolve(null),
    projectId && !order ? getProjectOption(viewer, projectId) : Promise.resolve(null),
    partyId ? searchWorkOrders(viewer, { thirdPartyId: partyId, status: 'current', sort: 'ref', dir: 'asc', pageSize: 50 }) : Promise.resolve(null),
  ]);
  const today = formatDateOnly(todayDateOnly(new Date(), settings.timezone));
  // A closed or cancelled work order cannot take new payouts, so it is not preselected.
  const preselected = order && isCurrentStatus(order.status) ? order.id : '';
  return (
    <>
      <PageHeader
        title="Record a payout"
        description="A payout is recorded as due. A superadmin marks it paid on the day the money leaves, which captures the exchange rate again."
        crumbs={[{ label: 'Third parties', href: PATHS.directory }, { label: 'Payouts', href: PATHS.payouts }, { label: 'Record a payout' }]}
      />
      <PayoutForm
        initialThirdParty={party}
        initialProject={project}
        initialOrders={orders?.items ?? []}
        initialOrderId={preselected}
        currencies={settings.enabledCurrencies}
        today={today}
      />
    </>
  );
}
