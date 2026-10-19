import { Types } from 'mongoose';
import { connectToDatabase, mongoose } from '@/lib/db/mongoose';
import { forbidden, notFound } from '@/lib/api/errors';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { startOfDayInstant, type Period } from '@/lib/dates/ranges';
import { parseObjectId } from '@/lib/validation/common';
import { Admin, Expense, Project, Task, TeamPayout, WorkLog } from '@/models';
import type { SessionUser } from '@/types/session';
import { getActivity, type ActivityEntry } from '@/services/activity.service';
import { getSettings } from '@/services/settings.service';
import { CLOSED_STATUSES } from '@/services/task.service';
import { median, weekStarts, WEEKS, type HoursByProject } from './tasks';

/**
 * One person's dashboard (plan section 6): hours, tasks, pay and recent activity. The same
 * component renders it on My work (`/admin/my`) and on a team member's page.
 *
 * Who may open it: the person themself, or someone who may read other people's audit trail
 * (`audit:viewAll`, which only superadmins hold, and which is what the "recent activity" list
 * on this dashboard is made of). Pay figures need the person themself or `team:payView`.
 * Everything is computed from records; the pay sections read the payout and expense collections
 * directly and are simply zero when those are empty.
 */
export interface PersonDashboard {
  person: { id: string; name: string; designation: string | null; active: boolean; lastLoginAt: string | null };
  period: { key: string; label: string; from: string; to: string };
  hours: { thisWeekMinutes: number; thisMonthMinutes: number; periodMinutes: number; periodBillableMinutes: number };
  /** The last 12 weeks, oldest first. `weekStart` is the Monday, "YYYY-MM-DD". */
  hoursPerWeek: Array<{ weekStart: string; minutes: number }>;
  hoursByProject: HoursByProject[];
  tasks: {
    open: number;
    overdue: number;
    completedInPeriod: number;
    /** Completed in the period with a due date, and how many of those were on or before it. */
    withDueDate: number;
    onTime: number;
    /** Only when at least one completed task had a due date. */
    onTimePercent: number | null;
    medianCycleMs: number | null;
    cycleSampleSize: number;
  };
  /** `null` unless the viewer is this person or holds `team:payView`. */
  pay: {
    paidInPeriodInrMinor: number;
    paidInPeriodCount: number;
    /** What was paid, by currency, in the currency it was paid in. */
    paidInPeriodNative: Array<{ currency: string; amountMinor: number; inrMinor: number }>;
    dueCount: number;
    dueInrMinor: number;
    reimbursements: { owedCount: number; owedInrMinor: number; awaitingApprovalCount: number; awaitingApprovalInrMinor: number };
  } | null;
  recentActivity: ActivityEntry[];
}

const oid = (id: string) => new Types.ObjectId(id);

