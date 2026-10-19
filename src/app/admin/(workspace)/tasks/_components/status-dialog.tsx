'use client';

import { useRouter } from 'next/navigation';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/status-badge';
import { useToast } from '@/components/ui/toast';
import { humanize } from '@/lib/admin/format';
import { useForm } from '@/lib/admin/use-form';
import { TASK_STATUSES, type TaskStatus } from '@/config/statuses';

/**
 * Move a task to another status. The note is required exactly when the server requires it:
 * cancelling, and moving a task OUT of done or cancelled (a reopen). The board's Move button and
 * the task page's Change status button both open this.
 */
export function StatusDialog({
  open,
  onClose,
  task,
  initialTarget,
}: {
  open: boolean;
  onClose: () => void;
  task: { id: string; title: string; status: TaskStatus };
  initialTarget?: TaskStatus;
}) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const options = TASK_STATUSES.filter((s) => s !== task.status);
  const form = useForm({ status: (initialTarget && initialTarget !== task.status ? initialTarget : options[0]) as TaskStatus, note: '' });

  const reopening = task.status === 'done' || task.status === 'cancelled';
  const noteRequired = reopening || form.values.status === 'cancelled';

  const onSubmit = form.submit(async (v) => {
    if (noteRequired && v.note.trim().length < 3) {
      form.setErrors({ note: reopening ? 'Say why you are reopening this task' : 'Say why you are cancelling this task' });
      return;
    }
    await call(`/api/admin/tasks/${task.id}/status`, { body: { status: v.status, ...(v.note.trim() ? { note: v.note.trim() } : {}) } });
    toast.show(`Moved to ${humanize(v.status).toLowerCase()}`);
    form.reset({ status: v.status, note: '' });
    onClose();
    router.refresh();
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Change status"
      description={task.title}
      size="sm"
      dismissible={!form.submitting}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={form.submitting}>Cancel</Button>
          <Button variant="primary" type="submit" form={`status-form-${task.id}`} loading={form.submitting}>Move task</Button>
        </>
      }
    >
      <form id={`status-form-${task.id}`} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <p className="flex items-center gap-2 text-[13px] text-pd-ink-2">Now <StatusBadge status={task.status} /></p>
        <Field label="Move to" error={form.errors.status} required>
          {(c) => (
            <Select {...c} value={form.values.status} onChange={(e) => form.set('status', e.target.value as TaskStatus)}>
              {options.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </Select>
          )}
        </Field>
        <Field
          label={noteRequired ? 'Why?' : 'Note (optional)'}
          hint={noteRequired ? (reopening ? 'Reopening a finished or cancelled task needs a reason.' : 'Cancelling needs a reason.') : 'Shown in the status history.'}
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
