'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAdminApi } from '@/components/admin/api-provider';
import { EntityPicker, type PickerValue } from '@/components/admin/entity-picker';
import { Button, LinkButton } from '@/components/ui/button';
import { Field, Fieldset, Input, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { humanize } from '@/lib/admin/format';
import { useForm } from '@/lib/admin/use-form';
import { PRIORITIES } from '@/config/statuses';
import { CREATABLE_TASK_STATUSES } from '@/lib/validation/task';
import { DurationInput, fromMinutes, toMinutes, EMPTY_DURATION, type DurationValue } from '@/app/admin/(workspace)/work-logs/_components/duration-input';
import { AssigneePicker, type AssigneeItem } from './assignee-picker';

export interface TaskFormInitial {
  id: string;
  project: PickerValue;
  title: string;
  description: string;
  priority: (typeof PRIORITIES)[number];
  estimateMinutes: number | null;
  dueOn: string | null;
  labels: string[];
}

/**
 * Create a task, or edit one (the edit form lives in a drawer). Creating can name the first
 * assignees; afterwards people are managed on the task page. A task's client is never asked for:
 * it follows the project.
 */
export function TaskForm({ initial, initialProject, onDone }: { initial?: TaskFormInitial; initialProject?: PickerValue | null; onDone?: () => void }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const editing = Boolean(initial);
  const [project, setProject] = useState<PickerValue | null>(initial?.project ?? initialProject ?? null);
  const [estimate, setEstimate] = useState<DurationValue>(initial?.estimateMinutes ? fromMinutes(initial.estimateMinutes) : EMPTY_DURATION);
  const [assignees, setAssignees] = useState<AssigneeItem[]>([]);
  const form = useForm({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    status: 'todo' as (typeof CREATABLE_TASK_STATUSES)[number],
    priority: (initial?.priority ?? 'medium') as (typeof PRIORITIES)[number],
    dueOn: initial?.dueOn ?? '',
    labels: (initial?.labels ?? []).join(', '),
  });

  const labels = (raw: string) => [...new Set(raw.split(',').map((l) => l.trim()).filter(Boolean))];

  const onSubmit = form.submit(async (v) => {
    if (!project) {
      form.setErrors({ projectId: 'Pick the project this task belongs to' });
      return;
    }
    const estimateMinutes = estimate.hours.trim() === '' && estimate.minutes.trim() === '' ? null : toMinutes(estimate);
    if (estimateMinutes === null && (estimate.hours.trim() !== '' || estimate.minutes.trim() !== '')) {
      form.setErrors({ estimateMinutes: 'Enter a whole number of hours and minutes' });
      return;
    }

    if (initial) {
      const body: Record<string, unknown> = {};
      if (project.id !== initial.project.id) body.projectId = project.id;
      if (v.title !== initial.title) body.title = v.title;
      if (v.description !== initial.description) body.description = v.description.trim() === '' ? null : v.description;
      if (v.priority !== initial.priority) body.priority = v.priority;
      if (estimateMinutes !== initial.estimateMinutes) body.estimateMinutes = estimateMinutes;
      if ((v.dueOn || null) !== initial.dueOn) body.dueOn = v.dueOn || null;
      if (JSON.stringify(labels(v.labels)) !== JSON.stringify(initial.labels)) body.labels = labels(v.labels);
      if (Object.keys(body).length === 0) {
        onDone?.();
        return;
      }
      await call(`/api/admin/tasks/${initial.id}`, { method: 'PATCH', body });
      toast.show('Task updated');
      onDone?.();
      router.refresh();
      return;
    }

    const data = await call<{ task: { id: string } }>('/api/admin/tasks', {
      body: {
        projectId: project.id,
        title: v.title,
        ...(v.description.trim() ? { description: v.description } : {}),
        status: v.status,
        priority: v.priority,
        ...(estimateMinutes ? { estimateMinutes } : {}),
        ...(v.dueOn ? { dueOn: v.dueOn } : {}),
        labels: labels(v.labels),
        assignees: assignees.map((a) => ({ kind: a.kind, id: a.id })),
      },
    });
    toast.show('Task created');
    router.push(`/admin/tasks/${data.task.id}`);
    await new Promise(() => {}); // stay "busy" until the navigation lands, so it cannot be submitted twice
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-3xl flex-col gap-6">
      <Field label="Project" error={form.errors.projectId} hint={editing ? 'Only possible before time is logged or money is recorded against the task.' : 'The client is the project\'s client.'} required>
        {(c) => (
          <EntityPicker
            kind="projects"
            id={c.id}
            value={project}
            onChange={(p) => { setProject(p); form.setErrors({}); }}
            placeholder="Search projects"
            invalid={Boolean(c['aria-invalid'])}
            describedBy={c['aria-describedby']}
            required
          />
        )}
      </Field>
      <Field label="Title" error={form.errors.title} required>
        {(c) => <Input {...c} maxLength={200} autoComplete="off" value={form.values.title} onChange={(e) => form.set('title', e.target.value)} />}
      </Field>
      <Field label="Description" error={form.errors.description} hint="Plain text.">
        {(c) => <Textarea {...c} rows={4} maxLength={8000} value={form.values.description} onChange={(e) => form.set('description', e.target.value)} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        {editing ? null : (
          <Field label="Starts in" error={form.errors.status}>
            {(c) => (
              <Select {...c} value={form.values.status} onChange={(e) => form.set('status', e.target.value as (typeof CREATABLE_TASK_STATUSES)[number])}>
                {CREATABLE_TASK_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
              </Select>
            )}
          </Field>
        )}
        <Field label="Priority" error={form.errors.priority}>
          {(c) => (
            <Select {...c} value={form.values.priority} onChange={(e) => form.set('priority', e.target.value as (typeof PRIORITIES)[number])}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Due date" error={form.errors.dueOn}>
          {(c) => <Input {...c} type="date" value={form.values.dueOn} onChange={(e) => form.set('dueOn', e.target.value)} />}
        </Field>
        <Field label="Estimate" error={form.errors.estimateMinutes} hint="Optional. Hours and minutes.">
          {(c) => <DurationInput id={c.id} value={estimate} onChange={(d) => { setEstimate(d); form.setErrors({}); }} invalid={Boolean(c['aria-invalid'])} describedBy={c['aria-describedby']} />}
        </Field>
      </div>
      <Field label="Labels" error={form.errors.labels} hint="Separate with commas.">
        {(c) => <Input {...c} autoComplete="off" value={form.values.labels} onChange={(e) => form.set('labels', e.target.value)} />}
      </Field>
      {editing ? null : (
        <Fieldset legend="Assign to" hint="Team members and third parties. You can change this later.">
          <AssigneePicker value={assignees} onChange={setAssignees} />
          {form.errors.assignees ? <p role="alert" className="mt-1.5 text-[12px] font-medium text-pd-rubric">{form.errors.assignees}</p> : null}
        </Fieldset>
      )}
      {form.formError ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
      <div className="flex items-center gap-2 border-t border-pd-rule pt-5">
        <Button type="submit" variant="primary" loading={form.submitting}>{editing ? 'Save changes' : 'Create task'}</Button>
        {editing ? <Button variant="ghost" onClick={onDone} disabled={form.submitting}>Cancel</Button> : <LinkButton href="/admin/tasks" variant="ghost">Cancel</LinkButton>}
      </div>
    </form>
  );
}
