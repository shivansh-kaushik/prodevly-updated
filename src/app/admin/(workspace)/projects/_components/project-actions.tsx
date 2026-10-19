'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Archive, ArchiveRestore, ArrowRightLeft, Pencil } from 'lucide-react';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button, LinkButton } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import type { ProjectStatus } from '@/config/statuses';
import { StatusDialog } from './status-dialog';

type Which = 'status' | 'archive' | 'restore' | null;

/** The buttons in a project's header. Each one only shows for someone who may use it; the server checks again. */
export function ProjectActions({
  id,
  name,
  status,
  archived,
  canEdit,
  canArchive,
  canReopen,
}: {
  id: string;
  name: string;
  status: ProjectStatus;
  archived: boolean;
  canEdit: boolean;
  canArchive: boolean;
  canReopen: boolean;
}) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [which, setWhich] = useState<Which>(null);
  const close = () => setWhich(null);

  return (
    <>
      {canEdit && !archived ? (
        <>
          <Button variant="primary" onClick={() => setWhich('status')}><ArrowRightLeft className="size-4" aria-hidden /> Change status</Button>
          <LinkButton href={`/admin/projects/${id}/edit`} variant="secondary"><Pencil className="size-4" aria-hidden /> Edit</LinkButton>
        </>
      ) : null}
      {canArchive ? (
        archived ? (
          <Button variant="secondary" onClick={() => setWhich('restore')}><ArchiveRestore className="size-4" aria-hidden /> Restore</Button>
        ) : (
          <Button variant="danger" onClick={() => setWhich('archive')}><Archive className="size-4" aria-hidden /> Archive</Button>
        )
      ) : null}

      {canEdit && !archived ? <StatusDialog open={which === 'status'} onClose={close} projectId={id} status={status} canReopen={canReopen} /> : null}

      {canArchive && !archived ? (
        <ConfirmDialog
          open={which === 'archive'}
          onClose={close}
          title={`Archive ${name}?`}
          description="It leaves the default project lists. Its tasks, work and money stay, and you can restore it at any time."
          confirmLabel="Archive project"
          reason={{ label: 'Why are you archiving it?', placeholder: 'Delivered and fully billed, client left...' }}
          onConfirm={async (reason) => {
            await call(`/api/admin/projects/${id}/archive`, { body: { reason } });
            toast.show('Project archived.');
            router.refresh();
          }}
        />
      ) : null}
      {canArchive && archived ? (
        <ConfirmDialog
          open={which === 'restore'}
          onClose={close}
          title={`Restore ${name}?`}
          description="It returns to the project lists and can be edited again."
          confirmLabel="Restore project"
          tone="primary"
          onConfirm={async () => {
            await call(`/api/admin/projects/${id}/restore`, { body: {} });
            toast.show('Project restored.');
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
