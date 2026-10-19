import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/admin/page-header';
import { minorToInput } from '@/components/admin/money-input';
import { AppError } from '@/lib/api/errors';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { parseObjectId } from '@/lib/validation/common';
import { getSettings } from '@/services/settings.service';
import { getTeamPayout, type TeamPayoutDTO } from '@/services/team-payout.service';
import { PayoutForm } from '../../_components/payout-form';

export const metadata: Metadata = { title: 'Edit payout' };

async function loadOrNull(id: string, viewer: Parameters<typeof getTeamPayout>[0]): Promise<TeamPayoutDTO | null> {
  try {
    return await getTeamPayout(viewer, parseObjectId(id));
  } catch (error) {
    if (error instanceof AppError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) return null;
    throw error;
  }
}

export default async function EditPayoutPage({ params }: { params: Promise<{ payoutId: string }> }) {
  const { payoutId } = await params;
  const viewer = await requireAdminPage(`/admin/team/payouts/${payoutId}/edit`, { capability: 'teamPayout:record' });
  const payout = await loadOrNull(payoutId, viewer);
  if (!payout || !payout.detail) notFound();
  // A paid or void payout cannot be edited; its page is where to void it.
  if (payout.status !== 'due') redirect(`/admin/team/payouts/${payout.id}`);
  const settings = await getSettings();

  return (
    <>
      <PageHeader
        title={`Edit ${payout.ref}`}
        description={`A payout can be changed while it is still due. Once it is marked paid it is final: void it and record a new one.`}
        crumbs={[{ label: 'Team', href: '/admin/team' }, { label: 'Payouts', href: '/admin/team/payouts' }, { label: payout.ref, href: `/admin/team/payouts/${payout.id}` }, { label: 'Edit' }]}
      />
      <PayoutForm
        mode="edit"
        payoutId={payout.id}
        currencies={settings.enabledCurrencies}
        initial={{
          person: { id: payout.adminId, label: payout.adminName },
          basis: payout.basis,
          periodFrom: payout.periodFrom,
          periodTo: payout.periodTo,
          money: { amount: minorToInput(payout.amount.amountMinor, payout.amount.currency), currency: payout.amount.currency },
          dueOn: payout.dueOn ?? payout.amount.fxDate,
          note: payout.detail.note ?? '',
          rows: payout.detail.allocations.map((a) => ({ projectId: a.projectId, label: a.projectName, ref: a.projectRef, minutes: a.minutes, amount: minorToInput(a.amountMinor, payout.amount.currency) })),
          fx: payout.amount.fxSource === 'manual' ? { choice: 'manual', manualRate: String(payout.amount.fxRate), settledInr: '' } : undefined,
        }}
      />
    </>
  );
}
