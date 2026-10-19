'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ShieldAlert, Trash2 } from 'lucide-react';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';

type Which = 'spam' | 'delete' | null;

/**
 * Marking spam (any admin who may edit; reversible by changing the status) and permanent delete
 * (superadmins only, with a reason for the audit log). Both ask first.
 */
export function RecordActions({
  id,
  name,
  canMarkSpam,
  canDelete,
  converted,
}: {
  id: string;
  name: string;
  canMarkSpam: boolean;
  canDelete: boolean;
  converted: boolean;
}) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [which, setWhich] = useState<Which>(null);
  const close = () => setWhich(null);

  return (
    <div className="flex flex-col items-stretch gap-2">
      {canMarkSpam ? (
        <Button variant="secondary" onClick={() => setWhich('spam')} className="justify-start">
          <ShieldAlert className="size-4" aria-hidden /> Mark as spam
        </Button>
      ) : null}
      {canDelete ? (
        <>
          <Button variant="danger" onClick={() => setWhich('delete')} disabled={converted} className="justify-start">
            <Trash2 className="size-4" aria-hidden /> Delete permanently
          </Button>
          {converted ? <p className="text-[12px] text-pd-ink-3">This enquiry became a client, so it cannot be deleted.</p> : null}
        </>
      ) : null}

      {/* Only the open dialog is mounted: ConfirmDialog's submit button finds its form by a fixed id, so two mounted at once would cross-submit. */}
      {which === 'spam' ? (
        <ConfirmDialog
          open
          onClose={close}
          title="Mark this enquiry as spam?"
          description="It leaves the everyday list and the dashboard figures. It is kept, and you can move it back by changing its status."
          confirmLabel="Mark as spam"
          tone="primary"
          onConfirm={async () => {
            await call(`/api/admin/enquiries/${id}/spam`, { body: {} });
            toast.show('Marked as spam.');
            router.refresh();
          }}
        />
      ) : null}

      {which === 'delete' ? (
        <ConfirmDialog
          open
          onClose={close}
          title={`Delete ${name} for good?`}
          description="The enquiry and its notes are removed and cannot be brought back. The audit log keeps a record that it was deleted, and why."
          confirmLabel="Delete permanently"
          reason={{ label: 'Why are you deleting it?', placeholder: 'Test entry, duplicate, removal request...' }}
          onConfirm={async (reason) => {
            await call(`/api/admin/enquiries/${id}`, { method: 'DELETE', body: { reason } });
            toast.show('Enquiry deleted.');
            router.push('/admin/enquiries');
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
