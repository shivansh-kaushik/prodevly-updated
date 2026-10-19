'use client';

import { useRouter } from 'next/navigation';
import { useAdminApi } from '@/components/admin/api-provider';
import type { PickerValue } from '@/components/admin/entity-picker';
import { FxField } from '@/components/admin/fx-field';
import { MoneyInput, moneyToMinor } from '@/components/admin/money-input';
import { Button, LinkButton } from '@/components/ui/button';
import { Field, Fieldset, Input, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { humanize } from '@/lib/admin/format';
import { useForm } from '@/lib/admin/use-form';
import { ChoiceGroup } from './choice-group';
import { buildCreateBody, buildPatchBody, type ExpenseFormState, type PaidFrom } from './form-model';
import { ReceiptField } from './receipt-field';
import { ScopeFields } from './scope-fields';

/**
 * One form for every way an expense gets in: the company paid (needs expense:record), or you paid out of pocket and want
 * it back (any admin). The same form edits an expense that already exists. What it asks for adapts to the person and the
 * choice: a company payment asks when and how it was paid; a submission does not, because that is recorded when the
 * expense is reimbursed. The client, the INR value and the payer are never asked for: the server works them out.
 */
export interface ExpenseFormOptions {
  currencies: string[];
  categories: string[];
  paymentModes: string[];
  /** The organisation's calendar day, "YYYY-MM-DD": the latest date a spend or payment can carry. */
  today: string;
}

export interface ExpenseFormEdit {
  id: string;
  /** Payment details can be corrected only on a paid expense, and only by someone who records expenses. */
  editPayment: boolean;
  hiddenReceiptIds: string[];
  initialClient: PickerValue | null;
  /** Who paid, for the line that replaces the choice. */
  paidByLabel: string;
}

export function ExpenseForm({
  options,
  canRecord,
  canSubmit,
  initial,
  edit,
}: {
  options: ExpenseFormOptions;
  canRecord: boolean;
  canSubmit: boolean;
  initial: ExpenseFormState;
  edit?: ExpenseFormEdit;
}) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const form = useForm<ExpenseFormState>(initial);
  const v = form.values;
  const company = v.paidFrom === 'company';
  const showPayment = edit ? edit.editPayment : company;

  const onSubmit = form.submit(async (values) => {
    if (edit) {
      const built = buildPatchBody(initial, values, { paid: edit.editPayment, hiddenReceiptIds: edit.hiddenReceiptIds });
      if (!built.ok) {
        form.setErrors(built.errors);
        form.setFormError('Please check the highlighted fields.');
        return;
      }
      // Nothing changed: leave without a request (and without an audit entry).
      if (built.body !== null) {
        await call(`/api/admin/expenses/${edit.id}`, { method: 'PATCH', body: built.body });
        toast.show('Expense updated');
      }
      router.push(`/admin/expenses/${edit.id}`);
      await new Promise(() => {}); // stay busy until the page changes, so it cannot be sent twice
      return;
    }
    const built = buildCreateBody(values);
    if (!built.ok) {
      form.setErrors(built.errors);
      form.setFormError('Please check the highlighted fields.');
      return;
    }
    const data = await call<{ expense: { id: string } }>('/api/admin/expenses', { body: built.body });
    toast.show(values.paidFrom === 'company' ? 'Expense recorded' : 'Submitted. A superadmin will review it.');
    router.push(`/admin/expenses/${data.expense.id}`);
    await new Promise(() => {});
  });

  // A server message about a field disappears when the person changes what it was about, even when the form's own
  // name for the value differs from the API's field name (the money box holds `amountMinor` and `currency`).
  const clear = (...keys: string[]) =>
    form.setErrors((cur) => {
      const next = { ...cur };
      for (const k of keys) delete next[k];
      return next;
    });

  const submitLabel = edit ? 'Save changes' : company ? 'Record expense' : 'Submit for reimbursement';
  const e = form.errors;

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-3xl flex-col gap-8">
      {edit ? (
        <p className="text-[14px] text-pd-ink-2">{edit.paidByLabel}</p>
      ) : (
        <ChoiceGroup<PaidFrom>
          legend="Who paid?"
          value={v.paidFrom}
          onChange={(next) => form.set('paidFrom', next)}
          error={e.paidFrom}
          choices={[
            { value: 'company', title: 'The company paid', hint: canRecord ? 'Record it as paid, with the date and how.' : 'Only people who record expenses can do this.', disabled: !canRecord },
            { value: 'admin', title: 'I paid out of pocket', hint: canSubmit ? 'A superadmin reviews it and pays you back.' : 'Not available to your account.', disabled: !canSubmit },
          ]}
        />
      )}

      <ScopeFields
        scope={v.scope}
        project={v.project}
        task={v.task}
        initialClient={edit?.initialClient ?? null}
        onScope={(scope) => {
          form.set('scope', scope);
          if (scope === 'company') {
            form.set('project', null);
            form.set('task', null);
          }
        }}
        onProject={(p) => {
          form.set('project', p);
          clear('projectId', 'clientId', 'taskId');
        }}
        onTask={(t) => {
          form.set('task', t);
          clear('taskId');
        }}
        errors={e}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" error={e.category} required>
          {(c) => (
            <Select {...c} value={v.category} onChange={(ev) => form.set('category', ev.target.value)}>
              <option value="">Pick a category</option>
              {options.categories.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}
              {v.category && !options.categories.includes(v.category) ? <option value={v.category}>{humanize(v.category)}</option> : null}
            </Select>
          )}
        </Field>
        <Field label="Paid to" error={e.payee} hint="Optional. The shop, vendor or person.">
          {(c) => <Input {...c} maxLength={120} autoComplete="off" value={v.payee} onChange={(ev) => form.set('payee', ev.target.value)} />}
        </Field>
        <Field label="What was it for?" error={e.description} className="sm:col-span-2" required>
          {(c) => <Input {...c} maxLength={500} autoComplete="off" placeholder="For example: taxi to the client office" value={v.description} onChange={(ev) => form.set('description', ev.target.value)} />}
        </Field>
      </div>

      <Fieldset legend="Amount" hint="In the currency you paid in. It is converted to INR at the rate for the date it was spent.">
        <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <Field label="Amount and currency" error={e.amountMinor ?? e.currency} hideLabel required>
            {(c) => (
              <MoneyInput
                id={c.id}
                value={v.money}
                onChange={(m) => {
                  form.set('money', m);
                  clear('amountMinor', 'currency', 'fxRate', 'settledInrMinor', 'manualRate');
                }}
                currencies={options.currencies}
                invalid={Boolean(c['aria-invalid'])}
                describedBy={c['aria-describedby']}
              />
            )}
          </Field>
          <Field label="Date spent" error={e.spentOn} required>
            {(c) => <Input {...c} type="date" max={options.today} value={v.spentOn} onChange={(ev) => form.set('spentOn', ev.target.value)} />}
          </Field>
        </div>
        <div className="mt-4">
          <FxField
            currency={v.money.currency}
            amountMinor={moneyToMinor(v.money)}
            date={v.spentOn || null}
            value={v.fx}
            onChange={(fx) => {
              form.set('fx', fx);
              clear('fxRate', 'settledInrMinor', 'manualRate');
            }}
            error={e.fxRate ?? e.manualRate ?? e.settledInrMinor}
          />
        </div>
      </Fieldset>

      {showPayment ? (
        <Fieldset legend={company && !edit ? 'How it was paid' : 'Payment'} hint={company ? 'The date the company paid, and how.' : 'When and how it was reimbursed.'}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date paid" error={e.paidOn} required>
              {(c) => <Input {...c} type="date" max={options.today} value={v.paidOn} onChange={(ev) => form.set('paidOn', ev.target.value)} />}
            </Field>
            <Field label="Paid by" error={e.mode} required>
              {(c) => (
                <Select {...c} value={v.mode} onChange={(ev) => form.set('mode', ev.target.value)}>
                  <option value="">Pick how it was paid</option>
                  {options.paymentModes.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}
                  {v.mode && !options.paymentModes.includes(v.mode) ? <option value={v.mode}>{humanize(v.mode)}</option> : null}
                </Select>
              )}
            </Field>
            <Field label="Reference" error={e.transactionRef} hint="Optional. The bank or UPI transaction reference." className="sm:col-span-2">
              {(c) => <Input {...c} maxLength={120} autoComplete="off" value={v.transactionRef} onChange={(ev) => form.set('transactionRef', ev.target.value)} />}
            </Field>
          </div>
        </Fieldset>
      ) : null}

      <ReceiptField value={v.receipts} onChange={(r) => {
        form.set('receipts', r);
        clear('receiptMediaIds');
      }} error={e.receiptMediaIds} />

      {form.formError ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-pd-rule pt-5">
        <Button type="submit" variant="primary" loading={form.submitting} disabled={!edit && !canRecord && !canSubmit}>{submitLabel}</Button>
        <LinkButton href={edit ? `/admin/expenses/${edit.id}` : '/admin/expenses'} variant="ghost">Cancel</LinkButton>
      </div>
    </form>
  );
}
