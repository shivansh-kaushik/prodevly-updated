'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/status-badge';
import { useToast } from '@/components/ui/toast';
import { humanize } from '@/lib/admin/format';
import { useForm } from '@/lib/admin/use-form';
import { WORK_ORDER_TRANSITIONS, type WorkOrderStatus } from '@/lib/validation/work-order';
import { WorkOrderForm, type WorkOrderFormInitial } from './work-order-form';

/**
 * Move a work order along. The note is required exactly when the server requires it: cancelling, and moving back to
 * open. A cancel is refused while paid or due payouts refer to the work order, and the dialog shows that message.
 */
function StatusDialog({ open, onClose, order }: { open: boolean; onClose: () => void; order: { id: string; title: string; status: WorkOrderStatus } }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const options = WORK_ORDER_TRANSITIONS[order.status];
  const form = useForm({ status: (options[0] ?? order.status) as WorkOrderStatus, note: '' });
  const noteRequired = form.values.status === 'cancelled' || form.values.status === 'open';

  const onSubmit = form.submit(async (v) => {
    if (noteRequired && v.note.trim().length < 3) {
      form.setErrors({ note: v.status === 'cancelled' ? 'Say why you are cancelling this work order' : 'Say why you are reopening this work order' });
      return;
    }
    await call(`/api/admin/work-orders/${order.id}/status`, { body: { status: v.status, ...(v.note.trim() ? { note: v.note.trim() } : {}) } });
    toast.show(`Marked ${humanize(v.status).toLowerCase()}`);
    onClose();
    router.refresh();
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Change status"
      description={order.title}
      size="sm"
      dismissible={!form.submitting}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={form.submitting}>Cancel</Button>
          <Button variant="primary" type="submit" form={`wo-status-${order.id}`} loading={form.submitting}>Save status</Button>
        </>
      }
    >
      <form id={`wo-status-${order.id}`} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <p className="flex items-center gap-2 text-[13px] text-pd-ink-2">Now <StatusBadge status={order.status} /></p>
        <Field label="Move to" error={form.errors.status} required>
          {(c) => (
            <Select {...c} value={form.values.status} onChange={(e) => form.set('status', e.target.value as WorkOrderStatus)}>
              {options.map((s) => <option key={s} value={s}>{s === 'open' ? 'Reopen' : humanize(s)}</option>)}
            </Select>
          )}
        </Field>
        <Field
          label={noteRequired ? 'Why?' : 'Note (optional)'}
          hint={noteRequired ? (form.values.status === 'cancelled' ? 'Cancelling needs a reason.' : 'Reopening needs a reason.') : 'Shown in the status history.'}
          error={form.errors.note}
          required={noteRequired}
        >
          {(c) => <Textarea {...c} rows={3} maxLength={500} value={form.values.note} onChange={(e) => form.set('note', e.target.value)} />}
        </Field>
        {form.formError ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
      </form>
    </Dialog>
  );
}

/** Change status and edit, on a work order's page. Editing is only open while the work order is open or delivered. */
export function WorkOrderActions({
  order,
  form,
  currencies,
  canEdit,
}: {
  order: { id: string; title: string; status: WorkOrderStatus };
  form: WorkOrderFormInitial;
  currencies: readonly string[];
  canEdit: boolean;
}) {
  const [which, setWhich] = useState<'status' | 'edit' | null>(null);
  const close = () => setWhich(null);
  if (!canEdit) return null;
  const editable = order.status === 'open' || order.status === 'delivered';
  return (
    <>
      <Button variant="primary" onClick={() => setWhich('status')}>Change status</Button>
      {editable ? <Button variant="secondary" onClick={() => setWhich('edit')}><Pencil className="size-4" aria-hidden /> Edit</Button> : null}
      {which === 'status' ? <StatusDialog open onClose={close} order={order} /> : null}
      {which === 'edit' ? (
        <Dialog open onClose={close} title="Edit work order" description="Changes are recorded in the activity log." variant="drawer">
          <WorkOrderForm initial={form} currencies={currencies} onDone={close} />
        </Dialog>
      ) : null}
    </>
  );
}
