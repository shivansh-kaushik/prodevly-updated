'use client';

import { useId, useState } from 'react';
import { ApiError } from '@/lib/admin/api-client';
import { Button } from './button';
import { Dialog } from './dialog';
import { Field, Textarea } from './field';

/**
 * Ask before a consequential action. For voids, removals and anything the audit log should
 * explain, pass `reason` and the person must say why; the text is handed to `onConfirm`.
 * A failure (a rule the server enforces) is shown inside the dialog, which stays open.
 */
export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  /** When set, shows a required textarea with this label and passes its value to onConfirm. */
  reason?: { label: string; minLength?: number; placeholder?: string };
  onConfirm: (reason: string) => Promise<void>;
}

export function ConfirmDialog({ open, onClose, title, description, confirmLabel, tone = 'danger', reason, onConfirm }: ConfirmDialogProps) {
  const formId = useId(); // several ConfirmDialogs can sit on one page: a fixed id would cross-submit
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [fieldError, setFieldError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const min = reason?.minLength ?? 3;

  function close() {
    if (busy) return;
    setText('');
    setError(undefined);
    setFieldError(undefined);
    onClose();
  }

  async function go(e: React.FormEvent) {
    e.preventDefault();
    if (reason && text.trim().length < min) {
      setFieldError(`Give a reason (at least ${min} characters).`);
      return;
    }
    setBusy(true);
    setError(undefined);
    setFieldError(undefined);
    try {
      await onConfirm(text.trim());
      setText('');
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldError(err.fields.reason);
        setError(err.fields.reason ? undefined : err.message);
      } else setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} type="submit" form={formId} loading={busy}>{confirmLabel}</Button>
        </>
      }
    >
      <form id={formId} onSubmit={go} className="flex flex-col gap-4">
        <div className="text-[14px] leading-5 text-pd-ink-2">{description}</div>
        {reason ? (
          <Field label={reason.label} error={fieldError} required>
            {(c) => <Textarea {...c} autoFocus rows={3} placeholder={reason.placeholder} value={text} onChange={(e) => { setText(e.target.value); setFieldError(undefined); }} />}
          </Field>
        ) : null}
        {error ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{error}</p> : null}
      </form>
    </Dialog>
  );
}
