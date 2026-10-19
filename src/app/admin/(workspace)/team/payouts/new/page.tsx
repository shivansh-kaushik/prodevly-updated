import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { first, objectIdParam, type RawSearchParams } from '@/lib/admin/search-params';
import { addDays, formatDateOnly, parseDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { getSettings } from '@/services/settings.service';
import { getTeamMember } from '@/services/team.service';
import { PayoutForm } from '../_components/payout-form';

export const metadata: Metadata = { title: 'Record a payout' };

/** The whole of last month, in the organisation's calendar: what a monthly payout usually pays for. */
function lastMonth(today: Date): { from: string; to: string } {
  const firstOfThisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const firstOfLast = new Date(Date.UTC(firstOfThisMonth.getUTCFullYear(), firstOfThisMonth.getUTCMonth() - 1, 1));
  return { from: formatDateOnly(firstOfLast), to: formatDateOnly(addDays(firstOfThisMonth, -1)) };
}

export default async function NewPayoutPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const viewer = await requireAdminPage('/admin/team/payouts/new', { capability: 'teamPayout:record' });
  const sp = await searchParams;
  const settings = await getSettings();
  const today = todayDateOnly(new Date(), settings.timezone);
  const defaults = lastMonth(today);
  const from = first(sp, 'from');
  const to = first(sp, 'to');
  const useGiven = from && to && parseDateOnly(from) && parseDateOnly(to);

  const adminId = objectIdParam(sp, 'adminId');
  // The person from the link (the person page offers one), looked up so the picker shows a name.
  const person = adminId ? await getTeamMember(viewer, adminId, { from: parseDateOnly(defaults.from) as Date, to: parseDateOnly(defaults.to) as Date }).catch(() => null) : null;

  return (
    <>
      <PageHeader
        title="Record a payout"
        description="It is recorded as due. Mark it paid once the money has moved: that is when the exchange rate is taken again and the time it covers is locked."
        crumbs={[{ label: 'Team', href: '/admin/team' }, { label: 'Payouts', href: '/admin/team/payouts' }, { label: 'New payout' }]}
      />
      <PayoutForm
        mode="create"
        currencies={settings.enabledCurrencies}
        initial={{
          person: person && adminId ? { id: adminId, label: person.name } : null,
          basis: 'salary',
          periodFrom: useGiven ? (from as string) : defaults.from,
          periodTo: useGiven ? (to as string) : defaults.to,
          money: { amount: '', currency: 'INR' },
          dueOn: formatDateOnly(today),
          note: '',
        }}
      />
    </>
  );
}
