import { Types } from 'mongoose';
import { connectToDatabase, mongoose } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { startOfDayInstant, type Period } from '@/lib/dates/ranges';
import { parseObjectId } from '@/lib/validation/common';
import { Project, Task, WorkLog } from '@/models';
import type { SessionUser } from '@/types/session';
import { getSettings } from '@/services/settings.service';
import { CLOSED_STATUSES, OPEN_STATUSES } from '@/services/task.service';

/**
 * The Tasks and work logs dashboard (plan section 5). Every figure is computed from records,
 * archived tasks never count as open, and a ratio exists only when its denominator is above zero.
 * Everyone with `task:view` sees the task figures. Hours are different: everyone's hours need
 * `worklog:viewAll`; anyone else sees only their own (and `scope` says which it is).
 */
export type OpenStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'blocked';

export interface TasksDashboardFilters {
  projectId?: string;
  clientId?: string;
}

export interface AssigneeLoad {
  key: string;
  name: string;
  kind: 'admin' | 'thirdParty' | 'none';
  backlog: number;
  todo: number;
  in_progress: number;
  in_review: number;
  blocked: number;
  total: number;
}

export interface HoursByProject {
  projectId: string;
  ref: string;
  name: string;
  minutes: number;
}

export interface TasksDashboard {
  period: { key: string; label: string; from: string; to: string };
  openTotal: number;
  openByStatus: Record<OpenStatus, number>;
  overdue: number;
  unassigned: number;
  blocked: number;
  completedInPeriod: number;
  /** First move to in progress until done, over tasks completed in the period that were ever started. */
  medianCycleMs: number | null;
  cycleSampleSize: number;
  hours: { scope: 'all' | 'own'; minutes: number; billableMinutes: number; billableShare: number | null };
  /** The last 12 weeks, oldest first. `weekStart` is the Monday, "YYYY-MM-DD". */
  completedPerWeek: Array<{ weekStart: string; completed: number }>;
  openPerAssignee: AssigneeLoad[];
  hoursPerWeek: { scope: 'all' | 'own'; weeks: string[]; people: Array<{ id: string; name: string; minutes: number[] }> };
  hoursByProject: HoursByProject[];
  /** Tasks done in the period that had an estimate. `null` when the viewer may not see everyone's hours. */
  estimateVsLogged: Array<{ id: string; ref: string; title: string; estimateMinutes: number; loggedMinutes: number }> | null;
}

export const WEEKS = 12;
const DAY = 86_400_000;
const MAX_PEOPLE = 8;
const oid = (id: string) => new Types.ObjectId(id);

/** Monday date-onlys, oldest first, the last one being the week that contains `today`. */
export function weekStarts(count: number, today: Date): Date[] {
  const offset = (today.getUTCDay() + 6) % 7;
  const current = new Date(today.getTime() - offset * DAY);
  return Array.from({ length: count }, (_, i) => new Date(current.getTime() - (count - 1 - i) * 7 * DAY));
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? null) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Half-open instant boundaries of the weeks, in the organisation's zone (completion is a real instant). */
export function weekBoundaries(weeks: readonly Date[], timeZone: string): Date[] {
  const last = weeks.at(-1);
  if (!last) return [];
  return [...weeks.map((w) => startOfDayInstant(w, timeZone)), startOfDayInstant(new Date(last.getTime() + 7 * DAY), timeZone)];
}

const statusCount = (status: string) => ({ $sum: { $cond: [{ $eq: ['$status', status] }, 1, 0] } });

