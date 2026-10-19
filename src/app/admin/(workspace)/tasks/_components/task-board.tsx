import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDate } from '@/lib/admin/format';
import { withParams, type RawSearchParams } from '@/lib/admin/search-params';
import type { BoardColumn } from '@/services/task.service';
import { BoardCardActions } from './board-actions';
import { AssigneeNames } from './task-list';

/**
 * Columns by status. Moving a card is a button (and, for one project, up and down within the
 * column), never drag-only. On a phone the columns scroll sideways inside the board, not the page.
 */
export function TaskBoard({ columns, sp, canEdit, projectScoped }: { columns: BoardColumn[]; sp: RawSearchParams; canEdit: boolean; projectScoped: boolean }) {
  return (
    <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0" role="group" aria-label="Task board">
      {columns.map((col) => {
        const ids = col.tasks.map((t) => t.id);
        const open = col.status !== 'done' && col.status !== 'cancelled';
        return (
          <section key={col.status} aria-label={`${col.status.replaceAll('_', ' ')} tasks`} className="w-[min(82vw,18rem)] shrink-0 snap-start rounded-pd-md bg-pd-well/60 p-2 sm:w-72">
            <header className="flex items-center justify-between px-1.5 pt-0.5 pb-2">
              <StatusBadge status={col.status} />
              <span className="pd-figure text-[12px] text-pd-ink-3">{col.total}</span>
            </header>
            {col.tasks.length === 0 ? (
              <p className="px-2 py-6 text-center text-[13px] text-pd-ink-3">No tasks</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {col.tasks.map((t, index) => (
                  <li key={t.id} className="flex flex-col gap-1.5 rounded-pd-md bg-pd-leaf p-3 shadow-[0_0_0_1px_var(--color-pd-rule)]">
                    <Link href={`/admin/tasks/${t.id}`} prefetch={false} className="text-[14px] leading-5 font-medium break-words text-pd-ink underline-offset-2 hover:underline">{t.title}</Link>
                    <p className="truncate text-[12px] text-pd-ink-3"><span className="font-pd-mono">{t.ref}</span>{projectScoped ? '' : ` · ${t.project.name}`}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={t.priority} />
                      {t.dueOn ? <Badge tone={t.overdue ? 'rubric' : 'neutral'}>{t.overdue ? 'Overdue ' : 'Due '}{formatDate(t.dueOn)}</Badge> : null}
                    </div>
                    <p className="truncate text-[12px] text-pd-ink-2"><AssigneeNames assignees={t.assignees} /></p>
                    {canEdit ? (
                      <BoardCardActions
                        task={{ id: t.id, title: t.title, status: t.status, projectId: t.project.id }}
                        reorder={projectScoped && open ? { columnIds: ids, index } : undefined}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {col.total > col.tasks.length ? (
              <p className="px-1.5 pt-2 text-[12px] text-pd-ink-3">
                Showing {col.tasks.length} of {col.total}.{' '}
                <Link href={withParams('/admin/tasks', sp, { view: 'list', status: col.status })} prefetch={false} className="underline">See all in the list</Link>
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
