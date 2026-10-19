'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAdminApi } from '@/components/admin/api-provider';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/admin/api-client';

export interface SaveError {
  message: string;
  fields: Record<string, string>;
}

/**
 * One save button's worth of state for the enquiry page: a PATCH to the enquiry, a toast, a refresh
 * of the server-rendered page, and the server's field messages kept for showing in place. Each
 * control (status, assignee, follow-up) owns its own, so saving one never blocks or clears another.
 */
export function useEnquirySave(id: string) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SaveError>();

  async function save(body: Record<string, unknown>, success: string): Promise<boolean> {
    setBusy(true);
    setError(undefined);
    try {
      await call(`/api/admin/enquiries/${id}`, { method: 'PATCH', body });
      toast.show(success);
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? { message: e.message, fields: e.fields } : { message: 'Something went wrong. Please try again.', fields: {} });
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { save, busy, error, clearError: () => setError(undefined) };
}
