'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminApi } from '@/components/admin/api-provider';
import { EntityPicker, type PickerValue } from '@/components/admin/entity-picker';
import { FxField } from '@/components/admin/fx-field';
import { TABLE_FX, type FxValue } from '@/components/admin/fx-field-model';
import { MoneyInput, minorToInput, moneyToMinor, type MoneyValue } from '@/components/admin/money-input';
import { Button, LinkButton } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { TEAM_PAYOUT_BASES } from '@/config/statuses';
import { useForm } from '@/lib/admin/use-form';
import { AllocationEditor, rowAmounts, type AllocationRow } from './allocation-editor';
import { archivedWithTime, buildPayload, proposeRows, suggestedMoney } from './form-model';
import { PAYOUT_BASIS_LABELS } from './labels';
import { SuggestionPanel } from './suggestion-panel';
import { useSuggestion } from './use-suggestion';

/** What the form starts from. Creating starts mostly empty (the proposal fills the amount and the split); editing starts from the payout. */
export interface PayoutFormInitial {
  person: PickerValue | null;
  basis: string;
  periodFrom: string;
  periodTo: string;
  money: MoneyValue;
  dueOn: string;
  note: string;
  /** Present when editing: the stored split, which the proposal must not overwrite. */
  rows?: AllocationRow[];
  fx?: FxValue;
}

interface Values extends Record<string, unknown> {
  person: PickerValue | null;
  basis: string;
  periodFrom: string;
  periodTo: string;
  money: MoneyValue;
  dueOn: string;
  note: string;
}

/**
 * Record a team payout, or edit one that is still due. Pick the person and the period and the form shows what their pay
 * profile proposes; the amount and the split across projects follow the proposal until you change them. The INR value, the
 * rate captured for the due date and every project's INR share are worked out by the server.
 */
