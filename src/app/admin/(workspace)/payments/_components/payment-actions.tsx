'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Ban, Pencil } from 'lucide-react';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import type { MediaDTO } from '@/lib/media/types';
import type { PaymentDTO } from '@/services/client-payment.dto';
import { PaymentForm, type PaymentFormProps } from './payment-form';

/**
 * Edit and void, for an entry that is still received. Editing opens the form in a drawer; voiding asks for a
 * reason that goes into the audit log. A void entry is final, so it offers neither.
 */
export function PaymentActions({
  payment,
  attachments,
  canEdit,
  canVoid,
  form,
}: {
  payment: PaymentDTO;
  attachments: MediaDTO[];
  canEdit: boolean;
  canVoid: boolean;
  form: Pick<PaymentFormProps, 'settings' | 'canAdvance' | 'lookups'>;
}) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [which, setWhich] = useState<'edit' | 'void' | null>(null);
  if (payment.status !== 'received' || (!canEdit && !canVoid)) return null;

  return (
    <>
      {canEdit ? <Button variant="secondary" onClick={() => setWhich('edit')}><Pencil className="size-4" aria-hidden /> Edit</Button> : null}
      {canVoid ? <Button variant="danger" onClick={() => setWhich('void')}><Ban className="size-4" aria-hidden /> Void</Button> : null}

      {canEdit ? (
        <Dialog open={which === 'edit'} onClose={() => setWhich(null)} title={`Edit ${payment.ref}`} description="Changing the amount, currency or date works out the INR value again, unless the rate was set by hand or by the bank." variant="drawer">
          {which === 'edit' ? <PaymentForm {...form} initial={payment} attachments={attachments} onDone={() => setWhich(null)} /> : null}
        </Dialog>
      ) : null}

      {canVoid ? (
        <ConfirmDialog
          open={which === 'void'}
          onClose={() => setWhich(null)}
          title={`Void ${payment.ref}?`}
          description="The entry stays in the ledger with a Void tag, but it leaves every total. A milestone it had paid goes back to invoiced. This cannot be undone: record a new entry if the money did arrive."
          confirmLabel="Void payment"
          reason={{ label: 'Why is it void?', placeholder: 'Cheque bounced, entered twice, wrong client...' }}
          onConfirm={async (reason) => {
            await call(`/api/admin/payments/${payment.id}/void`, { body: { reason } });
            toast.show('Payment voided.');
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
