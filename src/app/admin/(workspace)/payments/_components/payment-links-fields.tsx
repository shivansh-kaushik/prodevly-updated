'use client';

import { EntityPicker, type PickerValue } from '@/components/admin/entity-picker';
import { formatNative } from '@/components/admin/money';
import { Field, Select } from '@/components/ui/field';
import { cx } from '@/lib/cx';
import { formatDate, humanize } from '@/lib/admin/format';
import type { PaymentContextDTO } from '@/services/client-payment.service';

export interface Lookups {
  clients: boolean;
  projects: boolean;
  tasks: boolean;
}

/**
 * Who paid, for what. The cascade runs client, project, task: choosing a client narrows the projects,
 * choosing a project narrows the tasks and loads its milestones. The client is only a convenience filter:
 * the server takes the client from the project, and a task or milestone must belong to it.
 */
export function PaymentLinksFields({
  editing,
  client,
  project,
  task,
  context,
  contextFailed,
  milestoneId,
  errors,
  lookups,
  onClient,
  onProject,
  onTask,
  onMilestone,
}: {
  editing: boolean;
  client: PickerValue | null;
  project: PickerValue | null;
  task: PickerValue | null;
  context: PaymentContextDTO | null;
  contextFailed: boolean;
  milestoneId: string;
  errors: Record<string, string>;
  lookups: Lookups;
  onClient: (c: PickerValue | null) => void;
  onProject: (p: PickerValue | null) => void;
  onTask: (t: PickerValue | null) => void;
  onMilestone: (id: string) => void;
}) {
  return (
    <div className={cx('grid gap-4', !editing && 'sm:grid-cols-2')}>
      {editing ? (
        <div className="min-w-0">
          <p className="pd-eyebrow">Project</p>
          <p className="mt-0.5 text-[14px]">{project?.label} <span className="font-pd-mono text-[12px] text-pd-ink-3">{project?.ref}</span></p>
          <p className="text-[12px] text-pd-ink-3">For {client?.label}. To move a payment to another project, void it and record it again.</p>
        </div>
      ) : (
        <>
          <Field label="Client" hint={lookups.clients ? 'Optional: narrows the projects.' : undefined}>
            {(c) =>
              lookups.clients ? (
                <EntityPicker kind="clients" id={c.id} value={client} onChange={onClient} placeholder="Search clients" describedBy={c['aria-describedby']} />
              ) : (
                <p className="py-1.5 text-[14px] text-pd-ink-2">{client?.label ?? 'Follows the project'}</p>
              )
            }
          </Field>
          <Field label="Project" error={errors.projectId} hint={lookups.projects ? undefined : 'You need access to projects to pick one.'} required>
            {(c) => (
              <EntityPicker
                kind="projects"
                id={c.id}
                value={project}
                clientId={client?.id}
                onChange={onProject}
                placeholder="Search projects"
                disabled={!lookups.projects}
                invalid={Boolean(c['aria-invalid'])}
                describedBy={c['aria-describedby']}
                required
              />
            )}
          </Field>
        </>
      )}
      {lookups.tasks ? (
        <Field label="Task" error={errors.taskId} hint={project ? 'Optional.' : 'Pick a project first.'}>
          {(c) => (
            <EntityPicker
              kind="tasks"
              id={c.id}
              value={task}
              projectId={project?.id}
              onChange={onTask}
              placeholder="Search tasks"
              disabled={!project}
              invalid={Boolean(c['aria-invalid'])}
              describedBy={c['aria-describedby']}
            />
          )}
        </Field>
      ) : null}
      <Field
        label="Milestone"
        error={errors.milestoneId ?? (contextFailed ? 'We could not load this project\'s milestones.' : undefined)}
        hint={!project ? 'Pick a project first.' : context && context.milestones.length === 0 ? 'This project has no milestones. Add them on its Money tab.' : 'Optional. When payments cover a milestone it is marked paid.'}
      >
        {(c) => (
          <Select id={c.id} aria-describedby={c['aria-describedby']} aria-invalid={c['aria-invalid']} value={milestoneId} disabled={!context || context.milestones.length === 0} onChange={(e) => onMilestone(e.target.value)}>
            <option value="">No milestone</option>
            {(context?.milestones ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} ({formatNative(m.amountMinor, context!.contractCurrency)}, {humanize(m.status)}{m.dueOn ? `, due ${formatDate(m.dueOn)}` : ''})
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}
