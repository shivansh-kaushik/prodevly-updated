'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { X } from 'lucide-react';
import { EntityPicker, type PickerValue } from '@/components/admin/entity-picker';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/field';

/** Person, project and billing filters for the all-logs page. Everything is written into the URL, so a view can be shared. */
export function WorkLogFilters({ person, project }: { person: PickerValue | null; project: PickerValue | null }) {
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

  const active = Boolean(sp.get('adminId') || sp.get('projectId') || sp.get('billable'));

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_12rem_auto] lg:items-end" aria-busy={pending || undefined}>
      <Field label="Person">
        {(c) => <EntityPicker kind="admins" id={c.id} value={person} onChange={(v) => push({ adminId: v?.id })} placeholder="Anyone" />}
      </Field>
      <Field label="Project">
        {(c) => <EntityPicker kind="projects" id={c.id} value={project} onChange={(v) => push({ projectId: v?.id })} placeholder="Any project" />}
      </Field>
      <Field label="Billing">
        {(c) => (
          <Select {...c} value={sp.get('billable') ?? ''} onChange={(e) => push({ billable: e.target.value || undefined })}>
            <option value="">Billable or not</option>
            <option value="yes">Billable only</option>
            <option value="no">Not billable</option>
          </Select>
        )}
      </Field>
      {active ? (
        <Button variant="ghost" onClick={() => push({ adminId: undefined, projectId: undefined, billable: undefined })}>
          <X className="size-3.5" aria-hidden /> Clear
        </Button>
      ) : null}
    </div>
  );
}
