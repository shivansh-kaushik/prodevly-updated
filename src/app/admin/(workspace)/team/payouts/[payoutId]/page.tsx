import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditFeed } from '@/components/admin/audit-feed';
import { PageHeader } from '@/components/admin/page-header';
import { Badge } from '@/components/ui/badge';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { AppError } from '@/lib/api/errors';
import { getCurrentAdmin, requireAdminPage } from '@/lib/auth/page-guard';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { parseObjectId } from '@/lib/validation/common';
import { getActivity } from '@/services/activity.service';
import { getSettings } from '@/services/settings.service';
import { getTeamPayout, type TeamPayoutDTO } from '@/services/team-payout.service';
import type { SessionUser } from '@/types/session';
import { PayoutActions } from '../_components/payout-actions';
import { AllocationsPanel, LockPanel, PayoutFacts, ProposalPanel } from '../_components/payout-detail';
import { basisLabel, periodText } from '../_components/labels';

/** A missing, malformed or not-yours payout is a 404 (the page does not confirm it exists); anything else is a real error. */
async function loadOrNull(viewer: SessionUser, id: string): Promise<TeamPayoutDTO | null> {
  try {
    return await getTeamPayout(viewer, parseObjectId(id));
  } catch (error) {
    if (error instanceof AppError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) return null;
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ payoutId: string }> }): Promise<Metadata> {
  const { admin } = await getCurrentAdmin();
  if (!admin) return { title: 'Payout' };
  const payout = await loadOrNull(admin, (await params).payoutId).catch(() => null);
  return { title: payout?.ref ?? 'Payout' };
}

export default async function PayoutPage({ params }: { params: Promise<{ payoutId: string }> }) {
  const { payoutId } = await params;
  // No capability here: the person a payout is for may open it (as the plain version). The service decides, and answers 404 to anyone else.
  const viewer = await requireAdminPage(`/admin/team/payouts/${payoutId}`);
  const payout = await loadOrNull(viewer, payoutId);
  if (!payout) notFound();

  const caps = viewer.capabilities;
  const full = payout.detail !== null;
  const settings = await getSettings();
  const today = formatDateOnly(todayDateOnly(new Date(), settings.timezone));
  const activity = full ? await getActivity({ entityType: 'teamPayout', entityId: payout.id }, { limit: 20 }) : [];
  const own = payout.adminId === viewer.id.toLowerCase();

  return (
    <>
      <PageHeader
        title={payout.ref}
        description={`${basisLabel(payout.basis)} for ${payout.adminName}, ${periodText(payout.periodFrom, payout.periodTo)}`}
        crumbs={[
          { label: 'Team', href: '/admin/team' },
          full ? { label: 'Payouts', href: '/admin/team/payouts' } : { label: 'Me', href: `/admin/team/${payout.adminId}?tab=pay` },
          { label: payout.ref },
        ]}
        meta={
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={payout.status} />
            {payout.status === 'due' && payout.dueOn && payout.dueOn < today ? <Badge tone="rubric">Overdue</Badge> : null}
            {own ? <Badge>You</Badge> : null}
          </span>
        }
        actions={
          full ? (
            <PayoutActions
              payout={{
                id: payout.id,
                ref: payout.ref,
                status: payout.status,
                adminName: payout.adminName,
                amountMinor: payout.amount.amountMinor,
                currency: payout.amount.currency,
                periodFrom: payout.periodFrom,
                periodTo: payout.periodTo,
                logsToLock: payout.detail?.logsToLock ?? null,
                lockedLogs: payout.detail?.lockedLogs ?? null,
                warnings: payout.detail?.warnings ?? [],
              }}
              canEdit={caps.has('teamPayout:record')}
              canPay={caps.has('money:approve')}
              canVoid={caps.has('money:void')}
              paymentModes={settings.paymentModes}
              today={today}
            />
          ) : undefined
        }
      />

      {payout.detail && payout.detail.warnings.length > 0 ? (
        <ul className="mb-6 flex flex-col gap-1 rounded-pd-md bg-pd-amber-wash p-4 text-[13px] leading-5 font-medium text-pd-amber" aria-label="Worth a second look">
          {payout.detail.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <PayoutFacts payout={payout} />
          <AllocationsPanel payout={payout} canViewProjects={caps.has('project:view')} />
        </div>
        {full ? (
          <div className="flex min-w-0 flex-col gap-6">
            <ProposalPanel payout={payout} />
            <LockPanel payout={payout} />
            <Panel>
              <PanelHeader title="Activity" />
              <AuditFeed entries={activity} emptyTitle="No activity yet" />
              <p className="pt-3 text-[13px]">
                <Link href={`/admin/team/payouts?adminId=${payout.adminId}`} prefetch={false} className="text-pd-ink-2 underline-offset-2 hover:underline">All payouts for {payout.adminName}</Link>
              </p>
            </Panel>
          </div>
        ) : null}
      </div>
    </>
  );
}
