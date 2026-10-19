'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/admin/api-client';
import { humanize } from '@/lib/admin/format';

/** Records that an approved expense has been paid back: the date, how, and the bank reference when there is one. */
export function MarkPaidDialog({
  open,
  onClose,
  id,
  today,
  paymentModes,
  payerName,
  amountText,
}: {
  open: boolean;
  onClose: () => void;
  id: string;
  today: string;
  paymentModes: string[];
  payerName: string | null;
  amountText: string;
}) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const formId = useId();
  const [paidOn, setPaidOn] = useState(today);
  const [mode, setMode] = useState('');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  function close() {
    if (busy) return;
    setErrors({});
    setError(undefined);
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const missing: Record<string, string> = {};
    if (!paidOn) missing.paidOn = 'Enter the date it was paid';
    if (!mode) missing.mode = 'Pick how it was paid';
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      return;
    }
    setBusy(true);
    setErrors({});
    setError(undefined);
    try {
      await call(`/api/admin/expenses/${id}/mark-paid`, { body: { paidOn, mode, ...(reference.trim() ? { transactionRef: reference.trim() } : {}) } });
      toast.show('Marked as paid');
      onClose();
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        if (Object.keys(err.fields).length === 0) setError(err.message);
      } else setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Mark as paid"
      description={`Record that ${payerName ?? 'they'} ${payerName ? 'has' : 'have'} been paid back ${amountText}.`}
      size="md"
      dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} loading={busy}>Mark as paid</Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Date paid" error={errors.paidOn} required>
          {(c) => <Input {...c} type="date" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />}
        </Field>
        <Field label="Paid by" error={errors.mode} required>
          {(c) => (
            <Select {...c} value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="">Pick how it was paid</option>
              {paymentModes.map((m) => <option key={m} value={m}>{humanize(m)}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Reference" error={errors.transactionRef} hint="Optional. The bank or UPI transaction reference. Cash has none.">
          {(c) => <Input {...c} maxLength={120} autoComplete="off" value={reference} onChange={(e) => setReference(e.target.value)} />}
        </Field>
        {error ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{error}</p> : null}
      </form>
    </Dialog>
  );
}
