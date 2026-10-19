'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { EntityPicker, type PickerValue } from '@/components/admin/entity-picker';
import { Field } from '@/components/ui/field';

/**
 * The person, client and project filters. Like the rest of the toolbar they live in the URL, so a
 * filtered log can be bookmarked and the server renders it. The selected names come from the server
 * (the URL only holds ids). A person picker is offered only to viewers who may see everyone's entries.
 */
export function AuditPickers({
  actor,
  client,
  project,
  showPerson,
  showClient,
  showProject,
}: {
  actor: PickerValue | null;
  client: PickerValue | null;
  project: PickerValue | null;
  showPerson: boolean;
  showClient: boolean;
  showProject: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  function set(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(sp.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete('page');
    startTransition(() => router.replace(params.toString() ? `${pathname}?${params}` : pathname));
  }

  const width = 'w-full sm:w-52';
  return (
    <>
      {showPerson ? (
        <Field label="Person" hideLabel className={width}>
          {(c) => (
            <EntityPicker kind="admins" id={c.id} describedBy={c['aria-describedby']} placeholder="Any person" value={actor} onChange={(v) => set({ actor: v?.id })} />
          )}
        </Field>
      ) : null}
      {showClient ? (
        <Field label="Client" hideLabel className={width}>
          {(c) => (
            // Changing the client resets the project: the project list is cascaded from it.
            <EntityPicker kind="clients" id={c.id} describedBy={c['aria-describedby']} placeholder="Any client" value={client} onChange={(v) => set({ client: v?.id, project: undefined })} />
          )}
        </Field>
      ) : null}
      {showProject ? (
        <Field label="Project" hideLabel className={width}>
          {(c) => (
            <EntityPicker
              kind="projects"
              id={c.id}
              describedBy={c['aria-describedby']}
              placeholder="Any project"
              clientId={client?.id}
              value={project}
              onChange={(v) => set({ project: v?.id })}
            />
          )}
        </Field>
      ) : null}
      <span className="sr-only" role="status" aria-live="polite">{pending ? 'Updating the log' : ''}</span>
    </>
  );
}
