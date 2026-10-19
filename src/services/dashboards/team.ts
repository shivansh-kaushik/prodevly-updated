import type { Types } from 'mongoose';
import { connectToDatabase, mongoose } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { monthsInPeriod } from '@/lib/dates/ranges';
import { Admin, TeamPayout, TeamRole } from '@/models';
import type { SessionUser } from '@/types/session';
import { getSettings } from '@/services/settings.service';
import { capacityMinutes, loadWorkload, utilisationOf, type DateRange } from '@/services/team.service';

/** How many people a per-person chart lists. A studio team is smaller; this only bounds a runaway. */
const TOP = 15;

export interface TeamPayoutsDashboard {
  /** Paid with a paid-on date in the period, void excluded, summed from `amount.inrMinor`. */
  paidInrMinor: number;
  paidCount: number;
  /** Paid in another currency, as the secondary line under the INR figure. */
  paidNative: Array<{ currency: string; amountMinor: number; inrMinor: number }>;
  /** Open (status due) payouts, whatever the period: what is owed right now. */
  dueInrMinor: number;
  dueCount: number;
  /** Of the due payouts, how many have a due date that has passed. */
  overdueCount: number;
  byPerson: Array<{ id: string; name: string; inrMinor: number }>;
  /** Every month of the period, zero-filled. `month` is "YYYY-MM". */
  byMonth: Array<{ month: string; inrMinor: number }>;
}

export interface TeamDashboard {
  /** The range the figures cover, echoed back as calendar dates. */
  period: { from: string; to: string };
  activeMembers: number;
  removedMembers: number;
  /** Active people by job role, biggest first; people without one are the last row. */
  membersByRole: Array<{ id: string | null; name: string; count: number; archived: boolean }>;
  /** Minutes logged in the period by everyone, removed accounts included. */
  loggedMinutes: number;
  hoursByPerson: Array<{ id: string; name: string; minutes: number }>;
  /** Open tasks assigned to each person with any. */
  openTasksByPerson: Array<{ id: string; name: string; open: number; overdue: number; removed: boolean }>;
  utilisation: {
    /** Null unless at least one active person has a weekly capacity and some of the period has passed. */
    percent: number | null;
    loggedMinutes: number;
    capacityMinutes: number;
    /** Active people with a weekly capacity set. */
    members: number;
  };
  /** Null for a viewer without `team:payView`: payout tiles and charts are left out, never zero. */
  payouts: TeamPayoutsDashboard | null;
}

const byCountThenName = (a: { count: number; name: string }, b: { count: number; name: string }) =>
  b.count - a.count || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

