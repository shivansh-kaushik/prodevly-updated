'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import { useAdminApi } from '@/components/admin/api-provider';
import { parseRateText } from '@/components/admin/fx-field-model';
import { Button, IconButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { formatDate } from '@/lib/admin/format';
import { useForm } from '@/lib/admin/use-form';

export interface RateRow {
  id: string;
  currency: string;
  /** "YYYY-MM-DD" */
  rateOn: string;
  rate: number;
  source: 'manual' | 'ecb';
}

type FormValues = { currency: string; rateOn: string; rate: string };

function RateDialog({ open, onClose, row, currencies, today }: { open: boolean; onClose: () => void; row?: RateRow; currencies: string[]; today: string }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const formId = useId();
  const form = useForm<FormValues>({ currency: row?.currency ?? currencies[0] ?? '', rateOn: row?.rateOn ?? today, rate: row ? String(row.rate) : '' });

  const onSubmit = form.submit(async (v) => {
    const rate = parseRateText(v.rate);
    if (rate === null) {
      form.setErrors({ rate: 'Enter the rate, for example 83.42. At most 6 decimals.' });
      return;
    }
    if (!v.rateOn) {
      form.setErrors({ rateOn: 'Pick the date this rate is for' });
      return;
    }
    if (row) {
      const body: { rate?: number; rateOn?: string } = {};
      if (rate !== row.rate) body.rate = rate;
      if (v.rateOn !== row.rateOn) body.rateOn = v.rateOn;
      if (Object.keys(body).length > 0) await call(`/api/admin/fx-rates/${row.id}`, { method: 'PATCH', body });
    } else {
      await call('/api/admin/fx-rates', { body: { currency: v.currency, rateOn: v.rateOn, rate } });
    }
    toast.show(row ? 'Rate saved.' : 'Rate added.');
    onClose();
    router.refresh();
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={row ? `Edit ${row.currency} rate` : 'Add a rate'}
      description={row ? undefined : 'A rate entered here is a manual rate. There can be one per currency per day.'}
      size="sm"
      dismissible={!form.submitting}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={form.submitting}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} loading={form.submitting}>{row ? 'Save rate' : 'Add rate'}</Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Currency" error={form.errors.currency} required>
          {(c) => (
            <Select {...c} value={form.values.currency} disabled={Boolean(row)} onChange={(e) => form.set('currency', e.target.value)}>
              {currencies.map((code) => <option key={code} value={code}>{code}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Date the rate is for" error={form.errors.rateOn} required>
          {(c) => <Input {...c} type="date" max={today} value={form.values.rateOn} onChange={(e) => form.set('rateOn', e.target.value)} />}
        </Field>
        <Field label={`Rate (INR per 1 ${form.values.currency})`} error={form.errors.rate} hint="At most 6 decimals, for example 83.42" required>
          {(c) => <Input {...c} inputMode="decimal" autoComplete="off" className="pd-figure text-right" value={form.values.rate} onChange={(e) => form.set('rate', e.target.value)} />}
        </Field>
        {row?.source === 'ecb' ? <p className="rounded-pd-sm bg-pd-well px-3 py-2 text-[13px] text-pd-ink-2">This rate came from the ECB. Saving a change makes it a manual rate, so the automatic fetch will leave it alone.</p> : null}
        {form.formError && Object.keys(form.errors).length === 0 ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
      </form>
    </Dialog>
  );
}

/** Opens the dialog fresh each time: a new key gives it a clean form, so a half-typed rate never lingers. */
export function AddRateButton({ currencies, today }: { currencies: string[]; today: string }) {
  const [open, setOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  return (
    <>
      <Button variant="primary" disabled={currencies.length === 0} onClick={() => { setNonce((n) => n + 1); setOpen(true); }}>
        <Plus className="size-4" aria-hidden /> Add rate
      </Button>
      <RateDialog key={nonce} open={open} onClose={() => setOpen(false)} currencies={currencies} today={today} />
    </>
  );
}

export function EditRateButton({ row, currencies, today }: { row: RateRow; currencies: string[]; today: string }) {
  const [open, setOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  return (
    <>
      <IconButton label={`Edit ${row.currency} rate for ${formatDate(row.rateOn)}`} onClick={() => { setNonce((n) => n + 1); setOpen(true); }}>
        <Pencil className="size-4" aria-hidden />
      </IconButton>
      <RateDialog key={nonce} open={open} onClose={() => setOpen(false)} row={row} currencies={currencies.includes(row.currency) ? currencies : [row.currency, ...currencies]} today={today} />
    </>
  );
}
