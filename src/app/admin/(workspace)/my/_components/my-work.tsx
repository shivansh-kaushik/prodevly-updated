'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Clock3 } from 'lucide-react';
import type { PickerValue } from '@/components/admin/entity-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDate, formatDuration } from '@/lib/admin/format';
import { cx } from '@/lib/cx';
import type { MyTaskDTO } from '@/services/task.service';
import { QuickLogForm } from '../../work-logs/_components/quick-log-form';

/**
 * My open tasks beside the quick time log. "Log time" on a task fills the form's task and moves
 * focus to the time box. On a phone the form comes first (it is what people open this page for);
 * from large screens the tasks lead and the form sits beside them.
 */
export function MyWork({ tasks, newCount, today, canLog }: { tasks: MyTaskDTO[]; newCount: number; today: string; canLog: boolean }) {
  const [preset, setPreset] = useState<{ task: PickerValue; n: number } | null>(null);

  function logFor(t: MyTaskDTO) {
    setPreset((p) => ({ task: { id: t.id, label: t.title, ref: t.ref }, n: (p?.n ?? 0) + 1 }));
    document.getElementById('quick-log')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
      {canLog ? (
        <Panel className="order-1 lg:sticky lg:top-6 lg:order-2">
          <div id="quick-log" className="scroll-mt-20">
            <PanelHeader title="Log time" hint="Time against a task, for any day up to today" />
            <QuickLogForm key={preset?.n ?? 0} today={today} initialTask={preset?.task ?? null} focusTime={Boolean(preset)} />
          </div>
        </Panel>
      ) : null}

      <Panel className="order-2 lg:order-1">
        <PanelHeader
          title="My open tasks"
          hint={tasks.length > 0 ? `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}, soonest due first` : undefined}
          action={newCount > 0 ? <Badge tone="blue">{newCount} new since your last visit</Badge> : undefined}
        />
        {tasks.length === 0 ? (
          <EmptyState title="Nothing assigned to you" body="Open tasks you are assigned to show up here." className="py-10" />
        ) : (
          <ul>
            {tasks.map((t) => (
              <li key={t.id} className={cx('flex flex-col gap-2 border-b border-pd-rule-soft py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4', t.overdue && 'pd-margin-flag pl-3')}>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link href={`/admin/tasks/${t.id}`} prefetch={false} className="text-[14px] font-medium break-words text-pd-ink underline-offset-2 hover:underline">{t.title}</Link>
                    {t.isNew ? <Badge tone="blue">New</Badge> : null}
                  </p>
                  <p className="truncate text-[12px] text-pd-ink-3"><span className="font-pd-mono">{t.ref}</span> · {t.project.name}</p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={t.status} />
                    <StatusBadge status={t.priority} />
                    {t.dueOn ? <Badge tone={t.overdue ? 'rubric' : 'neutral'}>{t.overdue ? 'Overdue ' : 'Due '}{formatDate(t.dueOn)}</Badge> : null}
                    <span className="pd-figure text-[12px] text-pd-ink-3">
                      {formatDuration(t.loggedMinutes)}{t.estimateMinutes ? ` of ${formatDuration(t.estimateMinutes)}` : ' logged'}
                    </span>
                  </p>
                </div>
                {canLog ? (
                  <Button variant="secondary" className="shrink-0 self-start sm:self-center" onClick={() => logFor(t)} aria-label={`Log time on ${t.title}`}>
                    <Clock3 className="size-4" aria-hidden /> Log time
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
