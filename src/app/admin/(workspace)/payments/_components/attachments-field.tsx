'use client';

import { useId, useRef, useState } from 'react';
import { Paperclip, Trash2 } from 'lucide-react';
import { acceptFor, sizeProblem, uploadMedia } from '@/components/admin/media-upload';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/admin/api-client';
import { formatBytes } from '@/lib/media/rules';
import type { MediaDTO } from '@/lib/media/types';
import { MAX_ATTACHMENTS } from '@/lib/validation/payment';

/**
 * Remittance advice, a bank statement line, a TDS certificate: private files attached to a payment. Each
 * upload goes straight to the server, which decides what the file really is from its bytes; the form keeps
 * the returned records and sends their ids with the payment. Files are only ever visible to people who may
 * see payments.
 */
export function AttachmentsField({ value, onChange, error, disabled }: { value: MediaDTO[]; onChange: (next: MediaDTO[]) => void; error?: string; disabled?: boolean }) {
  const uid = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [notice, setNotice] = useState<string>();

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setProblem(undefined);
    setNotice(undefined);
    setBusy(true);
    let next = value;
    try {
      for (const file of Array.from(files)) {
        if (next.length >= MAX_ATTACHMENTS) {
          setProblem(`At most ${MAX_ATTACHMENTS} files.`);
          break;
        }
        const early = sizeProblem(file, 'payment');
        if (early) {
          setProblem(`${file.name}: ${early}`);
          continue;
        }
        try {
          const { media, duplicate } = await uploadMedia(file, { for: 'payment' });
          if (next.some((m) => m.id === media.id)) setNotice(`${media.filename} is already attached.`);
          else {
            next = [...next, media];
            onChange(next);
            if (duplicate) setNotice(`${media.filename} was uploaded before, so the same file is used.`);
          }
        } catch (e) {
          setProblem(`${file.name}: ${e instanceof ApiError ? (e.fields.file ?? e.message) : 'Something went wrong. Please try again.'}`);
        }
      }
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  const shown = error ?? problem;
  return (
    <div className="flex flex-col gap-2">
      <span id={`${uid}-label`} className="text-[13px] font-medium text-pd-ink-2">Attachments</span>
      <div role="group" aria-labelledby={`${uid}-label`} className="flex flex-col gap-3 rounded-pd-md bg-pd-leaf p-3 shadow-[0_0_0_1px_var(--color-pd-rule)]">
        {value.length > 0 ? (
          <ul className="flex flex-col divide-y divide-pd-rule-soft">
            {value.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                <Paperclip className="size-4 shrink-0 text-pd-ink-3" aria-hidden />
                <a href={m.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-[14px] underline-offset-2 hover:underline">{m.filename}</a>
                <span className="pd-figure shrink-0 text-[12px] text-pd-ink-3">{formatBytes(m.size)}</span>
                {!disabled ? (
                  <Button size="sm" variant="ghost" onClick={() => onChange(value.filter((x) => x.id !== m.id))}>
                    <Trash2 className="size-3.5" aria-hidden /> Remove<span className="sr-only"> {m.filename}</span>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-pd-ink-3">No files attached.</p>
        )}
        <div>
          {/* The input stays out of the tab order; this button is the visible, focusable control that opens it. */}
          <input ref={input} id={`${uid}-file`} type="file" multiple accept={acceptFor('payment')} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onFiles(e.target.files)} />
          <Button size="sm" variant="secondary" loading={busy} disabled={disabled || value.length >= MAX_ATTACHMENTS} onClick={() => input.current?.click()}>
            {busy ? 'Uploading' : 'Add a file'}
          </Button>
          <span className="ml-3 text-[12px] text-pd-ink-3">PDF, PNG or JPEG, up to 10 MB each.</span>
        </div>
      </div>
      {shown ? <p role="alert" className="text-[12px] leading-4 font-medium text-pd-rubric">{shown}</p> : null}
      {notice && !shown ? <p role="status" className="text-[12px] leading-4 text-pd-ink-2">{notice}</p> : null}
    </div>
  );
}
