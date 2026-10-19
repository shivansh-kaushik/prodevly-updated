'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BadgeCheck, Ban, Pencil } from 'lucide-react';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { MarkPaidDialog, type MarkPaidPayout } from './mark-paid-dialog';
import { PayoutForm, type PayoutFormInitial } from './payout-form';

/**
 * What can be done to one payout, by who may do it: edit while it is due (`payout:record`), mark it paid
 * (`money:approve`), void it with a reason (`money:void`). The page passes only what this viewer holds.
 */
export function PayoutActions({
  payout,
  status,
  form,
  currencies,
  modes,
  today,
  can,
}: {
  payout: MarkPaidPayout;
  status: 'due' | 'paid' | 'void';
  form: PayoutFormInitial;
  currencies: readonly string[];
  modes: readonly string[];
  today: string;
  can: { edit: boolean; approve: boolean; void: boolean };
}) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [which, setWhich] = useState<'edit' | 'pay' | 'void' | null>(null);
  const close = () => setWhich(null);
  const due = status === 'due';

  return (
    <>
      {due && can.approve ? <Button variant="primary" onClick={() => setWhich('pay')}><BadgeCheck className="size-4" aria-hidden /> Mark paid</Button> : null}
      {due && can.edit ? <Button variant="secondary" onClick={() => setWhich('edit')}><Pencil className="size-4" aria-hidden /> Edit</Button> : null}
      {status !== 'void' && can.void ? <Button variant="danger" onClick={() => setWhich('void')}><Ban className="size-4" aria-hidden /> Void</Button> : null}

      {which === 'pay' ? <MarkPaidDialog open onClose={close} payout={payout} modes={modes} today={today} /> : null}
      {which === 'edit' ? (
        <Dialog open onClose={close} title="Edit payout" description="Only a payout that is still due can be edited. Changes are recorded in the activity log." variant="drawer">
          <PayoutForm initial={form} currencies={currencies} today={today} onDone={close} />
        </Dialog>
      ) : null}
      {which === 'void' ? (
        <ConfirmDialog
          open
          onClose={close}
          title={`Void ${payout.ref}?`}
          description={
            status === 'paid'
              ? 'This payout is marked paid. Voiding it removes the cost from every total and from the project margin, and leaves the record visible with a Void tag. It cannot be undone: record a new payout if money really moved.'
              : 'A voided payout counts nowhere. The record stays visible with a Void tag and the reason you give. It cannot be undone.'
          }
          confirmLabel="Void payout"
          reason={{ label: 'Why is it void?', placeholder: 'Entered against the wrong work order...' }}
          onConfirm={async (reason) => {
            await call(`/api/admin/third-party-payouts/${payout.id}/void`, { body: { reason } });
            toast.show('Payout voided');
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
