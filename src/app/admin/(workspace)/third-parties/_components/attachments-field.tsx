'use client';

import { useRef, useState } from 'react';
import { Paperclip, Trash2, Upload } from 'lucide-react';
import { acceptFor, sizeProblem, uploadMedia } from '@/components/admin/media-upload';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/admin/api-client';
import { formatBytes } from '@/lib/media/rules';

export interface AttachmentItem {
  id: string;
  filename: string;
  url: string;
  size?: number;
}

/**
 * Receipts and transfer confirmations for a payout. Files are uploaded as PRIVATE payout attachments (only people who may
 * read payouts can open them) and the payout stores their ids. The server checks the bytes; the checks here only save a
 * round trip for the obvious cases (a file that is too big).
 */
export function AttachmentsField({
  value,
  onChange,
  error,
  max = 10,
  disabled,
}: {
  value: AttachmentItem[];
  onChange: (next: AttachmentItem[]) => void;
  error?: string;
  max?: number;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setProblem(undefined);
    setBusy(true);
    let next = value;
    try {
      for (const file of Array.from(files)) {
        if (next.length >= max) {
          setProblem(`At most ${max} attachments.`);
          break;
        }
        const early = sizeProblem(file, 'payout');
        if (early) {
          setProblem(`${file.name}: ${early}`);
          continue;
        }
        try {
          const { media } = await uploadMedia(file, { for: 'payout' });
          if (!next.some((a) => a.id === media.id)) next = [...next, { id: media.id, filename: media.filename, url: media.url, size: media.size }];
        } catch (e) {
          setProblem(`${file.name}: ${e instanceof ApiError ? (e.fields.file ?? e.message) : 'Something went wrong. Please try again.'}`);
        }
      }
      onChange(next);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 ? (
        <ul className="flex flex-col gap-1.5" aria-label="Attachments">
          {value.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 rounded-pd-sm bg-pd-well px-3 py-1.5 text-[13px]">
              <a href={a.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-2 text-pd-ink hover:underline">
                <Paperclip className="size-3.5 shrink-0 text-pd-ink-3" aria-hidden />
                <span className="truncate">{a.filename}</span>
                {a.size ? <span className="shrink-0 text-pd-ink-3">{formatBytes(a.size)}</span> : null}
              </a>
              {!disabled ? (
                <button type="button" aria-label={`Remove ${a.filename}`} onClick={() => onChange(value.filter((x) => x.id !== a.id))} className="grid size-7 shrink-0 place-items-center rounded-pd-sm text-pd-ink-3 hover:bg-pd-rule-soft hover:text-pd-ink pointer-coarse:size-11">
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-pd-ink-3">No attachments.</p>
      )}
      <div>
        {/* The input stays out of the tab order; the button is the visible, focusable control that opens it. */}
        <input ref={input} type="file" multiple accept={acceptFor('payout')} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onFiles(e.target.files)} />
        <Button size="sm" variant="secondary" loading={busy} disabled={disabled || value.length >= max} onClick={() => input.current?.click()}>
          {busy ? null : <Upload className="size-3.5" aria-hidden />}
          {busy ? 'Uploading' : 'Add a file'}
        </Button>
        <span className="ml-3 text-[12px] text-pd-ink-3">PDF, PNG or JPEG, up to 10 MB each.</span>
      </div>
      {problem ? <p role="alert" className="text-[12px] leading-4 font-medium text-pd-rubric">{problem}</p> : null}
      {error ? <p role="alert" className="text-[12px] leading-4 font-medium text-pd-rubric">{error}</p> : null}
    </div>
  );
}
