'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button, IconButton } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/admin/api-client';
import type { TaskStatus } from '@/config/statuses';
import { StatusDialog } from './status-dialog';

/**
 * What a board card can do besides open: Move (to another column, via a dialog that asks for the
 * note when one is required) and, when the board shows a single project, move up or down inside
 * the column. Both are plain buttons, so the board works by keyboard and screen reader and never
 * depends on dragging.
 */
export function BoardCardActions({
  task,
  reorder,
}: {
  task: { id: string; title: string; status: TaskStatus; projectId: string };
  /** Only when the board is filtered to one project: the column's ids in order, and this card's place in them. */
  reorder?: { columnIds: string[]; index: number };
}) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function shift(delta: -1 | 1) {
    if (!reorder || busy) return;
    const ids = [...reorder.columnIds];
    const target = reorder.index + delta;
    const moving = ids[reorder.index];
    const other = ids[target];
    if (moving === undefined || other === undefined) return;
    ids[reorder.index] = other;
    ids[target] = moving;
    setBusy(true);
    try {
      await call('/api/admin/tasks/reorder', { body: { projectId: task.projectId, status: task.status, orderedIds: ids } });
      router.refresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : 'Could not reorder. Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 pt-1">
      <Button variant="secondary" onClick={() => { setMounted(true); setOpen(true); }} aria-label={`Move "${task.title}" to another column`}>
        Move
      </Button>
      {reorder ? (
        <span className="flex items-center">
          <IconButton label={`Move "${task.title}" up`} disabled={busy || reorder.index === 0} onClick={() => shift(-1)}><ArrowUp className="size-4" aria-hidden /></IconButton>
          <IconButton label={`Move "${task.title}" down`} disabled={busy || reorder.index === reorder.columnIds.length - 1} onClick={() => shift(1)}><ArrowDown className="size-4" aria-hidden /></IconButton>
        </span>
      ) : null}
      {mounted ? <StatusDialog key={task.status} open={open} onClose={() => setOpen(false)} task={task} /> : null}
    </div>
  );
}
