'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAdminApi } from '@/components/admin/api-provider';
import { FxField } from '@/components/admin/fx-field';
import { fxValueError, fxValueToPayload, TABLE_FX, type FxValue } from '@/components/admin/fx-field-model';
import { formatNative } from '@/components/admin/money';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Fieldset, Input, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { humanize } from '@/lib/admin/format';
import { useForm } from '@/lib/admin/use-form';
import { AttachmentsField, type AttachmentItem } from './attachments-field';

export interface MarkPaidPayout {
  id: string;
  ref: string;
  thirdPartyName: string;
  amountMinor: number;
  currency: string;
  /** "1 USD = INR 83 (table, 3 Oct 2026)": what was captured when the payout was recorded. */
  capture: string;
}

/**
 * Mark a due payout paid: the day the money left, how, and the reference. For a foreign currency the exchange rate is
 * captured AGAIN for the paid date, because that is when the INR left the account; the due-date capture stays in the
 * activity log. Superadmins only (`money:approve`): the page does not offer the button to anyone else.
 */
export function MarkPaidDialog({ open, onClose, payout, modes, today }: { open: boolean; onClose: () => void; payout: MarkPaidPayout; modes: readonly string[]; today: string }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [fx, setFx] = useState<FxValue>(TABLE_FX);
  const [files, setFiles] = useState<AttachmentItem[]>([]);
  const form = useForm({ paidOn: today, mode: modes[0] ?? '', transactionRef: '' });
  const foreign = payout.currency !== 'INR';

  const onSubmit = form.submit(async (v) => {
    const errors: Record<string, string> = {};
    if (!v.paidOn) errors.paidOn = 'Pick the day the money left the account';
    if (!v.mode) errors.mode = 'Pick how it was paid';
    if (v.mode !== 'cash' && v.transactionRef.trim() === '') errors.transactionRef = 'Enter the transaction reference (a bank UTR, a UPI id, a cheque number)';
    const fxProblem = foreign ? fxValueError(fx) : null;
    if (fxProblem) errors.fxRate = fxProblem;
    if (Object.keys(errors).length > 0) {
      form.setErrors(errors);
      return;
    }
    await call(`/api/admin/third-party-payouts/${payout.id}/mark-paid`, {
      body: {
        paidOn: v.paidOn,
        mode: v.mode,
        ...(v.transactionRef.trim() ? { transactionRef: v.transactionRef.trim() } : {}),
        ...(files.length > 0 ? { attachmentMediaIds: files.map((f) => f.id) } : {}),
        ...(foreign ? fxValueToPayload(fx) : {}),
      },
    });
    toast.show('Marked paid');
    onClose();
    router.refresh();
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Mark paid"
      description={`${payout.ref}: ${formatNative(payout.amountMinor, payout.currency)} to ${payout.thirdPartyName}`}
      size="md"
      dismissible={!form.submitting}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={form.submitting}>Cancel</Button>
          <Button variant="primary" type="submit" form={`mark-paid-${payout.id}`} loading={form.submitting}>Mark paid</Button>
        </>
      }
    >
      <form id={`mark-paid-${payout.id}`} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Paid on" error={form.errors.paidOn} hint="The day the money left the account." required>
            {(c) => <Input {...c} type="date" max={today} value={form.values.paidOn} onChange={(e) => form.set('paidOn', e.target.value)} />}
          </Field>
          <Field label="Paid by" error={form.errors.mode} required>
            {(c) => (
              <Select {...c} value={form.values.mode} onChange={(e) => form.set('mode', e.target.value)}>
                {modes.map((m) => <option key={m} value={m}>{humanize(m)}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Transaction reference" error={form.errors.transactionRef} hint={form.values.mode === 'cash' ? 'Optional for cash.' : 'A bank UTR, a UPI id, a cheque number. Needed unless it was cash.'} required={form.values.mode !== 'cash'}>
          {(c) => <Input {...c} maxLength={120} autoComplete="off" value={form.values.transactionRef} onChange={(e) => form.set('transactionRef', e.target.value)} />}
        </Field>
        {foreign ? (
          <>
            <p className="pd-figure text-[12px] text-pd-ink-3">Captured when recorded: {payout.capture}. It is captured again for the paid date, because that is when the INR left.</p>
            <FxField currency={payout.currency} amountMinor={payout.amountMinor} date={form.values.paidOn || today} value={fx} onChange={(next) => { setFx(next); form.setErrors({}); }} error={form.errors.fxRate ?? form.errors.settledInrMinor} />
          </>
        ) : null}
        <Fieldset legend="Transfer confirmation" hint="Optional. Added to the attachments already on this payout.">
          <AttachmentsField value={files} onChange={setFiles} error={form.errors.attachmentMediaIds} />
        </Fieldset>
        {form.formError ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
      </form>
    </Dialog>
  );
}
