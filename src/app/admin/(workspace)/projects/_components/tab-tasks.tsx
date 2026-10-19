import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { RowLink, Table, TableFrame, Td, THead, Th, Tr } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatCount, formatDate, formatDuration, humanize } from '@/lib/admin/format';
import type { ProjectTaskRow } from '@/services/dashboards/projects';
import { PRIORITY_LABELS } from './labels';

/** `addTaskHref` is set only for someone who may create tasks on this project (a holder of `task:edit`, project not archived). */
export function TasksTab({ tasks, addTaskHref }: { tasks: { items: ProjectTaskRow[]; total: number; byStatus: Record<string, number> }; addTaskHref?: string }) {
  const addTask = addTaskHref ? <LinkButton href={addTaskHref} variant="secondary" prefetch={false}>Add task</LinkButton> : undefined;
  if (tasks.items.length === 0) {
    return (
      <Panel flush>
        <EmptyState title="No tasks yet" body="Tasks for this project are created and tracked in the Tasks section." action={addTask} />
      </Panel>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap gap-2" aria-label="Tasks by status">
          {Object.entries(tasks.byStatus).map(([status, n]) => (
            <li key={status}><Badge>{humanize(status)} <span className="pd-figure font-semibold">{formatCount(n)}</span></Badge></li>
          ))}
        </ul>
        {addTask}
      </div>
      <TableFrame>
        <Table caption="Tasks in this project" className="min-w-[44rem]">
          <THead>
            <tr><Th>Task</Th><Th>Status</Th><Th>Priority</Th><Th>Assigned to</Th><Th>Due</Th><Th numeric>Logged</Th></tr>
          </THead>
          <tbody>
            {tasks.items.map((t) => (
              <Tr key={t.id}>
                <Td className="max-w-80">
                  <RowLink href={`/admin/tasks/${t.id}`}>{t.title}</RowLink>
                  <span className="block font-pd-mono text-[12px] text-pd-ink-3">{t.ref}</span>
                </Td>
                <Td><StatusBadge status={t.status} /></Td>
                <Td muted>{PRIORITY_LABELS[t.priority] ?? t.priority}</Td>
                <Td muted>{t.assignees.length ? t.assignees.join(', ') : 'Unassigned'}</Td>
                <Td muted className="whitespace-nowrap">{t.dueOn ? formatDate(t.dueOn) : 'No date'}</Td>
                <Td numeric>
                  {formatDuration(t.loggedMinutes)}
                  {t.estimateMinutes ? <span className="block text-[12px] text-pd-ink-3">of {formatDuration(t.estimateMinutes)}</span> : null}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableFrame>
      {tasks.total > tasks.items.length ? <p className="text-[12px] text-pd-ink-3">Showing {formatCount(tasks.items.length)} of {formatCount(tasks.total)} tasks.</p> : null}
    </div>
  );
}
