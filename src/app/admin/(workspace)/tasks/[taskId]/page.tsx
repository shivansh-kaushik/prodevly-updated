import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditFeed } from '@/components/admin/audit-feed';
import { PageHeader } from '@/components/admin/page-header';
import { StatusHistory } from '@/components/admin/status-history';
import { Badge } from '@/components/ui/badge';
import { DescriptionList, Panel, PanelHeader } from '@/components/ui/panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { AppError } from '@/lib/api/errors';
import { requireAdminPage } from '@/lib/auth/page-guard';
import { formatDate, formatDateTime, formatDuration } from '@/lib/admin/format';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { parseObjectId } from '@/lib/validation/common';
import { getRecordActivity } from '@/services/activity.service';
import { getSettings } from '@/services/settings.service';
import { getTask } from '@/services/task.service';
import { listTaskWorkLogs } from '@/services/work-log.service';
import { QuickLogForm } from '../../work-logs/_components/quick-log-form';
import { WorkLogTable } from '../../work-logs/_components/work-log-table';
import { AssigneesEditor } from '../_components/assignees-editor';
import { AssigneeNames } from '../_components/task-list';
import { TaskHeaderActions, TaskMoreActions } from '../_components/task-actions';

export const metadata: Metadata = { title: 'Task' };

/** A missing record is a 404; anything else (a database outage) must still surface as an error. */
async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof AppError && e.code === 'NOT_FOUND') return null;
    throw e;
  }
}

