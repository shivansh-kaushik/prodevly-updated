'use client';

import { useRef, useState } from 'react';
import { FileText, Paperclip, X } from 'lucide-react';
import { acceptFor, uploadMedia } from '@/components/admin/media-upload';
import { Button, IconButton } from '@/components/ui/button';
import { Fieldset } from '@/components/ui/field';
import { ApiError } from '@/lib/admin/api-client';
import { formatBytes } from '@/lib/media/rules';
import type { ReceiptItem } from './form-model';

/**
 * Receipts for an expense. Each file is uploaded as PRIVATE media for expenses (only the person who uploaded it and
 * people who handle expenses can open it) the moment it is chosen, and the form keeps the returned ids. Removing a
 * receipt here only detaches it from this expense. The server checks every id again when the expense is saved.
 */
const MAX = 10;

export function ReceiptField({ value, onChange, error, disabled }: { value: ReceiptItem[]; onChange: (next: ReceiptItem[]) => void; error?: string; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  async function onFiles(files: FileList | null) {
    const chosen = files ? Array.from(files) : [];
    if (chosen.length === 0) return;
    setProblem(undefined);
    setBusy(true);
    const added: ReceiptItem[] = [];
    try {
      for (const file of chosen) {
        if (value.length + added.length >= MAX) {
          setProblem(`You can attach at most ${MAX} receipts.`);
          break;
        }
        const { media } = await uploadMedia(file, { for: 'expense' });
        // The same file chosen twice comes back as the same record: keep one.
        if (![...value, ...added].some((r) => r.id === media.id)) added.push({ id: media.id, filename: media.filename, size: media.size });
      }
    } catch (e) {
      setProblem(e instanceof ApiError ? (e.fields.file ?? e.message) : 'Something went wrong. Please try again.');
    } finally {
      if (added.length > 0) onChange([...value, ...added]);
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  const shown = problem ?? error;
  return (
    <Fieldset legend="Receipts" hint="A photo or PDF of the bill, up to 10 MB each. Only you and the people who handle expenses can open them.">
      {value.length > 0 ? (
        <ul className="mb-2 flex flex-col gap-1.5">
          {value.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-pd-sm bg-pd-well px-3 py-1.5 text-[14px]">
              <FileText className="size-4 shrink-0 text-pd-ink-3" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{r.filename}</span>
              {r.size !== null ? <span className="pd-figure shrink-0 text-[12px] text-pd-ink-3">{formatBytes(r.size)}</span> : null}
              <IconButton label={`Remove ${r.filename}`} disabled={disabled || busy} onClick={() => onChange(value.filter((x) => x.id !== r.id))} className="-mr-2 size-8">
                <X className="size-4" aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : null}
      {/* The file input stays out of the tab order; the button is the visible, focusable control that opens it. */}
      <input ref={input} type="file" multiple accept={acceptFor('expense')} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onFiles(e.target.files)} />
      <Button variant="secondary" loading={busy} disabled={disabled || value.length >= MAX} onClick={() => input.current?.click()}>
        {busy ? null : <Paperclip className="size-4" aria-hidden />}
        {busy ? 'Uploading' : value.length > 0 ? 'Add another receipt' : 'Attach a receipt'}
      </Button>
      {shown ? <p role="alert" className="mt-1.5 text-[12px] leading-4 font-medium text-pd-rubric">{shown}</p> : null}
    </Fieldset>
  );
}
