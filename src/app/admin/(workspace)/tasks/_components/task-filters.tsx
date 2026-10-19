'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { EntityPicker, type PickerValue } from '@/components/admin/entity-picker';
import { Select } from '@/components/ui/field';

/** Project and assignee filters, written into the URL beside the toolbar's search and status filters. */
export function TaskFilters({ project }: { project: PickerValue | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const assignee = sp.get('assignee') ?? '';

  function push(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    params.delete('page');
    startTransition(() => router.replace(params.toString() ? `${pathname}?${params}` : pathname));
  }

  const custom = assignee && assignee !== 'me' && assignee !== 'unassigned';

  return (
    <>
      <div className="w-56" aria-busy={pending || undefined}>
        <label className="sr-only" htmlFor="task-project-filter">Project</label>
        <EntityPicker kind="projects" id="task-project-filter" value={project} onChange={(p) => push({ projectId: p?.id })} placeholder="Any project" />
      </div>
      <div className="w-44">
        <Select aria-label="Assignee" value={assignee} onChange={(e) => push({ assignee: e.target.value || undefined })}>
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
          {custom ? <option value={assignee}>One person</option> : null}
        </Select>
      </div>
    </>
  );
}
