'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useAdminApi } from '@/components/admin/api-provider';

export function SignOutEverywhere() {
  const [open, setOpen] = useState(false);
  const { call } = useAdminApi();
  const toast = useToast();
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Sign out everywhere</Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Sign out everywhere?"
        description="Every other browser and device you are signed in on will be signed out. This one stays signed in."
        confirmLabel="Sign out everywhere"
        tone="primary"
        onConfirm={async () => {
          await call('/api/admin/auth/sign-out-everywhere', { body: {} });
          toast.show('Signed out everywhere else');
        }}
      />
    </>
  );
}
