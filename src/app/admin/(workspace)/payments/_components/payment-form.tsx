'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAdminApi } from '@/components/admin/api-provider';
import type { PickerValue } from '@/components/admin/entity-picker';
import { FxField } from '@/components/admin/fx-field';
import { TABLE_FX } from '@/components/admin/fx-field-model';
import { MoneyInput, moneyToMinor } from '@/components/admin/money-input';
import { Button, LinkButton } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { BASE_CURRENCY } from '@/config/currencies';
import { ApiError, qs } from '@/lib/admin/api-client';
import { cx } from '@/lib/cx';
import { humanize } from '@/lib/admin/format';
import { useForm } from '@/lib/admin/use-form';
import type { MediaDTO } from '@/lib/media/types';
import type { PaymentDTO } from '@/services/client-payment.dto';
import type { PaymentContextDTO } from '@/services/client-payment.service';
import { AttachmentsField } from './attachments-field';
import { ContractNote } from './contract-note';
import { buildCreateBody, buildEditBody, stateFromPayment, type PaymentFormState } from './payment-form-model';
import { PaymentLinksFields, type Lookups } from './payment-links-fields';

type Scalars = Omit<PaymentFormState, 'projectId' | 'taskId' | 'attachmentIds'>;

export interface PaymentFormProps {
  /** Option lists come from Settings; `today` is the organisation's today, so a browser in another zone cannot allow a future date. */
  settings: { currencies: string[]; modes: string[]; today: string };
  /** The advance tick is for people who may approve money (superadmins). */
  canAdvance: boolean;
  lookups: Lookups;
  /** Recording: a project chosen by the link that brought us here. */
  initialContext?: PaymentContextDTO | null;
  /** Editing: the entry, and its files described for this viewer. */
  initial?: PaymentDTO;
  attachments?: MediaDTO[];
  onDone?: () => void;
}

const TYPES = [
  { value: 'receipt', label: 'Receipt', hint: 'Money received' },
  { value: 'refund', label: 'Refund', hint: 'Money returned to the client' },
] as const;

/**
 * Records a payment, or edits one that is still received (the edit form lives in a drawer). The browser
 * sends the amount, the currency and the date, and never an INR value: the server looks the rate up and does
 * the sum. A foreign amount shows the rate it will use (<FxField>) and lets the person give the exact rate
 * the bank used, or the INR that arrived. The client is never asked for as data: it follows the project.
 */
