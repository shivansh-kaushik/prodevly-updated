'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useId, useTransition } from 'react';
import { EntityPicker, type PickerValue } from '@/components/admin/entity-picker';

/**
 * The client and project filters of the ledger: two pickers (the project list follows the chosen client)
 * that write `?client=` and `?project=` into the URL, so the dashboard above and the table below narrow
 * together and the view can be shared. Someone who cannot look clients or projects up still gets the
 * filters from a link; they just have no picker.
 */
export function ScopeFilters({ client, project, canPickClient, canPickProject }: { client: PickerValue | null; project: PickerValue | null; canPickClient: boolean; canPickProject: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const uid = useId();

  function push(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    params.delete('page');
    startTransition(() => router.replace(params.toString() ? `${pathname}?${params}` : pathname));
  }

  if (!canPickClient && !canPickProject) return null;
  return (
    <div className="mb-4 flex flex-wrap gap-2" aria-busy={pending || undefined}>
      {canPickClient ? (
        <div className="w-full sm:w-64">
          <label htmlFor={`${uid}-client`} className="sr-only">Filter by client</label>
          <EntityPicker
            id={`${uid}-client`}
            kind="clients"
            value={client}
            placeholder="Any client"
            // choosing another client drops a project that belongs to the old one; clearing the client keeps the project
            onChange={(c) => push({ client: c?.id, project: c === null || sp.get('client') === c.id ? project?.id : undefined })}
          />
        </div>
      ) : null}
      {canPickProject ? (
        <div className="w-full sm:w-72">
          <label htmlFor={`${uid}-project`} className="sr-only">Filter by project</label>
          <EntityPicker id={`${uid}-project`} kind="projects" value={project} clientId={client?.id} placeholder="Any project" onChange={(p) => push({ project: p?.id })} />
        </div>
      ) : null}
    </div>
  );
}
