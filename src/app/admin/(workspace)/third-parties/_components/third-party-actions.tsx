'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Archive, ArchiveRestore, Pencil } from 'lucide-react';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { ThirdPartyForm, type ThirdPartyFormInitial } from './third-party-form';

/** Edit, archive or restore one third party. Archive is refused by the server while open work orders or due payouts refer to it, and says so in the dialog. */
export function ThirdPartyActions({
  form,
  name,
  archived,
  types,
  currencies,
  canPayDetails,
}: {
  form: ThirdPartyFormInitial;
  name: string;
  archived: boolean;
  types: readonly string[];
  currencies: readonly string[];
  canPayDetails: boolean;
}) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [which, setWhich] = useState<'edit' | 'archive' | 'restore' | null>(null);
  const close = () => setWhich(null);

  return (
    <>
      {archived ? (
        <Button variant="secondary" onClick={() => setWhich('restore')}><ArchiveRestore className="size-4" aria-hidden /> Restore</Button>
      ) : (
        <>
          <Button variant="secondary" onClick={() => setWhich('edit')}><Pencil className="size-4" aria-hidden /> Edit</Button>
          <Button variant="secondary" onClick={() => setWhich('archive')}><Archive className="size-4" aria-hidden /> Archive</Button>
        </>
      )}

      {which === 'edit' ? (
        <Dialog open onClose={close} title="Edit third party" description="Changes are recorded in the activity log." variant="drawer">
          <ThirdPartyForm initial={form} types={types} currencies={currencies} canPayDetails={canPayDetails} onDone={close} />
        </Dialog>
      ) : null}
      {/* One at a time: ConfirmDialog is a form, so several mounted together would answer each other's button. */}
      {which === 'archive' ? (
        <ConfirmDialog
          open
          onClose={close}
          title={`Archive ${name}?`}
          description="They leave the pickers and the default list. Their work orders, payouts and history stay, and you can restore them later. This is refused while they have open work orders or payouts still due."
          confirmLabel="Archive"
          tone="primary"
          onConfirm={async () => {
            await call(`/api/admin/third-parties/${form.id}/archive`, { method: 'POST', body: {} });
            toast.show('Third party archived');
            router.refresh();
          }}
        />
      ) : null}
      {which === 'restore' ? (
        <ConfirmDialog
          open
          onClose={close}
          title={`Restore ${name}?`}
          description="They come back to the pickers and the default list."
          confirmLabel="Restore"
          tone="primary"
          onConfirm={async () => {
            await call(`/api/admin/third-parties/${form.id}/restore`, { method: 'POST', body: {} });
            toast.show('Third party restored');
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
