'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminApi } from '@/components/admin/api-provider';
import { FxField } from '@/components/admin/fx-field';
import { fxValueError, fxValueToPayload, TABLE_FX, type FxValue } from '@/components/admin/fx-field-model';
import { formatNative } from '@/components/admin/money';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { formatCount, formatDate, humanize } from '@/lib/admin/format';
import { useForm } from '@/lib/admin/use-form';
import { periodText } from './labels';

export interface MarkPaidPayout {
  id: string;
  ref: string;
  adminName: string;
  amountMinor: number;
  currency: string;
  periodFrom: string;
  periodTo: string;
  /** The time logs paying it would lock, or null when unknown. */
  logsToLock: number | null;
  warnings: string[];
}

interface Values extends Record<string, unknown> {
  paidOn: string;
  mode: string;
  transactionRef: string;
}

/**
 * Marks a due payout paid: the date, how it was paid and the transaction reference. The exchange rate is taken again for that
 * date (table rate, the exact rate, or the INR that left the account), and the dialog says plainly that paying locks the time
 * logs in the period, so nobody is surprised by it afterwards.
 */
export function MarkPaidDialog({
  payout,
  open,
  onClose,
  paymentModes,
  today,
}: {
  payout: MarkPaidPayout;
  open: boolean;
  onClose: () => void;
  paymentModes: readonly string[];
  today: string;
}) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const formId = useId();
  const [fx, setFx] = useState<FxValue>(TABLE_FX);
  const form = useForm<Values>({ paidOn: today, mode: paymentModes[0] ?? '', transactionRef: '' });
  const foreign = payout.currency !== 'INR';

  const close = () => {
    if (form.submitting) return;
    form.setErrors({});
    form.setFormError(null);
    onClose();
  };

  const submit = form.submit(async (v) => {
    const problem = foreign ? fxValueError(fx) : null;
    if (problem) {
      form.setErrors({ fxRate: problem });
      return;
    }
    const data = await call<{ payout: { detail: { lockedLogs: number | null } | null } }>(`/api/admin/team-payouts/${payout.id}/mark-paid`, {
      body: { paidOn: v.paidOn, mode: v.mode, transactionRef: v.transactionRef, ...(foreign ? fxValueToPayload(fx) : {}) },
    });
    const locked = data.payout.detail?.lockedLogs ?? 0;
    toast.show(`${payout.ref} marked paid. ${formatCount(locked)} time ${locked === 1 ? 'entry is' : 'entries are'} now locked.`);
    onClose();
    router.refresh();
  });

  const period = `${formatDate(payout.periodFrom)} to ${formatDate(payout.periodTo)}`;
  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Mark ${payout.ref} paid`}
      description={`${formatNative(payout.amountMinor, payout.currency)} to ${payout.adminName} for ${periodText(payout.periodFrom, payout.periodTo)}.`}
      size="md"
      dismissible={!form.submitting}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={form.submitting}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} loading={form.submitting}>Mark paid</Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
        {payout.warnings.length > 0 ? (
          <ul className="flex flex-col gap-1 rounded-pd-sm bg-pd-amber-wash p-3 text-[13px] leading-5 font-medium text-pd-amber">
            {payout.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Paid on" error={form.errors.paidOn} required>
            {(c) => <Input {...c} type="date" max={today} value={form.values.paidOn} onChange={(e) => form.set('paidOn', e.target.value)} />}
          </Field>
          <Field label="Payment mode" error={form.errors.mode} required>
            {(c) => (
              <Select {...c} value={form.values.mode} onChange={(e) => form.set('mode', e.target.value)}>
                {paymentModes.map((m) => <option key={m} value={m}>{humanize(m)}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Transaction reference" hint="The bank or UPI reference. For cash, write the voucher number." error={form.errors.transactionRef} required>
          {(c) => <Input {...c} autoComplete="off" maxLength={120} value={form.values.transactionRef} onChange={(e) => form.set('transactionRef', e.target.value)} />}
        </Field>
        <FxField
          currency={payout.currency}
          amountMinor={payout.amountMinor}
          date={form.values.paidOn}
          value={fx}
          onChange={setFx}
          error={form.errors.fxRate ?? form.errors.settledInrMinor ?? form.errors.manualRate}
        />
        <p className="rounded-pd-sm bg-pd-well p-3 text-[13px] leading-5 text-pd-ink-2">
          {payout.logsToLock !== null && payout.logsToLock > 0
            ? `This locks ${formatCount(payout.logsToLock)} of ${payout.adminName}'s time ${payout.logsToLock === 1 ? 'entry' : 'entries'} from ${period}. `
            : `${payout.adminName} has no time logged from ${period} that this would lock. `}
          Nobody can change or add time on those days afterwards, and each project&apos;s share of the cost is fixed at the rate for the paid date. Voiding the payout unlocks the time.
        </p>
        {form.formError && Object.keys(form.errors).length === 0 ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
      </form>
    </Dialog>
  );
}
