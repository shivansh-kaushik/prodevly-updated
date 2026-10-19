'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/admin/api-client';

type Which = 'archive' | 'restore' | 'delete' | null;

/**
 * Archive hides a client from lists and pickers and keeps everything. Delete is for a mistaken record
 * with nothing attached: it needs the name typed, and the server refuses when anything links to it.
 */
export function ClientActions({ id, name, archived, canArchive, canDelete }: { id: string; name: string; archived: boolean; canArchive: boolean; canDelete: boolean }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [which, setWhich] = useState<Which>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const close = () => { if (!busy) { setWhich(null); setTyped(''); setError(undefined); } };

  async function remove() {
    setBusy(true);
    setError(undefined);
    try {
      await call(`/api/admin/clients/${id}`, { method: 'DELETE', body: { confirmName: typed } });
      toast.show('Client deleted.');
      router.replace('/admin/clients');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? (e.fields.confirmName ?? e.message) : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  return (
    <>
      {canArchive ? (
        archived ? (
          <Button variant="secondary" onClick={() => setWhich('restore')}><ArchiveRestore className="size-4" aria-hidden /> Restore</Button>
        ) : (
          <Button variant="secondary" onClick={() => setWhich('archive')}><Archive className="size-4" aria-hidden /> Archive</Button>
        )
      ) : null}
      {canDelete ? <Button variant="danger" onClick={() => setWhich('delete')}><Trash2 className="size-4" aria-hidden /> Delete</Button> : null}

      <ConfirmDialog
        open={which === 'archive'}
        onClose={close}
        title={`Archive ${name}?`}
        description="They disappear from lists and pickers. Their projects, payments and history stay, and you can restore them any time."
        confirmLabel="Archive"
        tone="primary"
        onConfirm={async () => {
          await call(`/api/admin/clients/${id}/archive`, { body: {} });
          toast.show('Client archived.');
          router.refresh();
        }}
      />
      <ConfirmDialog
        open={which === 'restore'}
        onClose={close}
        title={`Restore ${name}?`}
        description="They appear in lists and pickers again."
        confirmLabel="Restore"
        tone="primary"
        onConfirm={async () => {
          await call(`/api/admin/clients/${id}/restore`, { body: {} });
          toast.show('Client restored.');
          router.refresh();
        }}
      />
      <Dialog
        open={which === 'delete'}
        onClose={close}
        title={`Delete ${name} for good?`}
        description="Only a client with nothing attached can be deleted. If they have projects, payments or enquiries, archive them instead."
        size="sm"
        dismissible={!busy}
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
            <Button variant="danger" loading={busy} disabled={typed.trim() !== name} onClick={remove}>Delete client</Button>
          </>
        }
      >
        <Field label={`Type "${name}" to confirm`} error={error}>
          {(c) => <Input {...c} autoComplete="off" value={typed} onChange={(e) => { setTyped(e.target.value); setError(undefined); }} />}
        </Field>
      </Dialog>
    </>
  );
}
