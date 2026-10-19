import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { AppError } from '@/lib/api/errors';
import { objectIdParam, type RawSearchParams } from '@/lib/admin/search-params';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { getPaymentContext, type PaymentContextDTO } from '@/services/client-payment.service';
import { getSettings } from '@/services/settings.service';
import { PaymentForm } from '../_components/payment-form';

export const metadata: Metadata = { title: 'Record payment' };

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage('/admin/payments/new', { capability: 'payment:record' });
  // `?projectId=` lets a project page link straight here with its project already chosen.
  const projectId = objectIdParam(await searchParams, 'projectId');
  let context: PaymentContextDTO | null = null;
  if (projectId) {
    try {
      context = await getPaymentContext(viewer, projectId);
    } catch (error) {
      if (!(error instanceof AppError && error.code === 'NOT_FOUND')) throw error;
    }
  }
  const settings = await getSettings();
  const caps = viewer.capabilities;

  return (
    <>
      <PageHeader
        title="Record payment"
        description="Money that reached the account from a client, or a refund to one. A recorded entry is final until it is voided."
        crumbs={[{ label: 'Client payments', href: '/admin/payments' }, { label: 'Record payment' }]}
      />
      <PaymentForm
        settings={{ currencies: settings.enabledCurrencies, modes: settings.paymentModes, today: formatDateOnly(todayDateOnly(new Date(), settings.timezone)) }}
        canAdvance={caps.has('money:approve')}
        lookups={{ clients: caps.has('client:view'), projects: caps.has('project:view'), tasks: caps.has('task:view') }}
        initialContext={context}
      />
    </>
  );
}