export default async function TaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const viewer = await requireAdminPage('/admin/tasks', { capability: 'task:view' });
  const id = parseObjectId((await params).taskId);
  const task = await orNull(getTask(viewer, id));
  if (!task) notFound();

  const caps = viewer.capabilities;
  const canEdit = caps.has('task:edit');
  const viewAll = caps.has('worklog:viewAll');
  const canSeeLogs = caps.has('worklog:own') || viewAll;
  const canLog = caps.has('worklog:own') && task.status !== 'cancelled' && !task.archived && !task.project.archived;
  const settings = await getSettings();
  const today = formatDateOnly(todayDateOnly(new Date(), settings.timezone));

  const [logs, activity] = await Promise.all([
    canSeeLogs ? listTaskWorkLogs(viewer, id) : null,
    // Everyone's time entries appear in the full trail, so only people who may see all logs get them; the rest see the task's own events.
    getRecordActivity(viewer, viewAll ? { taskId: id } : { entityType: 'task', entityId: id }, 15),
  ]);

  const pct = task.estimateMinutes ? Math.round((task.loggedMinutes / task.estimateMinutes) * 100) : null;
  const projectLink = caps.has('project:view') ? (
    <Link href={`/admin/projects/${task.project.id}`} prefetch={false} className="underline-offset-2 hover:underline">{task.project.name}</Link>
  ) : (
    task.project.name
  );
  const clientLink = caps.has('client:view') ? (
    <Link href={`/admin/clients/${task.project.clientId}`} prefetch={false} className="underline-offset-2 hover:underline">{task.project.clientName}</Link>
  ) : (
    task.project.clientName
  );

  return (
    <>
      <PageHeader
        title={task.title}
        description={<><span className="font-pd-mono text-[13px]">{task.ref}</span> in {projectLink} for {clientLink}</>}
        crumbs={[{ label: 'Tasks', href: '/admin/tasks' }, { label: task.ref }]}
        meta={
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={task.status} />
            <StatusBadge status={task.priority} />
            {task.overdue ? <Badge tone="rubric">Overdue</Badge> : null}
            {task.archived ? <Badge>Archived</Badge> : null}
          </span>
        }
        actions={
          canEdit && !task.archived ? (
            <TaskHeaderActions
              task={{ id: task.id, title: task.title, status: task.status }}
              form={{
                id: task.id,
                project: { id: task.project.id, label: task.project.name, ref: task.project.ref },
                title: task.title,
                description: task.description ?? '',
                priority: task.priority,
                estimateMinutes: task.estimateMinutes,
                dueOn: task.dueOn,
                labels: task.labels,
              }}
            />
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel>
            <PanelHeader title="Details" />
            <DescriptionList
              items={[
                { label: 'Due', value: task.dueOn ? <span className="flex items-center gap-2">{formatDate(task.dueOn)}{task.overdue ? <Badge tone="rubric">Overdue</Badge> : null}</span> : '' },
                { label: 'Estimate', value: task.estimateMinutes ? formatDuration(task.estimateMinutes) : '' },
                { label: 'Started', value: task.startedAt ? formatDateTime(task.startedAt) : '' },
                { label: 'Completed', value: task.completedAt ? formatDateTime(task.completedAt) : '' },
                { label: 'Labels', value: task.labels.length ? <span className="flex flex-wrap gap-1">{task.labels.map((l) => <Badge key={l}>{l}</Badge>)}</span> : '' },
                { label: 'Created', value: `${task.createdBy ?? 'Unknown'}, ${formatDate(task.createdAt)}` },
              ]}
            />
            {task.description ? (
              <div className="mt-5 border-t border-pd-rule pt-4">
                <p className="pd-eyebrow">Description</p>
                <p className="mt-1 text-[14px] leading-6 whitespace-pre-wrap text-pd-ink">{task.description}</p>
              </div>
            ) : null}
          </Panel>

          <Panel>
            <PanelHeader title="Assigned to" hint={canEdit && !task.archived ? 'Team members and third parties. Changes save at once.' : undefined} />
            {canEdit && !task.archived ? (
              <AssigneesEditor
                key={task.assignees.map((a) => `${a.kind}:${a.id}`).join(',')}
                taskId={task.id}
                initial={task.assignees.map((a) => ({ kind: a.kind, id: a.id, name: a.name }))}
              />
            ) : (
              <p className="text-[14px]"><AssigneeNames assignees={task.assignees} /></p>
            )}
          </Panel>

          {canSeeLogs ? (
            <Panel>
              <PanelHeader
                title="Time logged"
                hint={`${formatDuration(task.loggedMinutes)} in total${task.estimateMinutes ? ` of ${formatDuration(task.estimateMinutes)} estimated` : ''}${logs?.scope === 'own' ? '. The entries below are yours.' : ''}`}
              />
              {pct !== null ? (
                <div className="mb-4">
                  <div role="img" aria-label={`${pct}% of the estimate used`} className="h-2 overflow-hidden rounded-full bg-pd-well">
                    <div className={pct > 100 ? 'h-full bg-pd-rubric' : 'h-full bg-pd-credit'} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                  <p className={`pd-figure mt-1 text-[12px] ${pct > 100 ? 'font-medium text-pd-rubric' : 'text-pd-ink-3'}`}>
                    {pct > 100 ? `Over the estimate by ${formatDuration(task.loggedMinutes - (task.estimateMinutes ?? 0))} (${pct}%)` : `${pct}% of the estimate used`}
                  </p>
                </div>
              ) : null}
              {canLog ? (
                <div className="mb-5 rounded-pd-md bg-pd-paper p-4 shadow-[0_0_0_1px_var(--color-pd-rule-soft)]">
                  <h3 className="mb-3 text-[14px] font-semibold text-pd-ink">Log time</h3>
                  <QuickLogForm today={today} fixedTask={{ id: task.id, label: task.title, ref: task.ref }} />
                </div>
              ) : task.status === 'cancelled' || task.archived || task.project.archived ? (
                <p className="mb-4 text-[13px] text-pd-ink-3">Time cannot be logged on a cancelled or archived task, or on an archived project.</p>
              ) : null}
              <WorkLogTable
                logs={logs?.logs ?? []}
                today={today}
                showPerson={logs?.scope === 'all'}
                caption={`Time logged on ${task.ref}`}
                total={logs && logs.logs.length > 0 ? { label: logs.scope === 'all' ? 'Total' : 'Your total', minutes: logs.logs.reduce((s, l) => s + l.minutes, 0) } : undefined}
                emptyTitle="No time logged yet"
                emptyBody={canLog ? 'Log the first entry above.' : undefined}
              />
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader title="Activity" />
            <AuditFeed entries={activity} emptyTitle="No activity on this task yet" />
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Panel>
            <PanelHeader title="Status history" />
            <StatusHistory items={task.statusHistory} />
          </Panel>
          {canEdit || viewer.capabilities.has('task:delete') ? (
            <Panel>
              <PanelHeader title="More" />
              <TaskMoreActions task={{ id: task.id, title: task.title, status: task.status }} archived={task.archived} canEdit={canEdit} canDelete={viewer.capabilities.has('task:delete')} />
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