async function loadPayouts(range: DateRange, today: Date): Promise<TeamPayoutsDashboard> {
  const [paid, due] = await Promise.all([
    TeamPayout.aggregate<{
      total: Array<{ inr: number; n: number }>;
      native: Array<{ _id: string; amount: number; inr: number }>;
      people: Array<{ _id: Types.ObjectId; inr: number; name: string }>;
      months: Array<{ _id: string; inr: number }>;
    }>([
      { $match: { status: 'paid', paidOn: { $gte: range.from, $lte: range.to } } },
      { $sort: { paidOn: 1 } },
      {
        $facet: {
          total: [{ $group: { _id: null, inr: { $sum: '$amount.inrMinor' }, n: { $sum: 1 } } }],
          native: [
            { $match: { 'amount.currency': { $ne: 'INR' } } },
            { $group: { _id: '$amount.currency', amount: { $sum: '$amount.amountMinor' }, inr: { $sum: '$amount.inrMinor' } } },
            { $sort: { _id: 1 } },
          ],
          // `$last` after the sort above: the name on the person's most recent payout.
          people: [
            { $group: { _id: '$adminId', inr: { $sum: '$amount.inrMinor' }, name: { $last: '$adminName' } } },
            { $sort: { inr: -1, name: 1 } },
            { $limit: TOP },
          ],
          // paidOn is a date-only value at UTC midnight, so months are bucketed in UTC.
          months: [{ $group: { _id: { $dateToString: { format: '%Y-%m', date: '$paidOn', timezone: 'UTC' } }, inr: { $sum: '$amount.inrMinor' } } }],
        },
      },
    ]),
    TeamPayout.aggregate<{ inr: number; n: number; overdue: number }>([
      { $match: { status: 'due' } },
      {
        $group: {
          _id: null,
          inr: { $sum: '$amount.inrMinor' },
          n: { $sum: 1 },
          overdue: { $sum: { $cond: [{ $and: [{ $eq: [{ $type: '$dueOn' }, 'date'] }, { $lt: ['$dueOn', today] }] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const facet = paid[0];
  const monthTotals = new Map((facet?.months ?? []).map((m) => [m._id, m.inr]));
  return {
    paidInrMinor: facet?.total[0]?.inr ?? 0,
    paidCount: facet?.total[0]?.n ?? 0,
    paidNative: (facet?.native ?? []).map((n) => ({ currency: n._id, amountMinor: n.amount, inrMinor: n.inr })),
    dueInrMinor: due[0]?.inr ?? 0,
    dueCount: due[0]?.n ?? 0,
    overdueCount: due[0]?.overdue ?? 0,
    byPerson: (facet?.people ?? []).map((p) => ({ id: String(p._id), name: p.name, inrMinor: p.inr })),
    byMonth: monthsInPeriod(range).map((m) => {
      const month = formatDateOnly(m).slice(0, 7);
      return { month, inrMinor: monthTotals.get(month) ?? 0 };
    }),
  };
}

/**
 * The Team and roles dashboard (plan section 5). Every figure comes from records: admins, tasks, work logs
 * and team payouts. Payout figures sum `amount.inrMinor` of PAID payouts by their paid-on date (void is
 * excluded by status); "due" is every open payout, not just those due inside the period, because it is what
 * is owed now. Payouts are read only with `team:payView`.
 */
export async function getTeamDashboard(viewer: SessionUser, range: DateRange, now = new Date()): Promise<TeamDashboard> {
  assertCapability(viewer, 'team:view');
  await connectToDatabase();

  const { timezone } = await getSettings();
  const today = todayDateOnly(now, timezone);
  const canSeePayouts = viewer.capabilities.has('team:payView');

  const [active, removed, byRole, roles, capacityRows, workload, names, payouts] = await Promise.all([
    Admin.countDocuments({ status: 'active' }),
    Admin.countDocuments({ status: 'deactivated' }),
    Admin.aggregate<{ _id: Types.ObjectId | null; n: number }>([
      { $match: { status: 'active' } },
      { $group: { _id: { $ifNull: ['$profile.jobRoleId', null] }, n: { $sum: 1 } } },
    ]),
    TeamRole.find({}).select('name archivedAt').lean(),
    Admin.find({ status: 'active', 'profile.weeklyCapacityHours': mongoose.trusted({ $gt: 0 }) })
      .select('profile.weeklyCapacityHours profile.joinedOn')
      .lean(),
    loadWorkload(range, today),
    Admin.find({}).select('name status').lean(),
    canSeePayouts ? loadPayouts(range, today) : Promise.resolve(null),
  ]);

  const roleMap = new Map(roles.map((r) => [String(r._id), r]));
  const nameOf = new Map(names.map((n) => [String(n._id), n]));

  // Members by job role. A role that was deleted after being assigned counts as "no job role".
  let unassigned = 0;
  const membersByRole: TeamDashboard['membersByRole'] = [];
  for (const row of byRole) {
    const role = row._id ? roleMap.get(String(row._id)) : undefined;
    if (role) membersByRole.push({ id: String(role._id), name: role.name, count: row.n, archived: Boolean(role.archivedAt) });
    else unassigned += row.n;
  }
  membersByRole.sort(byCountThenName);
  if (unassigned > 0) membersByRole.push({ id: null, name: 'No job role', count: unassigned, archived: false });

  // Names come from the account (a rename shows at once); the log's own snapshot covers an account that no longer resolves.
  const hoursByPerson = [...workload.minutes]
    .map(([id, v]) => ({ id, name: nameOf.get(id)?.name ?? v.name, minutes: v.minutes }))
    .filter((p) => p.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const loggedMinutes = hoursByPerson.reduce((sum, p) => sum + p.minutes, 0);

  const openTasksByPerson = [...workload.tasks]
    .map(([id, t]) => ({ id, name: nameOf.get(id)?.name ?? 'Unknown person', open: t.open, overdue: t.overdue, removed: nameOf.get(id)?.status === 'deactivated' }))
    .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  // Utilisation: the logged time of the people who have a capacity, over their combined capacity so far.
  let capacity = 0;
  let loggedForCapacity = 0;
  for (const row of capacityRows) {
    capacity += capacityMinutes(row.profile?.weeklyCapacityHours ?? 0, range, today, row.profile?.joinedOn);
    loggedForCapacity += workload.minutes.get(String(row._id))?.minutes ?? 0;
  }

  return {
    period: { from: formatDateOnly(range.from), to: formatDateOnly(range.to) },
    activeMembers: active,
    removedMembers: removed,
    membersByRole,
    loggedMinutes,
    hoursByPerson: hoursByPerson.slice(0, TOP),
    openTasksByPerson: openTasksByPerson.slice(0, TOP),
    utilisation: { percent: utilisationOf(loggedForCapacity, capacity), loggedMinutes: loggedForCapacity, capacityMinutes: capacity, members: capacityRows.length },
    payouts,
  };
}
