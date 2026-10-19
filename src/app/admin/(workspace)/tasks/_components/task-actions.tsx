'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Archive, ArchiveRestore, Ban, Pencil, Trash2 } from 'lucide-react';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import type { TaskStatus } from '@/config/statuses';
import { StatusDialog } from './status-dialog';
import { TaskForm, type TaskFormInitial } from './task-form';

interface TaskRef {
  id: string;
  title: string;
  status: TaskStatus;
}

/** The two things done most from a task page: move it along, and edit it. */
export function TaskHeaderActions({ task, form }: { task: TaskRef; form: TaskFormInitial }) {
  const [status, setStatus] = useState(false);
  const [editing, setEditing] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setStatus(true)}>Change status</Button>
      <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="size-4" aria-hidden /> Edit</Button>
      <StatusDialog key={task.status} open={status} onClose={() => setStatus(false)} task={task} />
      {editing ? (
        <Dialog open onClose={() => setEditing(false)} title="Edit task" description={`Changes are recorded in the activity log.`} variant="drawer">
          <TaskForm initial={form} onDone={() => setEditing(false)} />
        </Dialog>
      ) : null}
    </>
  );
}

type Which = 'cancel' | 'archive' | 'restore' | 'delete' | null;

/** Cancel, archive or delete. Each asks first; cancel and delete say why or what is lost. */
export function TaskMoreActions({ task, archived, canEdit, canDelete }: { task: TaskRef; archived: boolean; canEdit: boolean; canDelete: boolean }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [which, setWhich] = useState<Which>(null);
  const close = () => setWhich(null);

  return (
    <div className="flex flex-col items-stretch gap-2">
      {canEdit && !archived && task.status !== 'cancelled' ? (
        <Button variant="secondary" className="justify-start" onClick={() => setWhich('cancel')}><Ban className="size-4" aria-hidden /> Cancel this task</Button>
      ) : null}
      {canEdit && archived ? (
        <Button variant="secondary" className="justify-start" onClick={() => setWhich('restore')}><ArchiveRestore className="size-4" aria-hidden /> Restore from archive</Button>
      ) : null}
      {canEdit && !archived ? (
        <Button variant="secondary" className="justify-start" onClick={() => setWhich('archive')}><Archive className="size-4" aria-hidden /> Archive</Button>
      ) : null}
      {canDelete ? (
        <Button variant="danger" className="justify-start" onClick={() => setWhich('delete')}><Trash2 className="size-4" aria-hidden /> Delete permanently</Button>
      ) : null}

      {/* One at a time: ConfirmDialog's form has a fixed id, so several mounted together would answer each other's button. */}
      {which === 'cancel' ? (
        <ConfirmDialog
          open
          onClose={close}
          title="Cancel this task?"
          description="It stays in the project's history but leaves the open lists, and no more time can be logged on it. You can reopen it later."
          confirmLabel="Cancel task"
          reason={{ label: 'Why is it cancelled?', placeholder: 'The client dropped the feature...' }}
          onConfirm={async (note) => {
            await call(`/api/admin/tasks/${task.id}/status`, { body: { status: 'cancelled', note } });
            toast.show('Task cancelled');
            router.refresh();
          }}
        />
      ) : null}
      {which === 'archive' ? (
        <ConfirmDialog
          open
          onClose={close}
          title="Archive this task?"
          description="Archiving hides it from lists, the board and the dashboard. Its time logged and history are kept, and you can restore it."
          confirmLabel="Archive"
          tone="primary"
          onConfirm={async () => {
            await call(`/api/admin/tasks/${task.id}/archive`, { method: 'POST', body: {} });
            toast.show('Task archived');
            router.refresh();
          }}
        />
      ) : null}
      {which === 'restore' ? (
        <ConfirmDialog
          open
          onClose={close}
          title="Restore this task?"
          description="It comes back to its column on the board."
          confirmLabel="Restore"
          tone="primary"
          onConfirm={async () => {
            await call(`/api/admin/tasks/${task.id}/restore`, { method: 'POST', body: {} });
            toast.show('Task restored');
            router.refresh();
          }}
        />
      ) : null}
      {which === 'delete' ? (
        <ConfirmDialog
          open
          onClose={close}
          title="Delete this task for good?"
          description="This cannot be undone. A task with time logged or money recorded against it cannot be deleted: archive it instead."
          confirmLabel="Delete permanently"
          onConfirm={async () => {
            await call(`/api/admin/tasks/${task.id}`, { method: 'DELETE' });
            toast.show('Task deleted');
            router.push('/admin/tasks');
            await new Promise(() => {});
          }}
        />
      ) : null}
    </div>
  );
}
