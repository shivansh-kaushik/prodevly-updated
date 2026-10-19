'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useAdminApi } from '@/components/admin/api-provider';
import { formatNative } from '@/components/admin/money';
import { MoneyInput, minorToInput, moneyToMinor, type MoneyValue } from '@/components/admin/money-input';
import { Button, IconButton } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input, Select } from '@/components/ui/field';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableFrame, Td, THead, Th, Tr, TotalRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/admin/api-client';
import { formatDate } from '@/lib/admin/format';
import { MILESTONE_STATUSES } from '@/config/statuses';
import type { MilestoneRow, PricingModelKey } from './types';

interface FormState {
  title: string;
  amount: MoneyValue;
  dueOn: string;
  status: MilestoneRow['status'];
  invoiceRef: string;
}

/**
 * The billing milestones of a project, in the contract currency. Hourly and retainer projects bill
 * one milestone per invoice, so this list is what they are billed by. Editing needs payment access;
 * a milestone can only be removed while it is pending and no payment refers to it.
 */
export function MilestonesEditor({
  projectId,
  currency,
  pricingModel,
  contractAmountMinor,
  milestones,
  canEdit,
}: {
  projectId: string;
  currency: string;
  pricingModel: PricingModelKey;
  contractAmountMinor: number;
  milestones: MilestoneRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [editing, setEditing] = useState<MilestoneRow | 'new' | null>(null);
  const [removing, setRemoving] = useState<MilestoneRow | null>(null);
  const [form, setForm] = useState<FormState>({ title: '', amount: { amount: '', currency }, dueOn: '', status: 'pending', invoiceRef: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const total = milestones.reduce((s, m) => s + m.amountMinor, 0);
  const capped = pricingModel === 'fixed' || pricingModel === 'milestone';

  function open(target: MilestoneRow | 'new') {
    setErrors({});
    setForm(
      target === 'new'
        ? { title: '', amount: { amount: '', currency }, dueOn: '', status: 'pending', invoiceRef: '' }
        : { title: target.title, amount: { amount: minorToInput(target.amountMinor, currency), currency }, dueOn: target.dueOn ?? '', status: target.status, invoiceRef: target.invoiceRef ?? '' },
    );
    setEditing(target);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const amountMinor = moneyToMinor(form.amount);
    if (amountMinor === null) {
      setErrors({ amountMinor: 'Enter an amount above zero, like 1,250.50' });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      if (editing === 'new') {
        await call(`/api/admin/projects/${projectId}/milestones`, {
          body: { title: form.title.trim(), amountMinor, ...(form.dueOn ? { dueOn: form.dueOn } : {}), ...(form.invoiceRef.trim() ? { invoiceRef: form.invoiceRef.trim() } : {}) },
        });
        toast.show('Milestone added.');
      } else {
        await call(`/api/admin/projects/${projectId}/milestones/${editing.id}`, {
          method: 'PATCH',
          body: { title: form.title.trim(), amountMinor, dueOn: form.dueOn || null, status: form.status, invoiceRef: form.invoiceRef.trim() || null },
        });
        toast.show('Milestone saved.');
      }
      setEditing(null);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) setErrors(Object.keys(err.fields).length > 0 ? err.fields : { form: err.message });
      else setErrors({ form: 'Something went wrong. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel flush>
      <div className="px-5 pt-5">
        <PanelHeader
          title="Milestones"
          hint={`Amounts are in ${currency}, the contract currency.`}
          action={canEdit ? <Button size="sm" variant="secondary" onClick={() => open('new')}><Plus className="size-4" aria-hidden /> Add milestone</Button> : undefined}
        />
      </div>
      {milestones.length === 0 ? (
        <EmptyState
          title="No milestones yet"
          body={pricingModel === 'hourly' || pricingModel === 'retainer' ? 'Add one milestone for each invoice you send. The project is billed by them.' : 'Split the contract into the invoices you plan to send.'}
          action={canEdit ? <Button variant="secondary" onClick={() => open('new')}>Add the first milestone</Button> : undefined}
          className="py-8"
        />
      ) : (
        <TableFrame className="rounded-none shadow-none">
          <Table caption="Billing milestones" className="min-w-[36rem]">
            <THead>
              <tr>
                <Th>Milestone</Th>
                <Th>Due</Th>
                <Th numeric>Amount</Th>
                <Th>Status</Th>
                <Th>Invoice</Th>
                {canEdit ? <Th><span className="sr-only">Actions</span></Th> : null}
              </tr>
            </THead>
            <tbody>
              {milestones.map((m) => (
                <Tr key={m.id}>
                  <Td className="font-medium">{m.title}</Td>
                  <Td muted>{m.dueOn ? formatDate(m.dueOn) : 'No date'}</Td>
                  <Td numeric>{formatNative(m.amountMinor, currency)}</Td>
                  <Td><StatusBadge status={m.status} /></Td>
                  <Td muted>{m.invoiceRef ?? ''}</Td>
                  {canEdit ? (
                    <Td className="text-right whitespace-nowrap">
                      <IconButton label={`Edit ${m.title}`} onClick={() => open(m)}><Pencil className="size-4" aria-hidden /></IconButton>
                      {m.status === 'pending' ? <IconButton label={`Remove ${m.title}`} onClick={() => setRemoving(m)}><Trash2 className="size-4" aria-hidden /></IconButton> : null}
                    </Td>
                  ) : null}
                </Tr>
              ))}
              <TotalRow>
                <Td>{capped ? 'Scheduled' : 'Total of milestones'}</Td>
                <Td />
                <Td numeric>{formatNative(total, currency)}</Td>
                <Td colSpan={canEdit ? 3 : 2} muted>
                  {capped ? `of ${formatNative(contractAmountMinor, currency)} contract value` : ''}
                </Td>
              </TotalRow>
            </tbody>
          </Table>
        </TableFrame>
      )}

      <Dialog
        open={editing !== null}
        onClose={() => !busy && setEditing(null)}
        title={editing === 'new' ? 'Add milestone' : 'Edit milestone'}
        size="md"
        dismissible={!busy}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" type="submit" form="milestone-form" loading={busy}>{editing === 'new' ? 'Add milestone' : 'Save milestone'}</Button>
          </>
        }
      >
        <form id="milestone-form" onSubmit={save} noValidate className="flex flex-col gap-4">
          <Field label="Title" required error={errors.title}>
            {(c) => <Input {...c} autoComplete="off" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}
          </Field>
          <Field label="Amount" required error={errors.amountMinor} hint={capped ? 'Milestones cannot add up to more than the contract value.' : undefined}>
            {(c) => (
              <MoneyInput id={c.id} value={form.amount} onChange={(amount) => setForm({ ...form, amount })} currencies={[currency]} lockCurrency invalid={Boolean(errors.amountMinor)} describedBy={c['aria-describedby']} />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Due date" error={errors.dueOn}>
              {(c) => <Input {...c} type="date" value={form.dueOn} onChange={(e) => setForm({ ...form, dueOn: e.target.value })} />}
            </Field>
            <Field label="Invoice reference" error={errors.invoiceRef}>
              {(c) => <Input {...c} autoComplete="off" value={form.invoiceRef} onChange={(e) => setForm({ ...form, invoiceRef: e.target.value })} />}
            </Field>
          </div>
          {editing !== 'new' ? (
            <Field label="Status" hint="Pending, invoiced when you send the invoice, paid once it is settled." error={errors.status}>
              {(c) => (
                <Select {...c} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as MilestoneRow['status'] })}>
                  {MILESTONE_STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </Select>
              )}
            </Field>
          ) : null}
          {errors.form ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{errors.form}</p> : null}
        </form>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove "${removing?.title ?? ''}"?`}
        description="Only a pending milestone with no payment against it can be removed. The change is recorded in the activity log."
        confirmLabel="Remove milestone"
        onConfirm={async () => {
          if (!removing) return;
          await call(`/api/admin/projects/${projectId}/milestones/${removing.id}`, { method: 'DELETE' });
          toast.show('Milestone removed.');
          router.refresh();
        }}
      />
    </Panel>
  );
}
