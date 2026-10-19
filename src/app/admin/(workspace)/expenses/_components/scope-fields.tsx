'use client';

import { EntityPicker, type PickerValue } from '@/components/admin/entity-picker';
import { Field } from '@/components/ui/field';
import { useState } from 'react';
import { ChoiceGroup } from './choice-group';
import type { Scope } from './form-model';

/**
 * Where the spending is charged: company overhead, or a client's project (and optionally one of its tasks). The pickers
 * cascade: choosing a client narrows the projects, choosing a project narrows the tasks, and changing a level clears
 * the ones below it. The client is only a way to find the project: the server derives it from the project.
 */
export function ScopeFields({
  scope,
  project,
  task,
  initialClient,
  onScope,
  onProject,
  onTask,
  errors,
}: {
  scope: Scope;
  project: PickerValue | null;
  task: PickerValue | null;
  initialClient: PickerValue | null;
  onScope: (scope: Scope) => void;
  onProject: (project: PickerValue | null) => void;
  onTask: (task: PickerValue | null) => void;
  errors: Record<string, string>;
}) {
  const [client, setClient] = useState<PickerValue | null>(initialClient);
  return (
    <div className="flex flex-col gap-4">
      <ChoiceGroup<Scope>
        legend="Charged to"
        value={scope}
        onChange={onScope}
        error={errors.scope}
        choices={[
          { value: 'company', title: 'The company', hint: 'Overhead: not tied to any client.' },
          { value: 'project', title: 'A client project', hint: 'It counts towards that project\'s costs.' },
        ]}
      />
      {scope === 'project' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client" hint="Optional. Narrows the projects to one client." className="sm:col-span-2">
            {(c) => (
              <EntityPicker
                kind="clients"
                id={c.id}
                value={client}
                onChange={(next) => {
                  setClient(next);
                  onProject(null);
                  onTask(null);
                }}
                placeholder="Any client"
              />
            )}
          </Field>
          <Field label="Project" error={errors.projectId ?? errors.clientId} required>
            {(c) => (
              <EntityPicker
                kind="projects"
                id={c.id}
                value={project}
                clientId={client?.id}
                onChange={(next) => {
                  onProject(next);
                  onTask(null);
                }}
                placeholder="Search projects"
                invalid={Boolean(c['aria-invalid'])}
                describedBy={c['aria-describedby']}
                required
              />
            )}
          </Field>
          <Field label="Task" hint={project ? 'Optional.' : 'Pick a project first.'} error={errors.taskId}>
            {(c) => (
              <EntityPicker
                kind="tasks"
                id={c.id}
                value={task}
                projectId={project?.id}
                onChange={onTask}
                disabled={!project}
                placeholder="Search tasks"
                invalid={Boolean(c['aria-invalid'])}
                describedBy={c['aria-describedby']}
              />
            )}
          </Field>
        </div>
      ) : null}
    </div>
  );
}