export function PaymentForm({ settings, canAdvance, lookups, initialContext, initial, attachments, onDone }: PaymentFormProps) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const editing = Boolean(initial);
  const initialState = useMemo(() => (initial ? stateFromPayment(initial) : null), [initial]);

  const [context, setContext] = useState<PaymentContextDTO | null>(initialContext ?? null);
  const [contextFailed, setContextFailed] = useState(false);
  const [client, setClient] = useState<PickerValue | null>(
    initialContext ? { id: initialContext.client.id, label: initialContext.client.name } : initial ? { id: initial.client.id, label: initial.client.name } : null,
  );
  const [project, setProject] = useState<PickerValue | null>(
    initialContext ? { id: initialContext.project.id, label: initialContext.project.name, ref: initialContext.project.ref } : initial ? { id: initial.project.id, label: initial.project.name, ref: initial.project.ref } : null,
  );
  const [task, setTask] = useState<PickerValue | null>(initial?.task ? { id: initial.task.id, label: initial.task.title, ref: initial.task.ref } : null);
  const [files, setFiles] = useState<MediaDTO[]>(attachments ?? []);
  const form = useForm<Scalars>(
    initialState
      ? { ...initialState }
      : {
          type: 'receipt',
          amount: '',
          currency: initialContext?.contractCurrency ?? BASE_CURRENCY,
          receivedOn: settings.today,
          mode: settings.modes.includes('bank_transfer') ? 'bank_transfer' : (settings.modes[0] ?? ''),
          transactionRef: '',
          invoiceRef: '',
          note: '',
          tds: '',
          charges: '',
          contractEq: '',
          advance: false,
          milestoneId: '',
          fx: { ...TABLE_FX },
        },
  );
  const v = form.values;

  const { setValues } = form;
  /** Picking a project: its contract, what is billable and received, and its milestones. */
  const loadContext = useCallback(
    async (projectId: string) => {
      setContextFailed(false);
      try {
        const data = await call<{ context: PaymentContextDTO }>(`/api/admin/payments/context${qs({ projectId })}`);
        setContext(data.context);
        setClient({ id: data.context.client.id, label: data.context.client.name });
        // A payment is usually in the contract currency: start there, unless something was typed already.
        setValues((s) => (s.amount.trim() === '' ? { ...s, currency: data.context.contractCurrency } : s));
      } catch (e) {
        setContextFailed(true);
        if (e instanceof ApiError && e.status === 404) setProject(null);
      }
    },
    [call, setValues],
  );

  // Editing starts from a known project; its milestones and contract currency are fetched once.
  const editProjectId = initial?.project.id;
  useEffect(() => {
    if (!editProjectId) return;
    let live = true;
    call<{ context: PaymentContextDTO }>(`/api/admin/payments/context${qs({ projectId: editProjectId })}`)
      .then((data) => live && setContext(data.context))
      .catch(() => live && setContextFailed(true));
    return () => {
      live = false;
    };
  }, [editProjectId, call]);

  function changeProject(p: PickerValue | null) {
    setProject(p);
    setTask(null);
    setContext(null);
    form.set('milestoneId', '');
    if (p) void loadContext(p.id);
  }

  function changeClient(c: PickerValue | null) {
    setClient(c);
    // A project that belongs to another client no longer fits.
    if (c && context && context.client.id !== c.id) changeProject(null);
  }

  // The edit drawer is narrow even on a wide screen, so its fields stack; the page has room for two columns.
  const cols = editing ? 'grid gap-4' : 'grid gap-4 sm:grid-cols-2';
  const contractCurrency = context?.contractCurrency ?? initial?.contractCurrency ?? null;
  const otherCurrency = Boolean(contractCurrency && contractCurrency !== v.currency);
  const amountMinor = moneyToMinor({ amount: v.amount, currency: v.currency });
  const currencies = settings.currencies.includes(v.currency) ? settings.currencies : [...settings.currencies, v.currency];
  const modes = v.mode && !settings.modes.includes(v.mode) ? [...settings.modes, v.mode] : settings.modes;

  const onSubmit = form.submit(async (values) => {
    const state: PaymentFormState = { ...values, projectId: project?.id ?? null, taskId: task?.id ?? null, attachmentIds: files.map((f) => f.id) };
    const ctx = { contractCurrency };
    if (initial && initialState) {
      const built = buildEditBody(state, initialState, ctx);
      if (!built.ok) {
        form.setErrors(built.errors);
        form.setFormError('Please check the highlighted fields.');
        return;
      }
      if (Object.keys(built.body).length === 0) {
        toast.show('Nothing was changed');
        onDone?.();
        return;
      }
      const data = await call<{ payment: PaymentDTO }>(`/api/admin/payments/${initial.id}`, { method: 'PATCH', body: built.body });
      toast.show(['Payment updated.', ...data.payment.warnings].join(' '));
      onDone?.();
      router.refresh();
      return;
    }
    const built = buildCreateBody(state, ctx);
    if (!built.ok) {
      form.setErrors(built.errors);
      form.setFormError('Please check the highlighted fields.');
      return;
    }
    const data = await call<{ payment: PaymentDTO }>('/api/admin/payments', { body: built.body });
    toast.show(['Payment recorded.', ...data.payment.warnings].join(' '));
    router.push(`/admin/payments/${data.payment.id}`);
    await new Promise(() => {}); // stay "busy" until the navigation lands, so it cannot be submitted twice
  });

  return (
    <form onSubmit={onSubmit} noValidate className={cx('flex flex-col gap-7', !editing && 'max-w-3xl')}>
      <PaymentLinksFields
        editing={editing}
        client={client}
        project={project}
        task={task}
        context={context}
        contextFailed={contextFailed}
        milestoneId={v.milestoneId}
        errors={form.errors}
        lookups={lookups}
        onClient={changeClient}
        onProject={changeProject}
        onTask={setTask}
        onMilestone={(id) => form.set('milestoneId', id)}
      />

      {context ? <ContractNote context={context} editing={editing} /> : null}

      {editing ? (
        <p className="text-[13px] text-pd-ink-2">This is a <span className="font-medium text-pd-ink">{v.type}</span>. To change it to the other kind, void it and record a new one.</p>
      ) : (
        <div role="radiogroup" aria-label="Kind of entry" className="inline-flex w-full rounded-pd-sm bg-pd-well p-0.5 text-[13px] font-medium sm:w-fit">
          {TYPES.map((t) => (
            <label
              key={t.value}
              className={cx(
                'flex min-h-8 flex-1 cursor-pointer items-center justify-center rounded-[3px] px-4 whitespace-nowrap transition-colors pointer-coarse:min-h-11 sm:flex-none',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-pd-blue',
                v.type === t.value ? 'bg-pd-sheet text-pd-ink shadow-[0_0_0_1px_var(--color-pd-rule)]' : 'text-pd-ink-3 hover:text-pd-ink',
              )}
              title={t.hint}
            >
              <input type="radio" name="type" className="sr-only" checked={v.type === t.value} onChange={() => form.set('type', t.value)} />
              {t.label}
            </label>
          ))}
        </div>
      )}

      <div className={cols}>
        <Field label={v.type === 'refund' ? 'Amount refunded' : 'Amount received'} error={form.errors.amountMinor ?? form.errors.currency} hint="The net amount that reached the account." required>
          {(c) => (
            <MoneyInput
              id={c.id}
              value={{ amount: v.amount, currency: v.currency }}
              currencies={currencies}
              onChange={(m) => {
                form.set('amount', m.amount);
                form.set('currency', m.currency);
              }}
              invalid={Boolean(c['aria-invalid'])}
              describedBy={c['aria-describedby']}
            />
          )}
        </Field>
        <Field label="Date received" error={form.errors.receivedOn} required>
          {(c) => <Input {...c} type="date" max={settings.today} value={v.receivedOn} onChange={(e) => form.set('receivedOn', e.target.value)} />}
        </Field>
      </div>

      <FxField
        currency={v.currency}
        amountMinor={amountMinor}
        date={v.receivedOn || null}
        value={v.fx}
        onChange={(fx) => form.set('fx', fx)}
        error={form.errors.fxRate ?? form.errors.settledInrMinor}
      />

      {otherCurrency && contractCurrency ? (
        <Field
          label={`Counts toward the ${contractCurrency} contract as`}
          error={form.errors.contractEquivalentMinor}
          hint={`Optional. Leave it empty and we work it out from the exchange rates on that date. Type the amount in ${contractCurrency} to correct it.`}
        >
          {(c) => <Input {...c} inputMode="decimal" autoComplete="off" placeholder="0.00" className="pd-figure text-right sm:max-w-xs" value={v.contractEq} onChange={(e) => form.set('contractEq', e.target.value)} />}
        </Field>
      ) : null}

      <div className={cols}>
        <Field label="Mode" error={form.errors.mode} required>
          {(c) => (
            <Select {...c} value={v.mode} onChange={(e) => form.set('mode', e.target.value)}>
              {modes.map((m) => <option key={m} value={m}>{humanize(m)}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Transaction reference" error={form.errors.transactionRef} hint="The bank, UPI or platform reference.">
          {(c) => <Input {...c} maxLength={120} autoComplete="off" value={v.transactionRef} onChange={(e) => form.set('transactionRef', e.target.value)} />}
        </Field>
        <Field label="Invoice reference" error={form.errors.invoiceRef}>
          {(c) => <Input {...c} maxLength={60} autoComplete="off" value={v.invoiceRef} onChange={(e) => form.set('invoiceRef', e.target.value)} />}
        </Field>
        <Field label={`TDS deducted by the client (${v.currency})`} error={form.errors.tdsMinor} hint="Optional.">
          {(c) => <Input {...c} inputMode="decimal" autoComplete="off" placeholder="0.00" className="pd-figure text-right" value={v.tds} onChange={(e) => form.set('tds', e.target.value)} />}
        </Field>
        <Field label={`Bank or platform charges (${v.currency})`} error={form.errors.chargesMinor} hint="Optional.">
          {(c) => <Input {...c} inputMode="decimal" autoComplete="off" placeholder="0.00" className="pd-figure text-right" value={v.charges} onChange={(e) => form.set('charges', e.target.value)} />}
        </Field>
      </div>

      <Field label="Note" error={form.errors.note}>
        {(c) => <Textarea {...c} rows={3} maxLength={1000} value={v.note} onChange={(e) => form.set('note', e.target.value)} />}
      </Field>

      <AttachmentsField value={files} onChange={setFiles} error={form.errors.attachmentMediaIds} />

      {canAdvance ? (
        <div className="flex flex-col gap-1">
          <Checkbox label="Record as advance" checked={v.advance} onChange={(e) => form.set('advance', e.target.checked)} />
          <p className="text-[12px] leading-4 text-pd-ink-3">Only needed when this takes the total received above what is billable on the project. It is kept on the entry.</p>
        </div>
      ) : null}

      {form.formError ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
      <div className="flex items-center gap-2 border-t border-pd-rule pt-5">
        <Button type="submit" variant="primary" loading={form.submitting}>{editing ? 'Save changes' : v.type === 'refund' ? 'Record refund' : 'Record payment'}</Button>
        {editing ? <Button variant="ghost" onClick={onDone} disabled={form.submitting}>Cancel</Button> : <LinkButton href="/admin/payments" variant="ghost">Cancel</LinkButton>}
      </div>
    </form>
  );
}
