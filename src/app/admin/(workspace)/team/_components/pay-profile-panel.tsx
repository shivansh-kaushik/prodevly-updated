'use client';

import { useRouter } from 'next/navigation';
import { useAdminApi } from '@/components/admin/api-provider';
import { MoneyInput, minorToInput, moneyToMinor, type MoneyValue } from '@/components/admin/money-input';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { DescriptionList } from '@/components/ui/panel';
import { Table, TableFrame, Td, THead, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { formatDate } from '@/lib/admin/format';
import { useForm } from '@/lib/admin/use-form';
import { formatMinor } from '@/lib/money/minor';
import type { PayProfileDTO } from '@/services/pay-profile.service';

/** How each basis is worded, and what the rate is "per". */
const BASES = [
  { value: 'monthly', label: 'Monthly salary', per: 'per month' },
  { value: 'hourly', label: 'Hourly', per: 'per hour' },
  { value: 'per_task', label: 'Per task', per: 'per task' },
  { value: 'none', label: 'No pay basis', per: '' },
] as const;
type Basis = (typeof BASES)[number]['value'];
const basisOf = (value: string) => BASES.find((b) => b.value === value) ?? BASES[3];

const rateText = (p: { basis: string; rateMinor: number; currency: string }) =>
  p.basis === 'none' ? 'No pay basis' : `${formatMinor(p.rateMinor, p.currency)} ${basisOf(p.basis).per}`;

interface Values extends Record<string, unknown> {
  basis: Basis;
  money: MoneyValue;
  effectiveFrom: string;
  payoutNote: string;
}

/**
 * One person's pay: the current terms, and for a superadmin the form to change them and the history.
 * The person themself sees the terms only (the server sends them nothing more). Saving needs a recent
 * password confirmation, which `useAdminApi().call` asks for when the server says so. Mounted by the person
 * page; it takes plain data and never reads pay itself.
 *
 * `today` bounds the start date: a change cannot start in the future. Keeping the date corrects the current
 * terms; a later date starts new ones and moves the old into history.
 */
export function PayProfilePanel({ profile, canEdit, currencies, today }: { profile: PayProfileDTO; canEdit: boolean; currencies: readonly string[]; today: string }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const entitledToNote = profile.payoutNote !== undefined;
  const options = currencies.includes(profile.currency) ? currencies : [...currencies, profile.currency];
  const form = useForm<Values>({
    basis: profile.basis,
    money: { amount: profile.basis === 'none' ? '' : minorToInput(profile.rateMinor, profile.currency), currency: profile.currency },
    effectiveFrom: profile.effectiveFrom ?? today,
    payoutNote: profile.payoutNote ?? '',
  });

  const onSubmit = form.submit(async (v) => {
    const rateMinor = v.basis === 'none' ? 0 : moneyToMinor(v.money);
    if (rateMinor === null) {
      form.setErrors({ rateMinor: 'Enter the rate as an amount, like 45,000.00' });
      return;
    }
    await call(`/api/admin/team/pay-profiles/${profile.adminId}`, {
      method: 'PUT',
      body: {
        basis: v.basis,
        rateMinor,
        currency: v.money.currency,
        effectiveFrom: v.effectiveFrom,
        ...(entitledToNote ? { payoutNote: v.payoutNote } : {}),
      },
    });
    toast.show('Pay profile saved.');
    router.refresh();
  });

  return (
    <div className="flex flex-col gap-6">
      <DescriptionList
        columns={3}
        items={[
          { label: 'Paid', value: profile.exists ? rateText(profile) : 'No pay basis recorded' },
          { label: 'In force since', value: profile.effectiveFrom ? formatDate(profile.effectiveFrom) : '' },
          ...(entitledToNote ? [{ label: 'Payout note', value: profile.payoutNote ?? '' }] : []),
        ]}
      />

      {canEdit ? (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 border-t border-pd-rule pt-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Basis" error={form.errors.basis} required>
              {(c) => (
                <Select {...c} value={form.values.basis} onChange={(e) => form.set('basis', e.target.value as Basis)}>
                  {BASES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                </Select>
              )}
            </Field>
            {form.values.basis !== 'none' ? (
              <Field label={`Rate ${basisOf(form.values.basis).per}`} error={form.errors.rateMinor ?? form.errors.currency} required>
                {(c) => <MoneyInput id={c.id} describedBy={c['aria-describedby']} invalid={Boolean(form.errors.rateMinor)} value={form.values.money} onChange={(m) => form.set('money', m)} currencies={options} />}
              </Field>
            ) : null}
          </div>
          <Field
            label="Takes effect on"
            hint="Keep the current date to correct these terms. Pick a later date to start new terms and keep the old ones in history."
            error={form.errors.effectiveFrom}
            required
            className="sm:max-w-xs"
          >
            {(c) => <Input {...c} type="date" max={today} value={form.values.effectiveFrom} onChange={(e) => form.set('effectiveFrom', e.target.value)} />}
          </Field>
          {entitledToNote ? (
            <Field label="Payout note" hint="Bank or UPI details. Only superadmins can read this, and it is kept out of the audit log." error={form.errors.payoutNote}>
              {(c) => <Textarea {...c} rows={2} maxLength={500} value={form.values.payoutNote} onChange={(e) => form.set('payoutNote', e.target.value)} />}
            </Field>
          ) : null}
          {form.formError && Object.keys(form.errors).length === 0 ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
          <div>
            <Button type="submit" variant="primary" loading={form.submitting}>Save pay profile</Button>
          </div>
        </form>
      ) : null}

      {profile.history && profile.history.length > 0 ? (
        <div>
          <h3 className="pb-2 text-[13px] font-medium text-pd-ink-2">Earlier terms</h3>
          <TableFrame>
            <Table caption="Earlier pay terms" className="min-w-[34rem]">
              <THead>
                <tr>
                  <Th>From</Th>
                  <Th>To</Th>
                  <Th>Terms</Th>
                  <Th>Replaced by</Th>
                </tr>
              </THead>
              <tbody>
                {[...profile.history].reverse().map((h) => (
                  <Tr key={`${h.effectiveFrom}-${h.effectiveTo}`}>
                    <Td>{formatDate(h.effectiveFrom)}</Td>
                    <Td>{formatDate(h.effectiveTo)}</Td>
                    <Td>{rateText(h)}</Td>
                    <Td muted>{h.changedBy}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableFrame>
        </div>
      ) : null}
    </div>
  );
}
