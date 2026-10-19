'use client';

import Image from 'next/image';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { ImagePlus, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { ApiError, qs } from '@/lib/admin/api-client';
import { cx } from '@/lib/cx';
import type { MediaRefDTO } from '@/lib/content/types';
import { formatBytes } from '@/lib/media/rules';
import type { MediaDTO, MediaPage } from '@/lib/media/types';
import { useAdminApi } from './api-provider';
import { acceptFor, sizeProblem, uploadMedia } from './media-upload';

/**
 * Choose a website image: upload a new one, or pick one already in the library. The result is the
 * small `MediaRefDTO` shape the editors store (id plus what is needed to preview it).
 *
 * Only PUBLIC images appear here; receipts are private and never listed. Every image needs a way
 * for screen readers to describe it, so the upload asks for one (the public site falls back to the
 * owner's name if it is left empty).
 */
/**
 * The library dialog is rendered into <body>, not inside the form that holds the picker: a native
 * <dialog> stays inside its parent <form> in the DOM, so pressing Enter in its search or
 * description box would submit (save) the whole editor behind it.
 */
const noopSubscribe = () => () => {};
const usePortalRoot = () => useSyncExternalStore(noopSubscribe, () => document.body, () => null);

const toRef = (m: MediaDTO): MediaRefDTO => ({ id: m.id, url: m.url, filename: m.filename, mime: m.mime, alt: m.alt, width: m.width, height: m.height });

function Thumb({ media, className }: { media: Pick<MediaRefDTO, 'url' | 'alt' | 'filename'>; className?: string }) {
  return (
    <span className={cx('relative block overflow-hidden rounded-pd-sm bg-pd-well shadow-[inset_0_0_0_1px_var(--color-pd-rule)]', className)}>
      <Image src={media.url} alt={media.alt || media.filename} fill unoptimized sizes="160px" className="object-contain" />
    </span>
  );
}

function LibraryDialog({ open, onClose, onPick, picked }: { open: boolean; onClose: () => void; onPick: (m: MediaRefDTO) => void; picked: readonly string[] }) {
  const { call } = useAdminApi();
  // Ids are per instance: a form can hold several pickers (cover and gallery), and a shared id would make
  // one dialog's label open the OTHER dialog's file chooser.
  const uid = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState<MediaPage | null>(null);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [alt, setAlt] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(
    async (query: string, pageNo: number, append: boolean) => {
      setLoading(true);
      setFailed(false);
      try {
        const data = await call<MediaPage>(`/api/admin/media${qs({ q: query, page: pageNo })}`);
        setPage((prev) => (append && prev ? { ...data, items: [...prev.items, ...data.items] } : data));
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [call],
  );

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => void load(q, 1, false), q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [open, q, load]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(undefined);
    setNotice(undefined);
    const early = sizeProblem(file, 'content');
    if (early) return setError(early);
    setUploading(true);
    try {
      const { media, duplicate } = await uploadMedia(file, { for: 'content', alt });
      if (duplicate) setNotice('That image was already in the library, so it was reused.');
      setAlt('');
      onPick(toRef(media));
    } catch (e) {
      setError(e instanceof ApiError ? (e.fields.file ?? e.message) : 'Something went wrong. Please try again.');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Choose an image" description="Upload a new image or pick one you already uploaded. PNG, JPEG, WebP or AVIF, up to 5 MB." size="lg" dismissible={!uploading}>
      <div className="flex flex-col gap-6">
        <section aria-labelledby={`${uid}-upload`} className="flex flex-col gap-3 rounded-pd-md bg-pd-paper p-4 shadow-[0_0_0_1px_var(--color-pd-rule)]">
          <h3 id={`${uid}-upload`} className="text-[14px] font-semibold">Upload a new image</h3>
          <Field label="Describe the image" hint="For people using screen readers. Leave empty and the page uses the name of the item it belongs to.">
            {(c) => <Input {...c} value={alt} maxLength={300} onChange={(e) => setAlt(e.target.value)} />}
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            {/* The input stays out of the tab order; this button is the visible, focusable control that opens it. */}
            <input ref={fileInput} type="file" accept={acceptFor('content')} className="sr-only" tabIndex={-1} aria-hidden id={`${uid}-file`} onChange={(e) => void onFile(e.target.files?.[0])} />
            <Button variant="primary" loading={uploading} onClick={() => fileInput.current?.click()}>
              {uploading ? null : <Upload className="size-4" aria-hidden />}
              {uploading ? 'Uploading' : 'Choose a file'}
            </Button>
          </div>
          {error ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{error}</p> : null}
          {notice ? <p role="status" className="text-[13px] text-pd-ink-2">{notice}</p> : null}
        </section>

        <section aria-labelledby={`${uid}-library`} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id={`${uid}-library`} className="text-[14px] font-semibold">Already uploaded{page ? ` (${page.total})` : ''}</h3>
            <div className="w-full sm:w-60">
              <Input type="search" aria-label="Search uploaded images" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          {failed ? (
            <p role="alert" className="text-[13px] text-pd-rubric">Could not load the library. <button type="button" className="underline" onClick={() => void load(q, 1, false)}>Try again</button></p>
          ) : page && page.items.length === 0 ? (
            <p className="py-6 text-center text-[14px] text-pd-ink-3">{q ? 'No uploaded image matches that name.' : 'No images uploaded yet.'}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {(page?.items ?? []).map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => onPick(toRef(m))}
                    aria-pressed={picked.includes(m.id)}
                    className="flex w-full flex-col gap-1.5 rounded-pd-sm p-1.5 text-left transition-colors hover:bg-pd-well aria-pressed:bg-pd-well aria-pressed:shadow-[inset_0_0_0_2px_var(--color-pd-ink)]"
                  >
                    <Thumb media={m} className="aspect-square w-full" />
                    <span className="truncate text-[12px] text-pd-ink-2">{m.filename}</span>
                    <span className="pd-figure text-[11px] text-pd-ink-3">{m.width && m.height ? `${m.width} x ${m.height}, ` : ''}{formatBytes(m.size)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {loading ? <p role="status" className="text-center text-[13px] text-pd-ink-3">Loading...</p> : null}
          {page && page.page < page.pages ? (
            <Button variant="secondary" className="self-center" disabled={loading} onClick={() => void load(q, page.page + 1, true)}>Show more</Button>
          ) : null}
        </section>
      </div>
    </Dialog>
  );
}

export interface MediaPickerProps {
  label: string;
  hint?: string;
  error?: string;
  value: MediaRefDTO | null;
  onChange: (value: MediaRefDTO | null) => void;
  disabled?: boolean;
}

/** One image: a preview, "Choose image" and "Remove". */
export function MediaPicker({ label, hint, error, value, onChange, disabled }: MediaPickerProps) {
  const [open, setOpen] = useState(false);
  const root = usePortalRoot();
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-[13px] font-medium text-pd-ink-2">{label}</span>
      <div className="flex flex-wrap items-center gap-4 rounded-pd-md bg-pd-leaf p-3 shadow-[0_0_0_1px_var(--color-pd-rule)]" role="group" aria-labelledby={`${id}-label`}>
        {value ? (
          <Thumb media={value} className="size-20 shrink-0" />
        ) : (
          <span className="grid size-20 shrink-0 place-items-center rounded-pd-sm bg-pd-well text-pd-ink-4 shadow-[inset_0_0_0_1px_var(--color-pd-rule)]"><ImagePlus className="size-6" aria-hidden /></span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="truncate text-[13px] text-pd-ink-2">{value ? value.filename : 'No image chosen'}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={disabled} onClick={() => setOpen(true)}>{value ? 'Change image' : 'Choose image'}</Button>
            {value && !disabled ? <Button size="sm" variant="ghost" onClick={() => onChange(null)}><Trash2 className="size-3.5" aria-hidden /> Remove</Button> : null}
          </div>
        </div>
      </div>
      {hint && !error ? <p className="text-[12px] leading-4 text-pd-ink-3">{hint}</p> : null}
      {error ? <p role="alert" className="text-[12px] leading-4 font-medium text-pd-rubric">{error}</p> : null}
      {root ? createPortal(<LibraryDialog open={open} onClose={() => setOpen(false)} picked={value ? [value.id] : []} onPick={(m) => { onChange(m); setOpen(false); }} />, root) : null}
    </div>
  );
}

/** Several images (a gallery): each can be removed; "Add image" opens the library. */
export function MediaListPicker({ label, hint, error, value, onChange, max = 12, disabled }: Omit<MediaPickerProps, 'value' | 'onChange'> & { value: MediaRefDTO[]; onChange: (value: MediaRefDTO[]) => void; max?: number }) {
  const [open, setOpen] = useState(false);
  const root = usePortalRoot();
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-[13px] font-medium text-pd-ink-2">{label}</span>
      <div className="flex flex-col gap-3 rounded-pd-md bg-pd-leaf p-3 shadow-[0_0_0_1px_var(--color-pd-rule)]" role="group" aria-labelledby={`${id}-label`}>
        {value.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {value.map((m) => (
              <li key={m.id} className="flex flex-col gap-1.5">
                <Thumb media={m} className="aspect-square w-full" />
                <span className="truncate text-[12px] text-pd-ink-2">{m.filename}</span>
                {!disabled ? <Button size="sm" variant="ghost" className="justify-start" onClick={() => onChange(value.filter((x) => x.id !== m.id))}><Trash2 className="size-3.5" aria-hidden /> Remove<span className="sr-only"> {m.filename}</span></Button> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-pd-ink-3">No images added.</p>
        )}
        <div>
          <Button size="sm" variant="secondary" disabled={disabled || value.length >= max} onClick={() => setOpen(true)}><ImagePlus className="size-3.5" aria-hidden /> Add image</Button>
          {value.length >= max ? <span className="ml-3 text-[12px] text-pd-ink-3">At most {max} images.</span> : null}
        </div>
      </div>
      {hint && !error ? <p className="text-[12px] leading-4 text-pd-ink-3">{hint}</p> : null}
      {error ? <p role="alert" className="text-[12px] leading-4 font-medium text-pd-rubric">{error}</p> : null}
      {root
        ? createPortal(
            <LibraryDialog
              open={open}
              onClose={() => setOpen(false)}
              picked={value.map((m) => m.id)}
              onPick={(m) => { if (!value.some((x) => x.id === m.id) && value.length < max) onChange([...value, m]); setOpen(false); }}
            />,
            root,
          )
        : null}
    </div>
  );
}
