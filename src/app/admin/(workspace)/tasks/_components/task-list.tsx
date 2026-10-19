import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { RowLink, Table, TableFrame, Td, THead, Th, Tr } from '@/components/ui/table';
import { formatDate, formatDuration } from '@/lib/admin/format';
import type { RawSearchParams } from '@/lib/admin/search-params';
import type { TaskListItemDTO } from '@/services/task.service';

/** Who is on a task, in a line: two names and "+N". */
export function AssigneeNames({ assignees }: { assignees: TaskListItemDTO['assignees'] }) {
  if (assignees.length === 0) return <span className="text-pd-ink-3">Unassigned</span>;
  const [a, b] = assignees;
  return (
    <span title={assignees.map((x) => x.name).join(', ')}>
      {a?.name}
      {b ? `, ${b.name}` : ''}
      {assignees.length > 2 ? <span className="text-pd-ink-3"> +{assignees.length - 2}</span> : null}
    </span>
  );
}

export function TaskList({
  items,
  sp,
  sort,
  dir,
  filtered,
  canCreate,
}: {
  items: TaskListItemDTO[];
  sp: RawSearchParams;
  sort: string;
  dir: 'asc' | 'desc';
  filtered: boolean;
  canCreate: boolean;
}) {
  const sortOf = (key: string) => ({ key, path: '/admin/tasks', params: sp, active: sort, dir });
  return (
    <TableFrame>
      <Table caption="Tasks">
        <THead>
          <tr>
            <Th sort={sortOf('title')}>Task</Th>
            <Th>Status</Th>
            <Th>Priority</Th>
            <Th>Assigned to</Th>
            <Th sort={sortOf('dueOn')}>Due</Th>
            <Th numeric>Time</Th>
          </tr>
        </THead>
        <tbody>
          {items.map((t) => (
            <Tr key={t.id} flag={t.overdue}>
              <Td className="max-w-80 min-w-56 py-2">
                <RowLink href={`/admin/tasks/${t.id}`} className="block truncate">{t.title}</RowLink>
                <span className="block truncate text-[12px] text-pd-ink-3"><span className="font-pd-mono">{t.ref}</span> · {t.project.name}</span>
              </Td>
              <Td><span className="flex flex-wrap gap-1"><StatusBadge status={t.status} />{t.archived ? <Badge>Archived</Badge> : null}</span></Td>
              <Td><StatusBadge status={t.priority} /></Td>
              <Td className="max-w-48 truncate"><AssigneeNames assignees={t.assignees} /></Td>
              <Td className="whitespace-nowrap">
                {t.dueOn ? (
                  <span className="flex items-center gap-1.5">{formatDate(t.dueOn)}{t.overdue ? <Badge tone="rubric">Overdue</Badge> : null}</span>
                ) : (
                  <span className="text-pd-ink-3">No date</span>
                )}
              </Td>
              <Td numeric>
                {formatDuration(t.loggedMinutes)}
                {t.estimateMinutes ? <span className="block text-[12px] font-normal text-pd-ink-3">of {formatDuration(t.estimateMinutes)}</span> : null}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      {items.length === 0 ? (
        <EmptyState
          title={filtered ? 'No tasks match' : 'No tasks yet'}
          body={filtered ? 'Try a different search or clear the filters.' : 'Tasks belong to a project. Add the first one.'}
          action={
            filtered ? <Link href="/admin/tasks" className="text-[14px] underline">Clear filters</Link> : canCreate ? <LinkButton href="/admin/tasks/new" variant="primary"><Plus className="size-4" aria-hidden /> New task</LinkButton> : undefined
          }
          className="py-10"
        />
      ) : null}
    </TableFrame>
  );
}
