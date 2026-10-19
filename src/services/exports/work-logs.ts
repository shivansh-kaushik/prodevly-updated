import { getPeriod } from '@/lib/admin/period';
import { assertCapability } from '@/lib/auth/guard';
import { formatDateOnly } from '@/lib/dates/date-only';
import { parseWorkLogFilter } from '@/lib/validation/work-log';
import { listWorkLogs } from '@/services/work-log.service';
import { dayIn, describePeriod, filterLines, hours, yesNo } from './format';
import { gather } from './gather';
import type { ExportSection } from './types';

/**
 * Everyone's logged time, with the same person, project, billable and period filters as /admin/work-logs
 * (which needs worklog:viewAll: a plain admin's own time is not an export).
 */
export const workLogsExport: ExportSection = {
  id: 'work-logs',
  noun: 'work log entries',
  assertAccess: (viewer) => assertCapability(viewer, 'worklog:viewAll'),
  async build({ viewer, sp, cap, timeZone }) {
    const period = await getPeriod(sp);
    // The page reads only these three; the period decides the dates.
    const { adminId, projectId, billable } = parseWorkLogFilter(sp);
    const from = formatDateOnly(period.from);
    const to = formatDateOnly(period.to);

    const { items, total, truncated } = await gather(cap, async (page, pageSize) => {
      const result = await listWorkLogs(viewer, { adminId, projectId, billable, from, to, page, pageSize });
      return { items: result.items, total: result.total };
    });

    return {
      header: ['Worked on', 'Person', 'Task reference', 'Task', 'Project reference', 'Project', 'Client', 'Minutes', 'Hours', 'Billable', 'Locked by a payout', 'Work done', 'Logged on'],
      rows: items.map((l) => [
        l.workedOn,
        l.adminName,
        l.task.ref,
        l.task.title,
        l.project.ref,
        l.project.name,
        l.clientName,
        l.minutes,
        hours(l.minutes),
        yesNo(l.billable),
        yesNo(l.locked),
        l.note,
        dayIn(l.createdAt, timeZone),
      ]),
      total,
      truncated,
      filters: [...filterLines([['person', adminId], ['project', projectId], ['billable', billable === undefined ? undefined : billable ? 'yes' : 'no']]), describePeriod(period)],
    };
  },
};
