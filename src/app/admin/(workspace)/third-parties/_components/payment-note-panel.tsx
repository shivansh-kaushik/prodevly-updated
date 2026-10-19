'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/field';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { useToast } from '@/components/ui/toast';
import { useForm } from '@/lib/admin/use-form';

/**
 * Where to send the money: bank, UPI, PayPal or Wise details. The server renders this panel ONLY for a viewer who
 * holds `thirdParty:payDetails` (superadmins); nobody else is handed the text at all. It is never in a list and is
 * redacted from the activity log, so this panel is the one place it is shown.
 */
export function PaymentNotePanel({ id, note, canEdit }: { id: string; note: string | null; canEdit: boolean }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const form = useForm({ paymentNote: note ?? '' });

  const onSubmit = form.submit(async (v) => {
    const next = v.paymentNote.trim();
    if (next === (note ?? '')) {
      setOpen(false);
      return;
    }
    await call(`/api/admin/third-parties/${id}`, { method: 'PATCH', body: { paymentNote: next === '' ? null : next } });
    toast.show(next === '' ? 'Payment details removed' : 'Payment details saved');
    setOpen(false);
    router.refresh();
  });

  return (
    <Panel>
      <PanelHeader
        title="Payment details"
        hint="Visible to superadmins only. Never shown in a list or written to the activity log."
        action={canEdit ? <Button size="sm" variant="secondary" onClick={() => { form.reset({ paymentNote: note ?? '' }); setOpen(true); }}><Pencil className="size-3.5" aria-hidden /> {note ? 'Edit' : 'Add'}</Button> : undefined}
      />
      {note ? (
        <pre className="font-pd-mono text-[13px] leading-5 break-words whitespace-pre-wrap text-pd-ink">{note}</pre>
      ) : (
        <p className="text-[14px] text-pd-ink-3">No payment details saved yet.</p>
      )}
      {open ? (
        <Dialog
          open
          onClose={() => setOpen(false)}
          title="Payment details"
          description="Where the money should go. Check it twice: a wrong account number is a payout sent to the wrong person."
          size="md"
          dismissible={!form.submitting}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={form.submitting}>Cancel</Button>
              <Button variant="primary" type="submit" form={`payment-note-${id}`} loading={form.submitting}>Save</Button>
            </>
          }
        >
          <form id={`payment-note-${id}`} onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
            <Field label="Bank, UPI, PayPal or Wise details" error={form.errors.paymentNote} hint="Leave empty to remove them.">
              {(c) => <Textarea {...c} autoFocus rows={5} maxLength={1000} autoComplete="off" value={form.values.paymentNote} onChange={(e) => form.set('paymentNote', e.target.value)} />}
            </Field>
            {form.formError ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
          </form>
        </Dialog>
      ) : null}
    </Panel>
  );
}
