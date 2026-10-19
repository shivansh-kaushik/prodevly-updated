'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/status-badge';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/admin/api-client';
import { humanize } from '@/lib/admin/format';
import type { ProjectStatus } from '@/config/statuses';
import { allowedMoves, moveNeedsNote, moveNeedsSuperadmin } from '@/lib/validation/project';

/**
 * Moves a project along the transition table. Only the moves the server would accept are offered;
 * on hold, cancelled and any reopen ask for a note, which lands in the status history and the audit log.
 */
export function StatusDialog({
  open,
  onClose,
  projectId,
  status,
  canReopen,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  status: ProjectStatus;
  /** Superadmins only: closed and cancelled projects can only be reopened by them. */
  canReopen: boolean;
}) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const options = allowedMoves(status).filter((to) => canReopen || !moveNeedsSuperadmin(status, to));
  const [picked, setPicked] = useState<ProjectStatus | ''>('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ to?: string; note?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  const to = options.find((o) => o === picked) ?? options[0];
  const needsNote = to ? moveNeedsNote(status, to) : false;

  function close() {
    if (busy) return;
    setPicked('');
    setNote('');
    setErrors({});
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!to) return;
    if (needsNote && !note.trim()) {
      setErrors({ note: 'Say why' });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await call(`/api/admin/projects/${projectId}/status`, { body: { to, ...(note.trim() ? { note: note.trim() } : {}) } });
      toast.show(`Moved to ${humanize(to).toLowerCase()}.`);
      setPicked('');
      setNote('');
      onClose();
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) setErrors({ to: err.fields.to, note: err.fields.note, form: err.fields.to || err.fields.note ? undefined : err.message });
      else setErrors({ form: 'Something went wrong. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Change status"
      description="Every move is kept in the status history with your note."
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
          {to ? <Button variant="primary" type="submit" form="project-status-form" loading={busy}>Move project</Button> : null}
        </>
      }
    >
      <p className="mb-4 flex items-center gap-2 text-[14px] text-pd-ink-2">
        Now <StatusBadge status={status} />
      </p>
      {!to ? (
        <p className="text-[14px] text-pd-ink-2">
          {moveNeedsSuperadmin(status, 'active') ? 'Only a superadmin can reopen a closed or cancelled project.' : 'This project cannot move from here.'}
        </p>
      ) : (
        <form id="project-status-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field label="Move to" error={errors.to}>
            {(c) => (
              <Select {...c} value={to} onChange={(e) => { setPicked(e.target.value as ProjectStatus); setErrors({}); }}>
                {options.map((o) => <option key={o} value={o}>{humanize(o)}</option>)}
              </Select>
            )}
          </Field>
          <Field
            label={needsNote ? 'Note' : 'Note (optional)'}
            required={needsNote}
            hint={needsNote ? 'Required for this move.' : undefined}
            error={errors.note}
          >
            {(c) => <Textarea {...c} rows={3} value={note} onChange={(e) => { setNote(e.target.value); setErrors((x) => ({ ...x, note: undefined })); }} />}
          </Field>
          {errors.form ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{errors.form}</p> : null}
        </form>
      )}
    </Dialog>
  );
}
