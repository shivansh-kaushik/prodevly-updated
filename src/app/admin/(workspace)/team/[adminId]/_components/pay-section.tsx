import Link from 'next/link';
import { Plus } from 'lucide-react';
import { LinkButton } from '@/components/ui/button';
import { Panel, PanelHeader } from '@/components/ui/panel';
import type { PayProfileDTO } from '@/services/pay-profile.service';
import type { TeamPayoutDTO } from '@/services/team-payout.service';
import { PayoutsTable } from '../../payouts/_components/payouts-table';
import { PayProfilePanel } from '../../_components/pay-profile-panel';

/**
 * The Pay tab of a person's page: how they are paid, and their latest payouts. Only the person themself and holders of
 * `team:payView` get here (the page decides), and the data in `payouts` is already what the viewer may see: the person reads
 * the plain version of their own, a superadmin the full one.
 */
export function PaySection({
  person,
  profile,
  payouts,
  canEditProfile,
  canRecord,
  canSeeAll,
  currencies,
  today,
  self,
}: {
  person: { id: string; name: string };
  profile: PayProfileDTO;
  payouts: TeamPayoutDTO[];
  canEditProfile: boolean;
  canRecord: boolean;
  canSeeAll: boolean;
  currencies: readonly string[];
  today: string;
  self: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Panel>
        <PanelHeader title={self ? 'How I am paid' : 'How they are paid'} hint={canEditProfile ? 'Changing it needs you to confirm your password.' : undefined} />
        <PayProfilePanel profile={profile} canEdit={canEditProfile} currencies={currencies} today={today} />
      </Panel>

      <Panel flush className="p-5">
        <PanelHeader
          title={self ? 'My payouts' : 'Payouts'}
          hint="Latest first"
          action={
            canRecord ? (
              <LinkButton href={`/admin/team/payouts/new?adminId=${person.id}`} variant="secondary" size="sm">
                <Plus className="size-3.5" aria-hidden /> Record a payout
              </LinkButton>
            ) : undefined
          }
        />
        <PayoutsTable
          payouts={payouts}
          today={today}
          showPerson={false}
          caption={`Payouts for ${person.name}`}
          empty={{ title: 'No payouts yet', body: self ? 'Payouts recorded for you appear here.' : `Nothing has been recorded for ${person.name}.` }}
        />
        {canSeeAll && payouts.length > 0 ? (
          <p className="pt-3 text-[13px]">
            <Link href={`/admin/team/payouts?adminId=${person.id}`} prefetch={false} className="text-pd-ink-2 underline-offset-2 hover:underline">All payouts for {person.name}</Link>
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
