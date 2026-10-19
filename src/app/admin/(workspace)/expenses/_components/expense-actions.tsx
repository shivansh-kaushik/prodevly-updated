'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Ban, Check, Pencil, Undo2, Wallet, X } from 'lucide-react';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button, LinkButton } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import type { ExpenseAbilities } from '@/services/expense.service';
import { MarkPaidDialog } from './mark-paid-dialog';

type Which = 'approve' | 'reject' | 'pay' | 'void' | null;

/**
 * What this person can do to this expense, as buttons. Only the actions they are allowed appear (`can`, worked out on
 * the server); the server refuses any other. Each one is audited. `withdraw` words the void action for a submitter
 * taking back their own expense instead of a superadmin voiding one.
 */
export function ExpenseActions({
  id,
  can,
  amountText,
  payerName,
  withdraw,
  today,
  paymentModes,
}: {
  id: string;
  can: ExpenseAbilities;
  amountText: string;
  payerName: string | null;
  withdraw: boolean;
  today: string;
  paymentModes: string[];
}) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [which, setWhich] = useState<Which>(null);
  const close = () => setWhich(null);

  const nothing = !can.edit && !can.approve && !can.reject && !can.markPaid && !can.void;
  if (nothing) return <p className="text-[13px] text-pd-ink-3">There is nothing you can do to this expense.</p>;

  // `body` is never undefined: the API client turns a body-less call into a GET, and every action here is a POST.
  const act = async (path: string, body: object, done: string) => {
    await call(`/api/admin/expenses/${id}/${path}`, { body });
    toast.show(done);
    router.refresh();
  };

  return (
    <div className="flex flex-col items-stretch gap-2">
      {can.approve ? <Button variant="primary" onClick={() => setWhich('approve')} className="justify-start"><Check className="size-4" aria-hidden /> Approve</Button> : null}
      {can.markPaid ? <Button variant="primary" onClick={() => setWhich('pay')} className="justify-start"><Wallet className="size-4" aria-hidden /> Mark as paid</Button> : null}
      {can.edit ? <LinkButton href={`/admin/expenses/${id}/edit`} variant="secondary" className="justify-start"><Pencil className="size-4" aria-hidden /> Edit</LinkButton> : null}
      {can.reject ? <Button variant="danger" onClick={() => setWhich('reject')} className="justify-start"><X className="size-4" aria-hidden /> Reject</Button> : null}
      {can.void ? (
        <Button variant="danger" onClick={() => setWhich('void')} className="justify-start">
          {withdraw ? <Undo2 className="size-4" aria-hidden /> : <Ban className="size-4" aria-hidden />} {withdraw ? 'Withdraw' : 'Void'}
        </Button>
      ) : null}

      {/* A dialog is mounted only for an action this person may take, so it is never in the page for anyone else. */}
      {can.approve ? (
        <ConfirmDialog
          open={which === 'approve'}
          onClose={close}
          title="Approve this expense?"
          description={`${payerName ?? 'The person who paid'} will be owed ${amountText}. Mark it as paid once you have paid them back.`}
          confirmLabel="Approve"
          tone="primary"
          onConfirm={() => act('approve', {}, 'Approved')}
        />
      ) : null}
      {can.reject ? (
        <ConfirmDialog
          open={which === 'reject'}
          onClose={close}
          title="Reject this expense?"
          description="It stays on record, tagged Rejected, and counts in no total. The person sees your reason."
          confirmLabel="Reject expense"
          reason={{ label: 'Why is it being rejected?', placeholder: 'Personal cost, no receipt, over the limit...' }}
          onConfirm={(reason) => act('reject', { reason }, 'Rejected')}
        />
      ) : null}
      {can.void ? (
        <ConfirmDialog
          open={which === 'void'}
          onClose={close}
          title={withdraw ? 'Withdraw this expense?' : 'Void this expense?'}
          description={
            withdraw
              ? 'It stays on record as void and is not counted. You can submit a new one.'
              : 'It stays on record, tagged Void, and leaves every total. This cannot be undone.'
          }
          confirmLabel={withdraw ? 'Withdraw expense' : 'Void expense'}
          reason={{
            label: withdraw ? 'Why are you withdrawing it?' : 'Why is it being voided?',
            placeholder: withdraw ? 'Entered by mistake, paid by someone else...' : 'Recorded twice, wrong amount...',
          }}
          onConfirm={(reason) => act('void', { reason }, withdraw ? 'Withdrawn' : 'Voided')}
        />
      ) : null}
      {can.markPaid ? (
        <MarkPaidDialog open={which === 'pay'} onClose={close} id={id} today={today} paymentModes={paymentModes} payerName={payerName} amountText={amountText} />
      ) : null}
    </div>
  );
}
