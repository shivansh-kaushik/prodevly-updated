'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/admin/api-client';

/** Adds a note to the enquiry. Notes cannot be edited or removed afterwards, which is said here so nobody is surprised. */
export function NoteForm({ id }: { id: string }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string }>();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!text.trim()) {
      setError({ message: 'Write a note first.', field: 'Write a note first.' });
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await call(`/api/admin/enquiries/${id}/notes`, { body: { text } });
      setText('');
      toast.show('Note added.');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) setError({ message: err.message, field: err.fields.text });
      else setError({ message: 'Something went wrong. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <Field label="Add a note" hint="Notes are kept as written and cannot be edited or removed." error={error?.field}>
        {(c) => <Textarea {...c} rows={3} maxLength={2000} value={text} onChange={(e) => { setText(e.target.value); setError(undefined); }} />}
      </Field>
      {error && !error.field ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{error.message}</p> : null}
      <div><Button type="submit" variant="primary" size="sm" loading={busy}>Add note</Button></div>
    </form>
  );
}