export async function getTasksDashboard(
  viewer: SessionUser,
  period: Period,
  filters: TasksDashboardFilters = {},
  now = new Date(),
): Promise<TasksDashboard> {
  assertCapability(viewer, 'task:view');
  await connectToDatabase();
  const settings = await getSettings();
  const today = todayDateOnly(now, settings.timezone);
  const allHours = viewer.capabilities.has('worklog:viewAll');
  const hoursScope = allHours ? 'all' : 'own';

  const scope: Record<string, unknown> = {};
  if (filters.projectId) scope.projectId = oid(parseObjectId(filters.projectId));
  if (filters.clientId) scope.clientId = oid(parseObjectId(filters.clientId));

  const weeks = weekStarts(WEEKS, today);
  const bounds = weekBoundaries(weeks, settings.timezone);
  const open = { archivedAt: null, status: { $nin: [...CLOSED_STATUSES] } };
  const logScope: Record<string, unknown> = { ...scope };
  if (!allHours) logScope.adminId = oid(viewer.id);
  const lastWeekEnd = new Date((weeks.at(-1)?.getTime() ?? today.getTime()) + 6 * DAY);

  const [taskFacets, hourFacets, weeklyHours] = await Promise.all([
    Task.aggregate<{
      open: Array<{ _id: OpenStatus; n: number }>;
      overdue: Array<{ n: number }>;
      unassigned: Array<{ _id: OpenStatus; n: number }>;
      perAssignee: Array<Omit<AssigneeLoad, 'key' | 'kind'> & { _id: { kind: 'admin' | 'thirdParty'; id: Types.ObjectId } }>;
      completed: Array<{ _id: Types.ObjectId; ref: string; title: string; startedAt?: Date; completedAt: Date; estimateMinutes?: number; loggedMinutes?: number }>;
      weekly: Array<{ _id: Date; n: number }>;
    }>([
      { $match: scope },
      {
        $facet: {
          open: [{ $match: open }, { $group: { _id: '$status', n: { $sum: 1 } } }],
          overdue: [{ $match: { ...open, dueOn: { $lt: today } } }, { $count: 'n' }],
          unassigned: [{ $match: { ...open, 'assignees.0': { $exists: false } } }, { $group: { _id: '$status', n: { $sum: 1 } } }],
          perAssignee: [
            { $match: open },
            { $unwind: '$assignees' },
            {
              $group: {
                _id: { kind: '$assignees.kind', id: '$assignees.id' },
                name: { $first: '$assignees.name' },
                backlog: statusCount('backlog'),
                todo: statusCount('todo'),
                in_progress: statusCount('in_progress'),
                in_review: statusCount('in_review'),
                blocked: statusCount('blocked'),
                total: { $sum: 1 },
              },
            },
            { $sort: { total: -1, name: 1 } },
            { $limit: 10 },
          ],
          completed: [
            { $match: { status: 'done', completedAt: { $gte: period.fromInstant, $lt: period.toInstant } } },
            { $project: { ref: 1, title: 1, startedAt: 1, completedAt: 1, estimateMinutes: 1, loggedMinutes: 1 } },
            { $limit: 5000 },
          ],
          weekly: [
            { $match: { status: 'done', completedAt: { $gte: bounds[0], $lt: bounds[bounds.length - 1] } } },
            { $bucket: { groupBy: '$completedAt', boundaries: bounds, default: 'other', output: { n: { $sum: 1 } } } },
          ],
        },
      },
    ]),
    WorkLog.aggregate<{
      totals: Array<{ minutes: number; billableMinutes: number }>;
      byProject: Array<{ _id: Types.ObjectId; minutes: number }>;
    }>([
      { $match: { ...logScope, workedOn: { $gte: period.from, $lte: period.to } } },
      {
        $facet: {
          totals: [{ $group: { _id: null, minutes: { $sum: '$minutes' }, billableMinutes: { $sum: { $cond: ['$billable', '$minutes', 0] } } } }],
          byProject: [{ $group: { _id: '$projectId', minutes: { $sum: '$minutes' } } }, { $sort: { minutes: -1, _id: 1 } }, { $limit: 10 }],
        },
      },
    ]),
    WorkLog.aggregate<{ _id: { adminId: Types.ObjectId; week: Date }; minutes: number; name: string }>([
      { $match: { ...logScope, workedOn: { $gte: weeks[0], $lte: lastWeekEnd } } },
      {
        $group: {
          _id: { adminId: '$adminId', week: { $dateTrunc: { date: '$workedOn', unit: 'week', startOfWeek: 'monday' } } },
          minutes: { $sum: '$minutes' },
          name: { $first: '$adminName' },
        },
      },
    ]),
  ]);

  const f = taskFacets[0];
  const openByStatus = Object.fromEntries(OPEN_STATUSES.map((s) => [s, 0])) as Record<OpenStatus, number>;
  for (const row of f?.open ?? []) openByStatus[row._id] = row.n;
  const openTotal = Object.values(openByStatus).reduce((a, b) => a + b, 0);

  const unassignedByStatus = Object.fromEntries(OPEN_STATUSES.map((s) => [s, 0])) as Record<OpenStatus, number>;
  for (const row of f?.unassigned ?? []) unassignedByStatus[row._id] = row.n;
  const unassigned = Object.values(unassignedByStatus).reduce((a, b) => a + b, 0);

  const completed = f?.completed ?? [];
  const cycles = completed.flatMap((t) => (t.startedAt ? [Math.max(0, t.completedAt.getTime() - t.startedAt.getTime())] : []));

  const weekly = new Map((f?.weekly ?? []).map((w) => [w._id instanceof Date ? w._id.getTime() : -1, w.n]));
  const completedPerWeek = weeks.map((w, i) => ({ weekStart: formatDateOnly(w), completed: weekly.get(bounds[i]?.getTime() ?? -2) ?? 0 }));

  const openPerAssignee: AssigneeLoad[] = (f?.perAssignee ?? []).map((a) => ({
    key: `${a._id.kind}:${String(a._id.id)}`,
    name: a.name,
    kind: a._id.kind,
    backlog: a.backlog,
    todo: a.todo,
    in_progress: a.in_progress,
    in_review: a.in_review,
    blocked: a.blocked,
    total: a.total,
  }));
  if (unassigned > 0) openPerAssignee.push({ key: 'none', name: 'Unassigned', kind: 'none', ...unassignedByStatus, total: unassigned });

  // Hours.
  const totals = hourFacets[0]?.totals[0];
  const minutes = totals?.minutes ?? 0;
  const billableMinutes = totals?.billableMinutes ?? 0;
  const projectIds = (hourFacets[0]?.byProject ?? []).map((p) => p._id);
  const projects = projectIds.length ? await Project.find({ _id: mongoose.trusted({ $in: projectIds }) }).select('ref name').lean() : [];
  const projectById = new Map(projects.map((p) => [String(p._id), p]));
  const hoursByProject: HoursByProject[] = (hourFacets[0]?.byProject ?? []).map((p) => ({
    projectId: String(p._id),
    ref: projectById.get(String(p._id))?.ref ?? '',
    name: projectById.get(String(p._id))?.name ?? 'Unknown project',
    minutes: p.minutes,
  }));

  // Hours per person per week: the biggest few people get a series, the rest are "Others".
  const weekIndex = new Map(weeks.map((w, i) => [w.getTime(), i]));
  const byPerson = new Map<string, { id: string; name: string; minutes: number[]; total: number }>();
  for (const row of weeklyHours) {
    const idx = weekIndex.get(row._id.week.getTime());
    if (idx === undefined) continue;
    const id = String(row._id.adminId);
    const person = byPerson.get(id) ?? { id, name: row.name, minutes: Array(WEEKS).fill(0) as number[], total: 0 };
    person.minutes[idx] = (person.minutes[idx] ?? 0) + row.minutes;
    person.total += row.minutes;
    byPerson.set(id, person);
  }
  const ranked = [...byPerson.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const top = ranked.slice(0, MAX_PEOPLE);
  const rest = ranked.slice(MAX_PEOPLE);
  const people = top.map(({ id, name, minutes: m }) => ({ id, name, minutes: m }));
  if (rest.length > 0) people.push({ id: 'others', name: 'Others', minutes: weeks.map((_, i) => rest.reduce((sum, p) => sum + (p.minutes[i] ?? 0), 0)) });

  const estimateVsLogged = allHours
    ? completed
        .filter((t) => (t.estimateMinutes ?? 0) > 0)
        .sort((a, b) => (b.loggedMinutes ?? 0) - (a.loggedMinutes ?? 0))
        .slice(0, 10)
        .map((t) => ({ id: String(t._id), ref: t.ref, title: t.title, estimateMinutes: t.estimateMinutes ?? 0, loggedMinutes: t.loggedMinutes ?? 0 }))
    : null;

  return {
    period: { key: period.key, label: period.label, from: formatDateOnly(period.from), to: formatDateOnly(period.to) },
    openTotal,
    openByStatus,
    overdue: f?.overdue[0]?.n ?? 0,
    unassigned,
    blocked: openByStatus.blocked,
    completedInPeriod: completed.length,
    medianCycleMs: median(cycles),
    cycleSampleSize: cycles.length,
    hours: { scope: hoursScope, minutes, billableMinutes, billableShare: minutes > 0 ? billableMinutes / minutes : null },
    completedPerWeek,
    openPerAssignee,
    hoursPerWeek: { scope: hoursScope, weeks: weeks.map(formatDateOnly), people },
    hoursByProject,
    estimateVsLogged,
  };
}
