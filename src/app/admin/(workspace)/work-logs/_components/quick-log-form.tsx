'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminApi } from '@/components/admin/api-provider';
import { EntityPicker, type PickerValue } from '@/components/admin/entity-picker';
import { Button } from '@/components/ui/button';
import { Field, Select, Textarea, Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useForm } from '@/lib/admin/use-form';
import { formatDuration } from '@/lib/admin/format';
import { MAX_DAY_MINUTES, WARN_DAY_MINUTES } from '@/lib/validation/work-log';
import { DurationInput, EMPTY_DURATION, toMinutes, type DurationValue } from './duration-input';

/**
 * Log time against a task: the same form on the task page (the task is fixed) and on My work
 * (the person picks it). It warns above 12 hours for the day and the server refuses above 16.
 * `today` is the organisation's calendar day, passed in so the default never depends on the
 * browser's own time zone.
 */
export interface QuickLogFormProps {
  today: string;
  /** The task is fixed (task page): no picker. */
  fixedTask?: PickerValue;
  /** Start with this task chosen (My work "Log time" on a row). */
  initialTask?: PickerValue | null;
  /** Focus the time box on mount: set when the person just chose a task. */
  focusTime?: boolean;
}

type Billing = 'default' | 'billable' | 'non';

export function QuickLogForm({ today, fixedTask, initialTask = null, focusTime }: QuickLogFormProps) {
  const router = useRouter();
  const { call } = useAdminApi();
  const toast = useToast();
  const [task, setTask] = useState<PickerValue | null>(fixedTask ?? initialTask);
  const [duration, setDuration] = useState<DurationValue>(EMPTY_DURATION);
  const form = useForm({ workedOn: today, note: '', billing: 'default' as Billing });
  const [dayTotal, setDayTotal] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // What this person has already logged on the chosen day, for the 12 hour warning. A convenience
  // only: if the lookup fails the warning is simply not shown, and the server still enforces the cap.
  const day = form.values.workedOn;
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    let current = true;
    call<{ minutes: number }>(`/api/admin/work-logs/day-total?date=${encodeURIComponent(day)}`)
      .then((data) => { if (current) setDayTotal(data.minutes); })
      .catch(() => { if (current) setDayTotal(null); });
    return () => { current = false; };
  }, [day, call, refreshKey]);

  const entered = toMinutes(duration) ?? 0;
  const projected = (dayTotal ?? 0) + entered;
  const warning =
    dayTotal === null || entered === 0
      ? null
      : projected > MAX_DAY_MINUTES
        ? { text: `That would make ${formatDuration(projected)} on this day. The most you can log in a day is 16 h.`, severe: true }
        : projected > WARN_DAY_MINUTES
          ? { text: `That makes ${formatDuration(projected)} on this day. Check it is right.`, severe: false }
          : null;

  const onSubmit = form.submit(async (v) => {
    if (!task) {
      form.setErrors({ taskId: 'Pick the task you worked on' });
      return;
    }
    const minutes = toMinutes(duration);
    if (minutes === null) {
      form.setErrors({ minutes: 'Enter how long you worked' });
      return;
    }
    await call('/api/admin/work-logs', {
      body: { taskId: task.id, workedOn: v.workedOn, minutes, note: v.note, ...(v.billing === 'default' ? {} : { billable: v.billing === 'billable' }) },
    });
    toast.show(`Logged ${formatDuration(minutes)}`);
    setDuration(EMPTY_DURATION);
    form.setValues((cur) => ({ ...cur, note: '' }));
    setRefreshKey((k) => k + 1);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" aria-label="Log time">
      {fixedTask ? null : (
        <Field label="Task" error={form.errors.taskId} required>
          {(c) => (
            <EntityPicker
              kind="tasks"
              id={c.id}
              value={task}
              onChange={(t) => { setTask(t); form.setErrors({}); }}
              placeholder="Search by title or reference"
              invalid={Boolean(c['aria-invalid'])}
              describedBy={c['aria-describedby']}
              required
            />
          )}
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date worked" error={form.errors.workedOn} required>
          {(c) => <Input {...c} type="date" max={today} value={form.values.workedOn} onChange={(e) => form.set('workedOn', e.target.value)} />}
        </Field>
        <Field label="Time spent" error={form.errors.minutes} hint="5 minutes to 12 hours" required>
          {(c) => <DurationInput id={c.id} value={duration} onChange={setDuration} invalid={Boolean(c['aria-invalid'])} describedBy={c['aria-describedby']} autoFocus={focusTime} />}
        </Field>
      </div>
      {warning ? (
        <p role="status" className={`rounded-pd-sm px-3 py-2 text-[13px] ${warning.severe ? 'bg-pd-rubric-wash text-pd-rubric' : 'bg-pd-amber-wash text-pd-amber'}`}>
          {warning.text}
        </p>
      ) : null}
      <Field label="What did you do?" error={form.errors.note} hint="A short note, 3 to 500 characters" required>
        {(c) => <Textarea {...c} rows={2} maxLength={500} value={form.values.note} onChange={(e) => form.set('note', e.target.value)} />}
      </Field>
      <Field label="Billing" error={form.errors.billable}>
        {(c) => (
          <Select {...c} value={form.values.billing} onChange={(e) => form.set('billing', e.target.value as Billing)}>
            <option value="default">Project default (billable on hourly projects)</option>
            <option value="billable">Billable</option>
            <option value="non">Not billable</option>
          </Select>
        )}
      </Field>
      {form.formError ? <p role="alert" className="text-[13px] font-medium text-pd-rubric">{form.formError}</p> : null}
      <div>
        <Button type="submit" variant="primary" loading={form.submitting}>Log time</Button>
      </div>
    </form>
  );
}
