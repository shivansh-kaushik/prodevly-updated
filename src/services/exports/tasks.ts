import { parseListParams } from '@/lib/admin/search-params';
import { assertCapability } from '@/lib/auth/guard';
import { parseTaskFilter, TASK_SORT_KEYS } from '@/lib/validation/task';
import { searchTasks, type TaskSort } from '@/services/task.service';
import { dayIn, filterLines, hours, list, words, yesNo } from './format';
import { gather } from './gather';
import type { ExportSection } from './types';

/** The Tasks list view, with the same filters and sort as /admin/tasks (the board is not a table, so it exports as the list). */
export const tasksExport: ExportSection = {
  id: 'tasks',
  noun: 'tasks',
  assertAccess: (viewer) => assertCapability(viewer, 'task:view'),
  async build({ viewer, sp, cap, timeZone }) {
    const filter = parseTaskFilter(sp, { viewerId: viewer.id });
    const sorting = parseListParams(sp, { sortable: TASK_SORT_KEYS, defaultSort: 'updatedAt' });

    const { items, total, truncated } = await gather(cap, async (page, pageSize) => {
      const result = await searchTasks(viewer, { ...filter, sort: sorting.sort as TaskSort, dir: sorting.dir, page, pageSize });
      return { items: result.items, total: result.total };
    });

    const assignee = typeof filter.assignee === 'object' ? `${filter.assignee.kind}:${filter.assignee.id}` : filter.assignee;
    return {
      header: ['Reference', 'Title', 'Project reference', 'Project', 'Client', 'Status', 'Priority', 'Due on', 'Overdue', 'Estimate (hours)', 'Logged (hours)', 'Assigned to', 'Archived', 'Updated on'],
      rows: items.map((t) => [
        t.ref,
        t.title,
        t.project.ref,
        t.project.name,
        t.project.clientName,
        words(t.status),
        words(t.priority),
        t.dueOn,
        yesNo(t.overdue),
        hours(t.estimateMinutes),
        hours(t.loggedMinutes),
        list(t.assignees.map((a) => a.name)),
        yesNo(t.archived),
        dayIn(t.updatedAt, timeZone),
      ]),
      total,
      truncated,
      filters: filterLines([
        ['search', filter.q], ['status', filter.status], ['priority', filter.priority], ['project', filter.projectId], ['client', filter.clientId],
        ['assignee', assignee], ['overdue', filter.overdue], ['archived', filter.archived], ['sort', `${sorting.sort} ${sorting.dir}`],
      ]),
    };
  },
};
