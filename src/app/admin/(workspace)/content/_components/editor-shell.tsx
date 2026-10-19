'use client';

import { useRouter } from 'next/navigation';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button, LinkButton } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import type { ContentType } from '@/lib/content/types';

/**
 * The frame every content editor shares: the form element, a notice when the record is read-only,
 * the form-level error, and the save bar. `readOnly` is a courtesy; the service refuses the write
 * regardless of what the form allows.
 */
export function EditorShell({ onSubmit, submitting, formError, readOnlyReason, cancelHref, submitLabel, children }: {
  onSubmit: (event?: React.FormEvent) => void;
  submitting: boolean;
  formError: string | null;
  /** When set the form is read-only and this explains why. */
  readOnlyReason?: string;
  cancelHref: string;
  submitLabel: string;
  children: React.ReactNode;
}) {
  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-3xl flex-col gap-6">
      {readOnlyReason ? <p role="note" className="rounded-pd-sm bg-pd-well px-3 py-2 text-[13px] text-pd-ink-2">{readOnlyReason}</p> : null}
      <fieldset disabled={Boolean(readOnlyReason)} className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0">
        {children}
      </fieldset>
      {formError ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{formError}</p> : null}
      <div className="sticky bottom-0 -mx-1 flex items-center gap-2 border-t border-pd-rule bg-pd-paper/95 px-1 py-4 backdrop-blur">
        {!readOnlyReason ? <Button type="submit" variant="primary" loading={submitting}>{submitLabel}</Button> : null}
        <LinkButton href={cancelHref} variant="ghost">{readOnlyReason ? 'Back to the list' : 'Cancel'}</LinkButton>
      </div>
    </form>
  );
}

/** Saves a content record: a new draft (then opens it) or changes to an existing one. */
export function useContentSave(type: ContentType, id?: string) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  return async function save(body: unknown) {
    if (id) {
      await call(`/api/admin/content/${type}/${id}`, { method: 'PATCH', body });
      toast.show('Changes saved.');
      router.refresh();
      return;
    }
    const data = await call<{ item: { id: string } }>(`/api/admin/content/${type}`, { body });
    toast.show('Draft created.');
    router.push(`/admin/content/${type}/${data.item.id}`);
    await new Promise(() => {}); // keep the button busy while the page changes
  };
}
