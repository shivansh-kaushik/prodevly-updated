'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { useAdminApi } from '@/components/admin/api-provider';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Table, TableFrame, Td, THead, Th, Tr, TotalRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { formatDate, formatDuration } from '@/lib/admin/format';
import { useForm } from '@/lib/admin/use-form';
import type { WorkLogDTO } from '@/services/work-log.service';
import { DurationInput, fromMinutes, toMinutes, type DurationValue } from './duration-input';

/**
 * Time entries as a ledger. Rows the viewer may still change get Edit and Delete; a row covered by
 * a paid payout says Locked, and one past the edit window simply has no actions. The rules live
 * on the server: `canEdit` is only what to SHOW.
 */
export interface WorkLogTableProps {
  logs: WorkLogDTO[];
  /** The organisation's calendar day, the latest date an entry may carry. */
  today: string;
  showPerson?: boolean;
  showTask?: boolean;
  /** A closing row: the total across every entry that matches (not just this page). */
  total?: { label: string; minutes: number };
  emptyTitle?: string;
  emptyBody?: string;
  caption: string;
}

export function WorkLogTable({ logs, today, showPerson, showTask, total, emptyTitle = 'No time logged', emptyBody, caption }: WorkLogTableProps) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [editing, setEditing] = useState<WorkLogDTO | null>(null);
  const [deleting, setDeleting] = useState<WorkLogDTO | null>(null);

  if (logs.length === 0) return <EmptyState title={emptyTitle} body={emptyBody} className="py-10" />;
  const labelSpan = 1 + (showPerson ? 1 : 0) + (showTask ? 1 : 0);

  return (
    <>
      <TableFrame>
        <Table caption={caption}>
          <THead>
            <tr>
              <Th>Date</Th>
              {showPerson ? <Th>Person</Th> : null}
              {showTask ? <Th>Task</Th> : null}
              <Th numeric>Time</Th>
              <Th>Note</Th>
              <Th><span className="sr-only">Actions</span></Th>
            </tr>
          </THead>
          <tbody>
            {logs.map((l) => (
              <Tr key={l.id}>
                <Td className="whitespace-nowrap">{formatDate(l.workedOn)}</Td>
                {showPerson ? <Td className="whitespace-nowrap">{l.adminName}</Td> : null}
                {showTask ? (
                  <Td className="max-w-64">
                    <Link href={`/admin/tasks/${l.task.id}`} prefetch={false} className="block truncate font-medium text-pd-ink underline-offset-2 hover:underline">{l.task.title}</Link>
                    <span className="block truncate text-[12px] text-pd-ink-3"><span className="font-pd-mono">{l.task.ref}</span> · {l.project.name}</span>
                  </Td>
                ) : null}
                <Td numeric>
                  {formatDuration(l.minutes)}
                  {l.billable ? <span className="block text-[12px] font-normal text-pd-credit">Billable</span> : null}
                </Td>
                <Td className="max-w-80 min-w-48 py-2 align-top"><span className="line-clamp-2 break-words text-pd-ink-2">{l.note}</span></Td>
                <Td className="w-24 whitespace-nowrap">
                  {l.locked ? (
                    <Badge tone="rubric">Locked</Badge>
                  ) : l.canEdit ? (
                    <span className="flex justify-end gap-0.5">
                      <IconButton label={`Edit entry of ${formatDate(l.workedOn)}`} onClick={() => setEditing(l)}><Pencil className="size-4" aria-hidden /></IconButton>
                      <IconButton label={`Delete entry of ${formatDate(l.workedOn)}`} onClick={() => setDeleting(l)}><Trash2 className="size-4" aria-hidden /></IconButton>
                    </span>
                  ) : null}
                </Td>
              </Tr>
            ))}
            {total ? (
              <TotalRow>
                <Td colSpan={labelSpan}>{total.label}</Td>
                <Td numeric>{formatDuration(total.minutes)}</Td>
                <Td colSpan={2} />
              </TotalRow>
            ) : null}
          </tbody>
        </Table>
      </TableFrame>

      {editing ? <EditDialog key={editing.id} log={editing} today={today} onClose={() => setEditing(null)} /> : null}

      {/* Mounted only while open: ConfirmDialog's form has a fixed id, so two of them in one page would answer each other's button. */}
      {deleting ? (
        <ConfirmDialog
          open
          onClose={() => setDeleting(null)}
          title="Delete this time entry?"
          description={`${formatDuration(deleting.minutes)} on ${formatDate(deleting.workedOn)}. The task's logged total goes down by that much, and the removal is recorded in the activity log.`}
          confirmLabel="Delete entry"
          onConfirm={async () => {
            await call(`/api/admin/work-logs/${deleting.id}`, { method: 'DELETE' });
            toast.show('Entry deleted');
            setDeleting(null);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function EditDialog({ log, today, onClose }: { log: WorkLogDTO; today: string; onClose: () => void }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [duration, setDuration] = useState<DurationValue>(fromMinutes(log.minutes));
  const form = useForm({ workedOn: log.workedOn, note: log.note, billable: log.billable ? 'yes' : 'no' });

  const onSubmit = form.submit(async (v) => {
    const minutes = toMinutes(duration);
    if (minutes === null) {
      form.setErrors({ minutes: 'Enter how long you worked' });
      return;
    }
    await call(`/api/admin/work-logs/${log.id}`, { method: 'PATCH', body: { workedOn: v.workedOn, minutes, note: v.note, billable: v.billable === 'yes' } });
    toast.show('Entry updated');
    onClose();
    router.refresh();
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit time entry"
      description={`${log.task.ref} · ${log.task.title}`}
      dismissible={!form.submitting}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={form.submitting}>Cancel</Button>
          <Button variant="primary" type="submit" form="edit-log-form" loading={form.submitting}>Save changes</Button>
        </>
      }
    >
      <form id="edit-log-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date worked" error={form.errors.workedOn} required>
            {(c) => <Input {...c} type="date" max={today} value={form.values.workedOn} onChange={(e) => form.set('workedOn', e.target.value)} />}
          </Field>
          <Field label="Time spent" error={form.errors.minutes} required>
            {(c) => <DurationInput id={c.id} value={duration} onChange={setDuration} invalid={Boolean(c['aria-invalid'])} describedBy={c['aria-describedby']} />}
          </Field>
        </div>
        <Field label="What did you do?" error={form.errors.note} required>
          {(c) => <Textarea {...c} rows={3} maxLength={500} value={form.values.note} onChange={(e) => form.set('note', e.target.value)} />}
        </Field>
        <Field label="Billing" error={form.errors.billable}>
          {(c) => (
            <Select {...c} value={form.values.billable} onChange={(e) => form.set('billable', e.target.value)}>
              <option value="yes">Billable</option>
              <option value="no">Not billable</option>
            </Select>
          )}
        </Field>
        {form.formError ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
      </form>
    </Dialog>
  );
}