export function PayoutForm({
  mode,
  payoutId,
  initial,
  currencies,
}: {
  mode: 'create' | 'edit';
  payoutId?: string;
  initial: PayoutFormInitial;
  currencies: readonly string[];
}) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const editing = mode === 'edit';
  const form = useForm<Values>({
    person: initial.person,
    basis: initial.basis,
    periodFrom: initial.periodFrom,
    periodTo: initial.periodTo,
    money: initial.money,
    dueOn: initial.dueOn,
    note: initial.note,
  });
  const [fx, setFx] = useState<FxValue>(initial.fx ?? TABLE_FX);
  // `null` means "follow the proposal"; once a row is touched the person's split is theirs and the proposal stops overwriting it.
  const [edited, setEdited] = useState<AllocationRow[] | null>(initial.rows ?? null);
  const [basisTouched, setBasisTouched] = useState(editing);
  const [amountTouched, setAmountTouched] = useState(editing);

  const v = form.values;
  const suggestion = useSuggestion(v.person?.id ?? null, v.periodFrom, v.periodTo);
  const money = amountTouched ? v.money : suggestedMoney(suggestion.data, v.money);
  const basis = basisTouched ? v.basis : (suggestion.data?.payoutBasis ?? v.basis);
  const amountMinor = moneyToMinor(money);
  const proposed = useMemo(() => proposeRows(suggestion.data, amountMinor, money.currency), [suggestion.data, amountMinor, money.currency]);
  const rows = edited ?? proposed;
  const options = currencies.includes(money.currency) ? currencies : [...currencies, money.currency];
  const skipped = archivedWithTime(suggestion.data);

  const onSubmit = form.submit(async (values) => {
    const result = buildPayload({ personId: values.person?.id ?? null, basis, periodFrom: values.periodFrom, periodTo: values.periodTo, money, dueOn: values.dueOn, note: values.note, rows, fx }, mode);
    if (!result.ok) {
      form.setErrors(result.errors);
      return;
    }
    // Rows left empty are not sent. Dropping them from the form too keeps a server message about "row 2" on the row the person sees as 2.
    const amounts = rowAmounts(rows, money.currency);
    const kept = rows.filter((_, i) => (amounts[i] ?? 0) > 0);
    if (kept.length !== rows.length) setEdited(kept);
    const path = editing ? `/api/admin/team-payouts/${payoutId}` : '/api/admin/team-payouts';
    const data = await call<{ payout: { id: string; ref: string }; warnings: string[] }>(path, { method: editing ? 'PATCH' : 'POST', body: result.body });
    toast.show(editing ? `${data.payout.ref} saved.` : `${data.payout.ref} recorded. Mark it paid once the money has moved.`);
    router.push(`/admin/team/payouts/${data.payout.id}`);
    await new Promise(() => {}); // stay "submitting" while the page changes, so a second click cannot send it twice
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-3xl flex-col gap-8">
      <section className="flex flex-col gap-4" aria-label="Who and when">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Person"
            hint={editing ? 'To pay someone else, void this payout and record a new one.' : undefined}
            error={form.errors.adminId}
            required
          >
            {(c) => (
              <EntityPicker
                id={c.id}
                kind="admins"
                value={v.person}
                disabled={editing}
                required
                invalid={Boolean(form.errors.adminId)}
                describedBy={c['aria-describedby']}
                placeholder="Search the team"
                onChange={(p) => {
                  form.set('person', p);
                  if (!editing) {
                    setEdited(null);
                    setAmountTouched(false);
                    setBasisTouched(false);
                  }
                }}
              />
            )}
          </Field>
          <Field label="Kind of payout" error={form.errors.basis} required>
            {(c) => (
              <Select {...c} value={basis} onChange={(e) => { setBasisTouched(true); form.set('basis', e.target.value); }}>
                {TEAM_PAYOUT_BASES.map((b) => <option key={b} value={b}>{PAYOUT_BASIS_LABELS[b]}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Period from" hint="The first day this payout pays for." error={form.errors.periodFrom} required>
            {(c) => <Input {...c} type="date" value={v.periodFrom} onChange={(e) => form.set('periodFrom', e.target.value)} />}
          </Field>
          <Field label="Period to" hint="The last day. Marking it paid locks their time logs up to here." error={form.errors.periodTo} required>
            {(c) => <Input {...c} type="date" value={v.periodTo} onChange={(e) => form.set('periodTo', e.target.value)} />}
          </Field>
        </div>
        <SuggestionPanel
          state={suggestion}
          amountMinor={amountMinor}
          currency={money.currency}
          onUse={(amount, currency) => {
            setAmountTouched(true);
            form.set('money', { amount: minorToInput(amount, currency), currency });
          }}
        />
      </section>

      <section className="flex flex-col gap-4 border-t border-pd-rule pt-6" aria-label="Amount">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount" error={form.errors.amountMinor ?? form.errors.currency} required>
            {(c) => (
              <MoneyInput
                id={c.id}
                describedBy={c['aria-describedby']}
                invalid={Boolean(form.errors.amountMinor)}
                value={money}
                currencies={options}
                onChange={(m) => { setAmountTouched(true); form.set('money', m); }}
              />
            )}
          </Field>
          <Field label="Due on" hint="The exchange rate is taken for this date. Marking it paid takes it again for the day it was paid." error={form.errors.dueOn} required>
            {(c) => <Input {...c} type="date" value={v.dueOn} onChange={(e) => form.set('dueOn', e.target.value)} />}
          </Field>
        </div>
        <FxField currency={money.currency} amountMinor={amountMinor} date={v.dueOn} value={fx} onChange={setFx} error={form.errors.fxRate ?? form.errors.settledInrMinor ?? form.errors.manualRate} />
      </section>

      <section className="border-t border-pd-rule pt-6" aria-label="Split across projects">
        <AllocationEditor
          rows={rows}
          onChange={setEdited}
          onPropose={() => setEdited(null)}
          currency={money.currency}
          amountMinor={amountMinor}
          errors={form.errors}
          note={skipped > 0 ? `${skipped} archived ${skipped === 1 ? 'project holds' : 'projects hold'} time in this period. Archived projects cannot take a new cost, so ${skipped === 1 ? 'it is' : 'they are'} left out and that share stays overhead.` : undefined}
        />
      </section>

      <section className="border-t border-pd-rule pt-6" aria-label="Note">
        <Field label="Note" hint="Only superadmins can read this. The person it is for cannot." error={form.errors.note} className="max-w-xl">
          {(c) => <Textarea {...c} rows={2} maxLength={1000} value={v.note} onChange={(e) => form.set('note', e.target.value)} />}
        </Field>
      </section>

      {form.formError ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
      <div className="flex items-center gap-2 border-t border-pd-rule pt-5">
        <Button type="submit" variant="primary" loading={form.submitting}>{editing ? 'Save changes' : 'Record payout'}</Button>
        <LinkButton href={editing && payoutId ? `/admin/team/payouts/${payoutId}` : '/admin/team/payouts'} variant="ghost">Cancel</LinkButton>
      </div>
    </form>
  );
}
