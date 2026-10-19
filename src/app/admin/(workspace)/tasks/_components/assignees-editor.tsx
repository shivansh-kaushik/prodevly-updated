'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAdminApi } from '@/components/admin/api-provider';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/admin/api-client';
import { AssigneePicker, type AssigneeItem } from './assignee-picker';

/**
 * Change who is on a task from its page: each add or remove is saved straight away (and recorded
 * in the activity log). Remount it with a `key` built from the people so it follows the server.
 */
export function AssigneesEditor({ taskId, initial }: { taskId: string; initial: AssigneeItem[] }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [list, setList] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save(next: AssigneeItem[]) {
    const before = list;
    setList(next);
    setBusy(true);
    setError(undefined);
    try {
      await call(`/api/admin/tasks/${taskId}/assignees`, { method: 'PUT', body: { assignees: next.map((a) => ({ kind: a.kind, id: a.id })) } });
      toast.show('Assignees updated');
      router.refresh();
    } catch (e) {
      setList(before);
      setError(e instanceof ApiError ? (e.fields.assignees ?? e.message) : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2" aria-busy={busy || undefined}>
      <AssigneePicker value={list} onChange={save} disabled={busy} />
      {error ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{error}</p> : null}
    </div>
  );
}
