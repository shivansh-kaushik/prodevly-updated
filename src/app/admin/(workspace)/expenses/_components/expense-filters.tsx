'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { EntityPicker, type PickerValue } from '@/components/admin/entity-picker';

/**
 * The project and person filters beside the toolbar's search and selects, written into the URL like them. The person
 * filter exists only for people who see everyone's expenses; a plain admin only ever sees their own.
 */
export function ExpenseFilters({ project, person, showPerson }: { project: PickerValue | null; person: PickerValue | null; showPerson: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  function push(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    params.delete('page');
    startTransition(() => router.replace(params.toString() ? `${pathname}?${params}` : pathname));
  }

  return (
    <>
      <div className="w-56" aria-busy={pending || undefined}>
        <label className="sr-only" htmlFor="expense-project-filter">Project</label>
        <EntityPicker kind="projects" id="expense-project-filter" value={project} onChange={(p) => push({ projectId: p?.id })} placeholder="Any project" />
      </div>
      {showPerson ? (
        <div className="w-52">
          <label className="sr-only" htmlFor="expense-person-filter">Paid by</label>
          <EntityPicker kind="admins" id="expense-person-filter" value={person} onChange={(p) => push({ person: p?.id })} placeholder="Anyone who paid" />
        </div>
      ) : null}
    </>
  );
}