export async function getPersonDashboard(viewer: SessionUser, adminId: string, period: Period, now = new Date()): Promise<PersonDashboard> {
  const id = parseObjectId(adminId);
  const self = viewer.id.toLowerCase() === id;
  if (!self && !viewer.capabilities.has('audit:viewAll')) throw forbidden('You can only see your own dashboard');
  await connectToDatabase();

  const person = await Admin.findById(id).select('name status lastLoginAt profile.designation').lean();
  if (!person) throw notFound('We could not find that person');
  const me = oid(id);
  const showPay = self || viewer.capabilities.has('team:payView');

  const settings = await getSettings();
  const tz = settings.timezone;
  const today = todayDateOnly(now, tz);
  const weeks = weekStarts(WEEKS, today);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const thisWeek = weeks[weeks.length - 1] ?? today;
  const lastDayOfWeeks = new Date((weeks.at(-1)?.getTime() ?? today.getTime()) + 6 * 86_400_000);

  const [logs, weekly, taskFacets, payouts, reimbursements, recentActivity] = await Promise.all([
    WorkLog.aggregate<{ week: Array<{ minutes: number }>; month: Array<{ minutes: number }>; period: Array<{ minutes: number; billableMinutes: number }>; byProject: Array<{ _id: Types.ObjectId; minutes: number }> }>([
      { $match: { adminId: me, workedOn: { $gte: new Date(Math.min(monthStart.getTime(), thisWeek.getTime(), period.from.getTime())), $lte: new Date(Math.max(today.getTime(), period.to.getTime())) } } },
      {
        $facet: {
          week: [{ $match: { workedOn: { $gte: thisWeek, $lte: today } } }, { $group: { _id: null, minutes: { $sum: '$minutes' } } }],
          month: [{ $match: { workedOn: { $gte: monthStart, $lte: today } } }, { $group: { _id: null, minutes: { $sum: '$minutes' } } }],
          period: [
            { $match: { workedOn: { $gte: period.from, $lte: period.to } } },
            { $group: { _id: null, minutes: { $sum: '$minutes' }, billableMinutes: { $sum: { $cond: ['$billable', '$minutes', 0] } } } },
          ],
          byProject: [
            { $match: { workedOn: { $gte: period.from, $lte: period.to } } },
            { $group: { _id: '$projectId', minutes: { $sum: '$minutes' } } },
            { $sort: { minutes: -1, _id: 1 } },
            { $limit: 10 },
          ],
        },
      },
    ]),
    WorkLog.aggregate<{ _id: Date; minutes: number }>([
      { $match: { adminId: me, workedOn: { $gte: weeks[0], $lte: lastDayOfWeeks } } },
      { $group: { _id: { $dateTrunc: { date: '$workedOn', unit: 'week', startOfWeek: 'monday' } }, minutes: { $sum: '$minutes' } } },
    ]),
    Task.aggregate<{
      open: Array<{ n: number }>;
      overdue: Array<{ n: number }>;
      completed: Array<{ startedAt?: Date; completedAt: Date; dueOn?: Date }>;
    }>([
      { $match: { assignees: { $elemMatch: { kind: 'admin', id: me } } } },
      {
        $facet: {
          open: [{ $match: { archivedAt: null, status: { $nin: [...CLOSED_STATUSES] } } }, { $count: 'n' }],
          overdue: [{ $match: { archivedAt: null, status: { $nin: [...CLOSED_STATUSES] }, dueOn: { $lt: today } } }, { $count: 'n' }],
          completed: [
            { $match: { status: 'done', completedAt: { $gte: period.fromInstant, $lt: period.toInstant } } },
            { $project: { startedAt: 1, completedAt: 1, dueOn: 1 } },
            { $limit: 5000 },
          ],
        },
      },
    ]),
    showPay
      ? TeamPayout.aggregate<{ paid: Array<{ _id: string; amountMinor: number; inrMinor: number; n: number }>; due: Array<{ inrMinor: number; n: number }> }>([
          { $match: { adminId: me, status: { $in: ['paid', 'due'] } } },
          {
            $facet: {
              paid: [
                { $match: { status: 'paid', paidOn: { $gte: period.from, $lte: period.to } } },
                { $group: { _id: '$amount.currency', amountMinor: { $sum: '$amount.amountMinor' }, inrMinor: { $sum: '$amount.inrMinor' }, n: { $sum: 1 } } },
                { $sort: { _id: 1 } },
              ],
              due: [{ $match: { status: 'due' } }, { $group: { _id: null, inrMinor: { $sum: '$amount.inrMinor' }, n: { $sum: 1 } } }],
            },
          },
        ])
      : Promise.resolve(null),
    showPay
      ? Expense.aggregate<{ _id: string; inrMinor: number; n: number }>([
          { $match: { paidFrom: 'admin', 'paidByAdmin.id': me, status: { $in: ['submitted', 'approved'] } } },
          { $group: { _id: '$status', inrMinor: { $sum: '$amount.inrMinor' }, n: { $sum: 1 } } },
        ])
      : Promise.resolve(null),
    getActivity({ actorId: id }, { limit: 20 }),
  ]);

  // Hours by project: names from the projects themselves.
  const logFacet = logs[0];
  const projectIds = (logFacet?.byProject ?? []).map((p) => p._id);
  const projects = projectIds.length ? await Project.find({ _id: mongoose.trusted({ $in: projectIds }) }).select('ref name').lean() : [];
  const projectById = new Map(projects.map((p) => [String(p._id), p]));

  const weeklyMap = new Map(weekly.map((w) => [w._id.getTime(), w.minutes]));

  // Tasks.
  const tf = taskFacets[0];
  const completed = tf?.completed ?? [];
  const cycles = completed.flatMap((t) => (t.startedAt ? [Math.max(0, t.completedAt.getTime() - t.startedAt.getTime())] : []));
  // On time = completed on or before the due DATE, judged in the organisation's zone (dueOn is a calendar date, completedAt an instant).
  const dated = completed.filter((t) => t.dueOn);
  const onTime = dated.filter((t) => t.completedAt.getTime() < startOfDayInstant(new Date((t.dueOn as Date).getTime() + 86_400_000), tz).getTime()).length;

  const pay = showPay
    ? (() => {
        const paid = payouts?.[0]?.paid ?? [];
        const due = payouts?.[0]?.due[0];
        const owed = reimbursements?.find((r) => r._id === 'approved');
        const waiting = reimbursements?.find((r) => r._id === 'submitted');
        return {
          paidInPeriodInrMinor: paid.reduce((s, p) => s + p.inrMinor, 0),
          paidInPeriodCount: paid.reduce((s, p) => s + p.n, 0),
          paidInPeriodNative: paid.map((p) => ({ currency: p._id, amountMinor: p.amountMinor, inrMinor: p.inrMinor })),
          dueCount: due?.n ?? 0,
          dueInrMinor: due?.inrMinor ?? 0,
          reimbursements: {
            owedCount: owed?.n ?? 0,
            owedInrMinor: owed?.inrMinor ?? 0,
            awaitingApprovalCount: waiting?.n ?? 0,
            awaitingApprovalInrMinor: waiting?.inrMinor ?? 0,
          },
        };
      })()
    : null;

  return {
    person: {
      id,
      name: person.name,
      designation: person.profile?.designation ?? null,
      active: person.status === 'active',
      lastLoginAt: person.lastLoginAt ? person.lastLoginAt.toISOString() : null,
    },
    period: { key: period.key, label: period.label, from: formatDateOnly(period.from), to: formatDateOnly(period.to) },
    hours: {
      thisWeekMinutes: logFacet?.week[0]?.minutes ?? 0,
      thisMonthMinutes: logFacet?.month[0]?.minutes ?? 0,
      periodMinutes: logFacet?.period[0]?.minutes ?? 0,
      periodBillableMinutes: logFacet?.period[0]?.billableMinutes ?? 0,
    },
    hoursPerWeek: weeks.map((w) => ({ weekStart: formatDateOnly(w), minutes: weeklyMap.get(w.getTime()) ?? 0 })),
    hoursByProject: (logFacet?.byProject ?? []).map((p) => ({
      projectId: String(p._id),
      ref: projectById.get(String(p._id))?.ref ?? '',
      name: projectById.get(String(p._id))?.name ?? 'Unknown project',
      minutes: p.minutes,
    })),
    tasks: {
      open: tf?.open[0]?.n ?? 0,
      overdue: tf?.overdue[0]?.n ?? 0,
      completedInPeriod: completed.length,
      withDueDate: dated.length,
      onTime,
      onTimePercent: dated.length > 0 ? Math.round((onTime / dated.length) * 100) : null,
      medianCycleMs: median(cycles),
      cycleSampleSize: cycles.length,
    },
    pay,
    recentActivity,
  };
}
