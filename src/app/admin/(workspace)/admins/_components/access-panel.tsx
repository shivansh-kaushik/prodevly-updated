'use client';

import { useRouter } from 'next/navigation';
import { useAdminApi } from '@/components/admin/api-provider';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useForm } from '@/lib/admin/use-form';
import type { AdminRole } from '@/config/capabilities';
import { GrantsEditor } from './grants-editor';
import { RolePicker } from './role-picker';

/** Role and grants for one account. Both need a password confirmation, which the API client asks for when it is needed. */
export function AccessPanel({ id, role, grants, locked, lockedReason }: { id: string; role: AdminRole; grants: string[]; locked: boolean; lockedReason?: string }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const form = useForm<{ role: AdminRole; grants: string[] }>({ role, grants });
  const dirty = form.values.role !== role || JSON.stringify([...form.values.grants].sort()) !== JSON.stringify([...grants].sort());

  const onSubmit = form.submit(async (v) => {
    const body: { role?: AdminRole; grants?: string[] } = {};
    if (v.role !== role) body.role = v.role;
    if (v.role === 'admin' && JSON.stringify([...v.grants].sort()) !== JSON.stringify([...grants].sort())) body.grants = v.grants;
    await call(`/api/admin/admins/${id}`, { method: 'PATCH', body });
    toast.show(body.role ? 'Access updated. They will be asked to sign in again.' : 'Access updated.');
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-7">
      {locked ? <p className="rounded-pd-sm bg-pd-well px-3 py-2 text-[13px] text-pd-ink-2">{lockedReason}</p> : null}
      <RolePicker value={form.values.role} onChange={(r) => form.set('role', r)} disabled={locked} />
      {form.values.role === 'admin' ? <GrantsEditor value={form.values.grants} onChange={(g) => form.set('grants', g)} disabled={locked} /> : <p className="text-[13px] text-pd-ink-3">Superadmins have every permission, so there is nothing to grant.</p>}
      {form.formError ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
      {!locked ? (
        <div className="flex items-center gap-2 border-t border-pd-rule pt-5">
          <Button type="submit" variant="primary" disabled={!dirty} loading={form.submitting}>Save access</Button>
          {dirty ? <Button variant="ghost" onClick={() => form.reset({ role, grants })}>Discard</Button> : null}
        </div>
      ) : null}
    </form>
  );
}
