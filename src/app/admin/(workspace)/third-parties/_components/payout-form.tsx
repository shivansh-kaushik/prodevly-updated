'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAdminApi } from '@/components/admin/api-provider';
import { EntityPicker, type PickerValue } from '@/components/admin/entity-picker';
import { FxField } from '@/components/admin/fx-field';
import { fxValueError, fxValueToPayload, TABLE_FX, type FxValue } from '@/components/admin/fx-field-model';
import { formatNative } from '@/components/admin/money';
import { minorToInput, MoneyInput, moneyToMinor, type MoneyValue } from '@/components/admin/money-input';
import { Button, LinkButton } from '@/components/ui/button';
import { Field, Fieldset, Input, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { qs } from '@/lib/admin/api-client';
import { useForm } from '@/lib/admin/use-form';
import { minorToDecimal, parseMinor } from '@/lib/money/minor';
import type { WorkOrderListItemDTO } from '@/services/work-order.service';
import { AttachmentsField, type AttachmentItem } from './attachments-field';
import { PATHS } from './labels';

export interface PayoutFormInitial {
  id: string;
  amountMinor: number;
  currency: string;
  dueOn: string;
  tdsMinor: number | null;
  note: string;
  thirdPartyName: string;
  projectName: string;
  workOrder: { id: string; ref: string; title: string } | null;
  projectId: string;
  task: PickerValue | null;
  attachments: AttachmentItem[];
  /** "1 USD = INR 83.42 (table, 3 Oct 2026)": the capture on file, shown so a person can judge whether to change it. */
  capture: string;
}

/**
 * Record a payout (always as DUE), or edit one that is still due (in a drawer). With a work order the client, project and
 * task are copied from it and shown here read-only; without one they come from the cascading pickers. The exchange rate is
 * never typed as an INR value: the server computes it (`resolveFx`) from the table, the exact rate, or the INR that left.
 */
export function PayoutForm({
  initial,
  initialThirdParty,
  initialOrders = [],
  initialOrderId = '',
  initialProject,
  currencies,
  today,
  onDone,
}: {
  initial?: PayoutFormInitial;
  initialThirdParty?: PickerValue | null;
  initialOrders?: WorkOrderListItemDTO[];
  initialOrderId?: string;
  initialProject?: PickerValue | null;
  currencies: readonly string[];
  /** The organisation's today, "YYYY-MM-DD". */
  today: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const editing = Boolean(initial);
  const [party, setParty] = useState<PickerValue | null>(initialThirdParty ?? null);
  const [orders, setOrders] = useState<WorkOrderListItemDTO[]>(initialOrders);
  const [ordersError, setOrdersError] = useState(false);
  const [orderId, setOrderId] = useState(initialOrderId);
  const [client, setClient] = useState<PickerValue | null>(null);
  const [project, setProject] = useState<PickerValue | null>(initialProject ?? null);
  const [task, setTask] = useState<PickerValue | null>(initial?.task ?? null);
  const order = orders.find((o) => o.id === orderId) ?? null;
  const [money, setMoney] = useState<MoneyValue>(() => {
    if (initial) return { amount: minorToInput(initial.amountMinor, initial.currency), currency: initial.currency };
    const seed = initialOrders.find((o) => o.id === initialOrderId);
    return seed
      ? { amount: seed.balanceMinor > 0 ? minorToDecimal(seed.balanceMinor, seed.agreed.currency) : '', currency: seed.agreed.currency }
      : { amount: '', currency: currencies[0] ?? 'INR' };
  });
  const [tds, setTds] = useState(initial?.tdsMinor ? minorToDecimal(initial.tdsMinor, initial.currency) : '');
  const [fx, setFx] = useState<FxValue>(TABLE_FX);
  const [files, setFiles] = useState<AttachmentItem[]>(initial?.attachments ?? []);
  const form = useForm({ dueOn: initial?.dueOn ?? today, note: initial?.note ?? '' });

  const lockedCurrency = editing ? Boolean(initial?.workOrder) : Boolean(order);
  const amountMinor = moneyToMinor(money);

  async function loadOrders(partyId: string) {
    setOrdersError(false);
    try {
      const data = await call<{ items: WorkOrderListItemDTO[] }>(`/api/admin/work-orders${qs({ thirdParty: partyId, status: 'current', pageSize: 50, sort: 'ref', dir: 'asc' })}`);
      setOrders(data.items);
    } catch {
      setOrders([]);
      setOrdersError(true);
    }
  }

  function onParty(next: PickerValue | null) {
    setParty(next);
    setOrders([]);
    setOrderId('');
    form.setErrors({});
    if (next) void loadOrders(next.id);
  }

  function onOrder(nextId: string) {
    setOrderId(nextId);
    form.setErrors({});
    const next = orders.find((o) => o.id === nextId);
    if (!next) return;
    // The currency is the work order's; offer what is left to record as the amount.
    setMoney((m) => ({ currency: next.agreed.currency, amount: m.amount.trim() === '' && next.balanceMinor > 0 ? minorToDecimal(next.balanceMinor, next.agreed.currency) : m.amount }));
  }

  const onSubmit = form.submit(async (v) => {
    const errors: Record<string, string> = {};
    if (amountMinor === null) errors.amountMinor = 'Enter the amount, for example 1,250.50';
    const tdsMinor = tds.trim() === '' ? null : parseMinor(tds, money.currency);
    if (tds.trim() !== '' && tdsMinor === null) errors.tdsMinor = 'Enter the TDS amount, for example 125.00';
    const fxProblem = money.currency === 'INR' ? null : fxValueError(fx);
    if (fxProblem) errors.fxRate = fxProblem;
    if (!editing && !order) {
      if (!party) errors.thirdPartyId = 'Pick the third party we are paying';
      if (!project) errors.projectId = 'Pick the project this cost belongs to';
    }
    if (Object.keys(errors).length > 0 || amountMinor === null) {
      form.setErrors(errors);
      return;
    }
    const rate = money.currency === 'INR' ? {} : fxValueToPayload(fx);

    if (initial) {
      const body: Record<string, unknown> = { ...rate };
      if (amountMinor !== initial.amountMinor) body.amountMinor = amountMinor;
      if (money.currency !== initial.currency) body.currency = money.currency;
      if (v.dueOn !== initial.dueOn) body.dueOn = v.dueOn;
      if (tdsMinor !== initial.tdsMinor && !(tdsMinor === null && initial.tdsMinor === null)) body.tdsMinor = tdsMinor;
      if (v.note.trim() !== initial.note) body.note = v.note.trim() === '' ? null : v.note.trim();
      if (!initial.workOrder && (task?.id ?? null) !== (initial.task?.id ?? null)) body.taskId = task?.id ?? null;
      if (JSON.stringify(files.map((f) => f.id)) !== JSON.stringify(initial.attachments.map((f) => f.id))) body.attachmentMediaIds = files.map((f) => f.id);
      if (Object.keys(body).length === 0) {
        onDone?.();
        return;
      }
      const data = await call<{ warnings: string[] }>(`/api/admin/third-party-payouts/${initial.id}`, { method: 'PATCH', body });
      toast.show('Payout updated');
      for (const w of data.warnings) toast.show(w, 'error');
      onDone?.();
      router.refresh();
      return;
    }

    const data = await call<{ payout: { id: string }; warnings: string[] }>('/api/admin/third-party-payouts', {
      body: {
        ...(order ? { workOrderId: order.id } : { thirdPartyId: party?.id, projectId: project?.id, ...(task ? { taskId: task.id } : {}), currency: money.currency }),
        amountMinor,
        dueOn: v.dueOn,
        ...(tdsMinor !== null ? { tdsMinor } : {}),
        ...(v.note.trim() ? { note: v.note.trim() } : {}),
        attachmentMediaIds: files.map((f) => f.id),
        ...rate,
      },
    });
    toast.show('Payout recorded as due');
    for (const w of data.warnings) toast.show(w, 'error');
    router.push(`${PATHS.payouts}/${data.payout.id}`);
    await new Promise(() => {});
  });

  const linked = editing ? initial?.workOrder : order;

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-3xl flex-col gap-8">
      {editing ? (
        <p className="text-[14px] text-pd-ink-2">
          <span className="font-medium text-pd-ink">{initial?.thirdPartyName}</span> · {initial?.projectName}
          {initial?.workOrder ? <> · <span className="font-pd-mono text-[13px]">{initial.workOrder.ref}</span> {initial.workOrder.title}</> : null}
        </p>
      ) : (
        <Fieldset legend="Who is being paid" className="flex flex-col gap-4">
          <Field label="Third party" error={form.errors.thirdPartyId} required>
            {(c) => <EntityPicker kind="third-parties" id={c.id} value={party} onChange={onParty} placeholder="Search third parties" invalid={Boolean(c['aria-invalid'])} describedBy={c['aria-describedby']} required />}
          </Field>
          <Field label="Work order" error={form.errors.workOrderId} hint={ordersError ? 'We could not load their work orders. Try picking the third party again.' : !party ? 'Pick the third party first.' : orders.length === 0 ? 'They have no open work orders: this is a one-off payout.' : 'The client, project and task are copied from the work order.'}>
            {(c) => (
              <Select {...c} value={orderId} disabled={!party || orders.length === 0} onChange={(e) => onOrder(e.target.value)}>
                <option value="">No work order (one-off payout)</option>
                {orders.map((o) => <option key={o.id} value={o.id}>{o.ref} · {o.title} · {formatNative(Math.max(0, o.balanceMinor), o.agreed.currency)} left</option>)}
              </Select>
            )}
          </Field>
          {order ? (
            <p className="rounded-pd-sm bg-pd-well p-3 text-[13px] text-pd-ink-2">
              For <span className="font-medium text-pd-ink">{order.projectName}</span> ({order.clientName}){order.taskRef ? <>, task <span className="font-pd-mono">{order.taskRef}</span> {order.taskTitle}</> : null}. Agreed {formatNative(order.agreed.amountMinor, order.agreed.currency)}, paid {formatNative(order.paidMinor, order.agreed.currency)}, due {formatNative(order.dueMinor, order.agreed.currency)}.
            </p>
          ) : party ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Client" hint="Optional. Narrows the projects.">
                {(c) => <EntityPicker kind="clients" id={c.id} value={client} onChange={(p) => { setClient(p); setProject(null); setTask(null); }} placeholder="Any client" />}
              </Field>
              <Field label="Project" error={form.errors.projectId} required>
                {(c) => <EntityPicker kind="projects" id={c.id} clientId={client?.id} value={project} onChange={(p) => { setProject(p); setTask(null); form.setErrors({}); }} placeholder="Search projects" invalid={Boolean(c['aria-invalid'])} describedBy={c['aria-describedby']} required />}
              </Field>
              <Field label="Task" hint="Optional.">
                {(c) => <EntityPicker kind="tasks" id={c.id} projectId={project?.id} value={task} onChange={setTask} placeholder={project ? 'Search tasks' : 'Pick a project first'} disabled={!project} />}
              </Field>
            </div>
          ) : null}
        </Fieldset>
      )}
      {editing && !initial?.workOrder ? (
        <Field label="Task" hint="Optional. A task in this project.">
          {(c) => <EntityPicker kind="tasks" id={c.id} projectId={initial?.projectId} value={task} onChange={setTask} placeholder="Search tasks" />}
        </Field>
      ) : null}

      <Fieldset legend="Amount" className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount" error={form.errors.amountMinor ?? form.errors.currency} hint={linked ? `In the work order's currency (${money.currency}).` : undefined} required>
            {(c) => <MoneyInput id={c.id} value={money} onChange={(m) => { setMoney(m); form.setErrors({}); }} currencies={currencies} invalid={Boolean(c['aria-invalid'])} describedBy={c['aria-describedby']} lockCurrency={lockedCurrency} />}
          </Field>
          <Field label="Due date" error={form.errors.dueOn} hint="The exchange rate is captured for this day. It is captured again when the payout is marked paid." required>
            {(c) => <Input {...c} type="date" value={form.values.dueOn} onChange={(e) => form.set('dueOn', e.target.value)} />}
          </Field>
        </div>
        <FxField currency={money.currency} amountMinor={amountMinor} date={form.values.dueOn || today} value={fx} onChange={(next) => { setFx(next); form.setErrors({}); }} error={form.errors.fxRate ?? form.errors.settledInrMinor} />
        {editing && money.currency !== 'INR' && initial?.capture ? <p className="pd-figure -mt-2 text-[12px] text-pd-ink-3">On file: {initial.capture}. Leave the table rate selected to keep a rate typed by hand or applied by the bank, as long as the currency stays the same.</p> : null}
        <Field label="TDS withheld" error={form.errors.tdsMinor} hint={`Optional. The part of the amount we hold back as TDS, in ${money.currency}. The amount stays the full cost.`}>
          {(c) => <Input {...c} inputMode="decimal" autoComplete="off" placeholder="0.00" className="pd-figure max-w-48 text-right" value={tds} onChange={(e) => { setTds(e.target.value); form.setErrors({}); }} />}
        </Field>
      </Fieldset>

      <Fieldset legend="Details" className="flex flex-col gap-4">
        <Field label="Note" error={form.errors.note} hint="Internal. For example the invoice number the third party sent.">
          {(c) => <Textarea {...c} rows={3} maxLength={1000} value={form.values.note} onChange={(e) => form.set('note', e.target.value)} />}
        </Field>
        <Fieldset legend="Attachments" hint="The invoice or a transfer confirmation. Private: only people who can read payouts can open them.">
          <AttachmentsField value={files} onChange={setFiles} error={form.errors.attachmentMediaIds} />
        </Fieldset>
      </Fieldset>

      {form.formError ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
      <div className="flex items-center gap-2 border-t border-pd-rule pt-5">
        <Button type="submit" variant="primary" loading={form.submitting}>{editing ? 'Save changes' : 'Record payout'}</Button>
        {editing ? <Button variant="ghost" onClick={onDone} disabled={form.submitting}>Cancel</Button> : <LinkButton href={PATHS.payouts} variant="ghost">Cancel</LinkButton>}
      </div>
    </form>
  );
}
