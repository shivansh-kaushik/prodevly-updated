'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAdminApi } from '@/components/admin/api-provider';
import { EntityPicker, type PickerValue } from '@/components/admin/entity-picker';
import { minorToInput, MoneyInput, moneyToMinor, type MoneyValue } from '@/components/admin/money-input';
import { Button, LinkButton } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useForm } from '@/lib/admin/use-form';
import { PATHS } from './labels';

export interface WorkOrderFormInitial {
  id: string;
  title: string;
  scope: string;
  amountMinor: number;
  currency: string;
  dueOn: string;
  projectId: string;
  task: PickerValue | null;
  /** Non-void payouts exist: the currency and the task are then fixed. */
  hasPayouts: boolean;
}

/** Raise a work order, or edit one (the edit form lives in a drawer). The client is never asked for: it follows the project. */
export function WorkOrderForm({
  initial,
  initialThirdParty,
  initialProject,
  currencies,
  onDone,
}: {
  initial?: WorkOrderFormInitial;
  initialThirdParty?: PickerValue | null;
  initialProject?: PickerValue | null;
  currencies: readonly string[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const editing = Boolean(initial);
  const [party, setParty] = useState<PickerValue | null>(initialThirdParty ?? null);
  const [client, setClient] = useState<PickerValue | null>(null);
  const [project, setProject] = useState<PickerValue | null>(initialProject ?? null);
  const [task, setTask] = useState<PickerValue | null>(initial?.task ?? null);
  const [money, setMoney] = useState<MoneyValue>(initial ? { amount: minorToInput(initial.amountMinor, initial.currency), currency: initial.currency } : { amount: '', currency: currencies[0] ?? 'INR' });
  const form = useForm({ title: initial?.title ?? '', scope: initial?.scope ?? '', dueOn: initial?.dueOn ?? '' });

  const onSubmit = form.submit(async (v) => {
    const amountMinor = moneyToMinor(money);
    if (amountMinor === null) {
      form.setErrors({ amountMinor: 'Enter the agreed amount, for example 1,250.50' });
      return;
    }

    if (initial) {
      const body: Record<string, unknown> = {};
      if (v.title !== initial.title) body.title = v.title;
      if (v.scope.trim() !== initial.scope) body.scope = v.scope.trim() === '' ? null : v.scope.trim();
      if (amountMinor !== initial.amountMinor) body.amountMinor = amountMinor;
      if (money.currency !== initial.currency) body.currency = money.currency;
      if (v.dueOn !== initial.dueOn) body.dueOn = v.dueOn === '' ? null : v.dueOn;
      if ((task?.id ?? null) !== (initial.task?.id ?? null)) body.taskId = task?.id ?? null;
      if (Object.keys(body).length === 0) {
        onDone?.();
        return;
      }
      const data = await call<{ warnings: string[] }>(`/api/admin/work-orders/${initial.id}`, { method: 'PATCH', body });
      toast.show('Work order updated');
      for (const w of data.warnings) toast.show(w, 'error');
      onDone?.();
      router.refresh();
      return;
    }

    if (!party) {
      form.setErrors({ thirdPartyId: 'Pick the third party we are engaging' });
      return;
    }
    if (!project) {
      form.setErrors({ projectId: 'Pick the project this work is for' });
      return;
    }
    const data = await call<{ workOrder: { id: string } }>('/api/admin/work-orders', {
      body: {
        thirdPartyId: party.id,
        projectId: project.id,
        ...(task ? { taskId: task.id } : {}),
        title: v.title,
        ...(v.scope.trim() ? { scope: v.scope.trim() } : {}),
        amountMinor,
        currency: money.currency,
        ...(v.dueOn ? { dueOn: v.dueOn } : {}),
      },
    });
    toast.show('Work order raised');
    router.push(`${PATHS.workOrders}/${data.workOrder.id}`);
    await new Promise(() => {});
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-3xl flex-col gap-6">
      {editing ? null : (
        <>
          <Field label="Third party" error={form.errors.thirdPartyId} hint="Who we are engaging. Only active third parties appear." required>
            {(c) => <EntityPicker kind="third-parties" id={c.id} value={party} onChange={(p) => { setParty(p); form.setErrors({}); }} placeholder="Search third parties" invalid={Boolean(c['aria-invalid'])} describedBy={c['aria-describedby']} required />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client" hint="Optional. Narrows the project list; the client follows the project.">
              {(c) => (
                <EntityPicker
                  kind="clients"
                  id={c.id}
                  value={client}
                  onChange={(p) => { setClient(p); setProject(null); setTask(null); }}
                  placeholder="Any client"
                />
              )}
            </Field>
            <Field label="Project" error={form.errors.projectId} required>
              {(c) => (
                <EntityPicker
                  kind="projects"
                  id={c.id}
                  clientId={client?.id}
                  value={project}
                  onChange={(p) => { setProject(p); setTask(null); form.setErrors({}); }}
                  placeholder="Search projects"
                  invalid={Boolean(c['aria-invalid'])}
                  describedBy={c['aria-describedby']}
                  required
                />
              )}
            </Field>
          </div>
        </>
      )}
      <Field label="Task" error={form.errors.taskId} hint={editing && initial?.hasPayouts ? 'Fixed: payouts already carry this task.' : 'Optional. A task in the project above.'}>
        {(c) => (
          <EntityPicker
            kind="tasks"
            id={c.id}
            projectId={editing ? initial?.projectId : project?.id}
            value={task}
            onChange={setTask}
            placeholder={editing || project ? 'Search tasks' : 'Pick a project first'}
            disabled={editing ? initial?.hasPayouts : !project}
            invalid={Boolean(c['aria-invalid'])}
            describedBy={c['aria-describedby']}
          />
        )}
      </Field>
      <Field label="Title" error={form.errors.title} required>
        {(c) => <Input {...c} maxLength={200} autoComplete="off" value={form.values.title} onChange={(e) => form.set('title', e.target.value)} />}
      </Field>
      <Field label="Scope" error={form.errors.scope} hint="What the third party will deliver. Plain text.">
        {(c) => <Textarea {...c} rows={4} maxLength={4000} value={form.values.scope} onChange={(e) => form.set('scope', e.target.value)} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Agreed amount" error={form.errors.amountMinor ?? form.errors.currency} hint={editing && initial?.hasPayouts ? 'The currency is fixed once payouts exist.' : undefined} required>
          {(c) => <MoneyInput id={c.id} value={money} onChange={(m) => { setMoney(m); form.setErrors({}); }} currencies={currencies} invalid={Boolean(c['aria-invalid'])} describedBy={c['aria-describedby']} lockCurrency={editing && initial?.hasPayouts} />}
        </Field>
        <Field label="Due date" error={form.errors.dueOn} hint="Optional. When the work should be delivered.">
          {(c) => <Input {...c} type="date" value={form.values.dueOn} onChange={(e) => form.set('dueOn', e.target.value)} />}
        </Field>
      </div>
      {form.formError ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
      <div className="flex items-center gap-2 border-t border-pd-rule pt-5">
        <Button type="submit" variant="primary" loading={form.submitting}>{editing ? 'Save changes' : 'Raise work order'}</Button>
        {editing ? <Button variant="ghost" onClick={onDone} disabled={form.submitting}>Cancel</Button> : <LinkButton href={PATHS.workOrders} variant="ghost">Cancel</LinkButton>}
      </div>
    </form>
  );
}
