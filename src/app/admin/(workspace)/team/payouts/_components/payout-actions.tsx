'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, CheckCircle2, Pencil } from 'lucide-react';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button, LinkButton } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { formatCount } from '@/lib/admin/format';
import { MarkPaidDialog, type MarkPaidPayout } from './mark-paid-dialog';

export interface ActionsPayout extends MarkPaidPayout {
  status: 'due' | 'paid' | 'void';
  /** The time logs this payout locks now (paid), for the void dialog. */
  lockedLogs: number | null;
}

/** Edit, mark paid and void: each button appears only for the capability that allows it, and only while the payout's state allows it. */
export function PayoutActions({
  payout,
  canEdit,
  canPay,
  canVoid,
  paymentModes,
  today,
}: {
  payout: ActionsPayout;
  canEdit: boolean;
  canPay: boolean;
  canVoid: boolean;
  paymentModes: readonly string[];
  today: string;
}) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [open, setOpen] = useState<'pay' | 'void' | null>(null);
  const due = payout.status === 'due';
  const mayVoid = canVoid && payout.status !== 'void';
  const locked = payout.lockedLogs ?? 0;

  return (
    <>
      {canEdit && due ? (
        <LinkButton href={`/admin/team/payouts/${payout.id}/edit`} variant="secondary">
          <Pencil className="size-4" aria-hidden /> Edit
        </LinkButton>
      ) : null}
      {canPay && due ? (
        <Button variant="primary" onClick={() => setOpen('pay')}>
          <CheckCircle2 className="size-4" aria-hidden /> Mark paid
        </Button>
      ) : null}
      {mayVoid ? (
        <Button variant="danger" onClick={() => setOpen('void')}>
          <Ban className="size-4" aria-hidden /> Void
        </Button>
      ) : null}

      {canPay && due ? <MarkPaidDialog payout={payout} open={open === 'pay'} onClose={() => setOpen(null)} paymentModes={paymentModes} today={today} /> : null}

      {mayVoid ? (
        <ConfirmDialog
          open={open === 'void'}
          onClose={() => setOpen(null)}
          title={`Void ${payout.ref}?`}
          description={
            <>
              <p>
                It stays on record but drops out of every total and every project&apos;s cost.
                {payout.status === 'paid' ? ` The ${formatCount(locked)} time ${locked === 1 ? 'entry' : 'entries'} it locked ${locked === 1 ? 'is' : 'are'} released.` : ''}
              </p>
              <p className="mt-2">This cannot be undone. To pay again, record a new payout.</p>
            </>
          }
          confirmLabel="Void payout"
          reason={{ label: 'Why is it being voided?', placeholder: 'Entered for the wrong month, paid twice...' }}
          onConfirm={async (reason) => {
            await call(`/api/admin/team-payouts/${payout.id}/void`, { body: { reason } });
            toast.show(`${payout.ref} voided.`);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
