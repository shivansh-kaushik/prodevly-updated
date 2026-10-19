import type { PipelineStage, Types } from 'mongoose';
import { connectToDatabase, mongoose } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import type { LeadStatus } from '@/config/statuses';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import type { Period } from '@/lib/dates/ranges';
import { FUNNEL_STAGES, OPEN_LEAD_STATUSES, type OpenLeadStatus } from '@/lib/validation/lead';
import { Lead, Service } from '@/models';
import type { SessionUser } from '@/types/session';
import { getSettings } from '@/services/settings.service';

/**
 * The Enquiries dashboard (plan section 5). Every figure is counted or measured from enquiry
 * records, so there is nothing to invent, and nothing here is money.
 *
 * Two kinds of figure, kept apart on purpose:
 * - A COHORT is the enquiries RECEIVED in the chosen period (created in it). The charts, "new in the
 *   period", the first-reply time and the conversion rate are cohorts, so changing the period
 *   changes them.
 * - A SNAPSHOT is the state right now, whatever the period: "open now" and "follow-ups due".
 *
 * Spam is not an enquiry: it is left out of every cohort figure and only counted on its own.
 * Ratios appear only when their denominator is above zero. Aggregation pipelines are not sanitised,
 * so every `$match` below is built from parsed values (dates and constants), never from request text.
 */

export interface CountRow {
  label: string;
  count: number;
}

export interface EnquiriesDashboard {
  /** The range the cohort figures cover, as calendar dates. */
  period: { from: string; to: string };
  /** Received in the period, spam excluded. */
  newInPeriod: number;
  /** Received in the period and held as spam. */
  spamInPeriod: number;
  /** Snapshot: enquiries still being worked, with each open status (zero-filled). */
  open: { total: number; byStatus: Array<{ status: OpenLeadStatus; count: number }> };
  /** Snapshot: open enquiries nobody has moved off "new" yet. */
  waitingForFirstReply: number;
  /** Time from receipt to the first move away from "new", for enquiries received in the period that have one. */
  firstReply: { medianMinutes: number | null; replied: number };
  /** Won divided by won plus lost, for enquiries received in the period. `rate` is null until one is decided. */
  conversion: { won: number; lost: number; rate: number | null };
  /** Snapshot: open enquiries whose follow-up date is today or earlier. */
  followUpsDue: number;
  /** One row per calendar week (Monday start) from the period's first week to today, zero-filled. */
  perWeek: Array<{ weekStart: string; label: string; count: number }>;
  /** How far enquiries got: each stage counts the ones that are, or ever were, at or past it. */
  funnel: Array<{ stage: LeadStatus; label: string; count: number }>;
  /** An enquiry that ticked several services counts under each, so these can add up to more than `newInPeriod`. */
  byService: CountRow[];
  byBudget: CountRow[];
  bySourcePath: CountRow[];
  byUtmSource: CountRow[];
}

const DAY = 86_400_000;
const TOP = 8;
const MAX_WEEKS = 600;
const STAGE_LABELS: Record<(typeof FUNNEL_STAGES)[number], string> = {
  new: 'Received',
  contacted: 'Contacted',
  qualified: 'Qualified',
  proposal_sent: 'Proposal sent',
  won: 'Won',
};

type Counted<K> = Array<{ _id: K; n: number }>;

interface FacetResult {
  statuses: Counted<LeadStatus>;
  open: Counted<LeadStatus>;
  followUps: Array<{ n: number }>;
  replies: Array<{ ms: number }>;
  weeks: Counted<Date>;
  ranks: Counted<number>;
  services: Counted<Types.ObjectId | null>;
  budgets: Counted<string | null>;
  paths: Counted<string | null>;
  utm: Counted<string | null>;
}

/** Median of an ascending list. Null for an empty one. */
export function medianOf(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** The Monday of every week from the one containing `from` through `to`, as YYYY-MM-DD. Dates are calendar dates (UTC midnight). */
export function weekStarts(from: Date, to: Date): string[] {
  const out: string[] = [];
  let cursor = new Date(from.getTime() - ((from.getUTCDay() + 6) % 7) * DAY);
  while (cursor.getTime() <= to.getTime() && out.length < MAX_WEEKS) {
    out.push(formatDateOnly(cursor));
    cursor = new Date(cursor.getTime() + 7 * DAY);
  }
  return out;
}

const dayInZone = (instant: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);

/** Biggest first, the rest folded into one "Other" row so a long tail cannot swamp a chart. */
function topWithOther(rows: CountRow[], limit = TOP): CountRow[] {
  const sorted = [...rows].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  if (sorted.length <= limit) return sorted;
  const rest = sorted.slice(limit).reduce((sum, r) => sum + r.count, 0);
  return [...sorted.slice(0, limit), { label: 'Other', count: rest }];
}

/** Rows for a plain group-by: a missing value gets its own readable label. */
const labelled = (rows: Counted<string | null>, missing: string): CountRow[] => {
  const merged = new Map<string, number>();
  for (const r of rows) merged.set(r._id ?? missing, (merged.get(r._id ?? missing) ?? 0) + r.n);
  return [...merged].map(([label, count]) => ({ label, count }));
};

export async function getEnquiriesDashboard(
  viewer: SessionUser,
  period: Pick<Period, 'from' | 'to' | 'fromInstant' | 'toInstant'>,
  options: { now?: Date; timeZone?: string } = {},
): Promise<EnquiriesDashboard> {
  assertCapability(viewer, 'lead:view');
  await connectToDatabase();
  const now = options.now ?? new Date();
  const settings = await getSettings();
  const timeZone = options.timeZone ?? settings.timezone;
  const today = todayDateOnly(now, timeZone);

  const received = { createdAt: { $gte: period.fromInstant, $lt: period.toInstant } };
  const cohort = { ...received, status: { $ne: 'spam' } };
  const open = { status: { $in: [...OPEN_LEAD_STATUSES] } };
  const stages = [...FUNNEL_STAGES];
  const groupBy = (field: string): PipelineStage.FacetPipelineStage[] => [
    { $match: cohort },
    { $group: { _id: field, n: { $sum: 1 } } },
  ];

  const facets: Record<keyof FacetResult, PipelineStage.FacetPipelineStage[]> = {
    statuses: [{ $match: received }, { $group: { _id: '$status', n: { $sum: 1 } } }],
    open: [{ $match: open }, { $group: { _id: '$status', n: { $sum: 1 } } }],
    followUps: [{ $match: { ...open, followUpOn: { $lte: today } } }, { $count: 'n' }],
    replies: [
      { $match: { ...cohort, firstResponseAt: { $type: 'date' } } },
      { $project: { _id: 0, ms: { $subtract: ['$firstResponseAt', '$createdAt'] } } },
      { $sort: { ms: 1 } },
    ],
    weeks: [
      { $match: cohort },
      { $group: { _id: { $dateTrunc: { date: '$createdAt', unit: 'week', startOfWeek: 'monday', timezone: timeZone } }, n: { $sum: 1 } } },
    ],
    // The furthest funnel stage each enquiry ever reached: its current status and every status in its history.
    ranks: [
      { $match: cohort },
      {
        $addFields: {
          rank: {
            $max: {
              $concatArrays: [
                [{ $indexOfArray: [stages, '$status'] }],
                { $map: { input: { $ifNull: ['$statusHistory', []] }, as: 'h', in: { $indexOfArray: [stages, '$$h.to'] } } },
              ],
            },
          },
        },
      },
      { $group: { _id: '$rank', n: { $sum: 1 } } },
    ],
    services: [
      { $match: cohort },
      { $unwind: { path: '$serviceIds', preserveNullAndEmptyArrays: true } },
      { $group: { _id: '$serviceIds', n: { $sum: 1 } } },
    ],
    budgets: groupBy('$budgetRange'),
    paths: groupBy('$sourcePath'),
    utm: groupBy('$utm.source'),
  };

  const [facet] = await Lead.aggregate<FacetResult>([{ $facet: facets }]);
  const f: FacetResult = facet ?? { statuses: [], open: [], followUps: [], replies: [], weeks: [], ranks: [], services: [], budgets: [], paths: [], utm: [] };

  // Cohort counts.
  const inPeriod = (status: LeadStatus) => f.statuses.find((s) => s._id === status)?.n ?? 0;
  const spamInPeriod = inPeriod('spam');
  const newInPeriod = f.statuses.reduce((sum, s) => (s._id === 'spam' ? sum : sum + s.n), 0);
  const won = inPeriod('won');
  const lost = inPeriod('lost');

  // Snapshot counts.
  const byStatus = OPEN_LEAD_STATUSES.map((status) => ({ status, count: f.open.find((o) => o._id === status)?.n ?? 0 }));

  const medianMs = medianOf(f.replies.map((r) => r.ms));

  // Funnel: stage i counts every enquiry whose furthest stage is i or later. "Received" is everyone, since an
  // enquiry that went straight to lost never reached any stage but still arrived.
  const funnel = FUNNEL_STAGES.map((stage, i) => ({
    stage,
    label: STAGE_LABELS[stage],
    count: i === 0 ? newInPeriod : f.ranks.reduce((sum, r) => (r._id >= i ? sum + r.n : sum), 0),
  }));

  // Weeks, zero-filled from the week the period starts in up to today (or the period's end if that is earlier).
  const lastDay = new Date(Math.min(period.to.getTime(), today.getTime()));
  const starts = weekStarts(period.from, lastDay);
  const perWeekCounts = new Map(f.weeks.map((w) => [dayInZone(w._id, timeZone), w.n]));
  const longRange = starts.length > 53;
  const perWeek = starts.map((weekStart) => ({
    weekStart,
    label: new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', ...(longRange ? { year: '2-digit' as const } : {}) }).format(new Date(weekStart)),
    count: perWeekCounts.get(weekStart) ?? 0,
  }));

  // Service interest: titles are looked up whatever each service's status is now.
  const serviceIds = f.services.flatMap((s) => (s._id ? [s._id] : []));
  const titles = new Map(
    serviceIds.length
      ? (await Service.find({ _id: mongoose.trusted({ $in: serviceIds }) }).select('title').lean()).map((s) => [String(s._id), s.title] as const)
      : [],
  );
  const byService = topWithOther(
    f.services.map((s) => ({ label: s._id ? (titles.get(String(s._id)) ?? 'Removed service') : 'No service chosen', count: s.n })),
  );

  // Budget ranges keep the order the team configured them in; anything else (a removed range, none given) follows.
  const budgetRows = labelled(f.budgets, 'Not given');
  const order = new Map(settings.budgetRanges.map((r, i) => [r, i]));
  const byBudget = budgetRows.sort((a, b) => {
    const ai = order.get(a.label);
    const bi = order.get(b.label);
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    return b.count - a.count || a.label.localeCompare(b.label);
  });

  const decided = won + lost;
  return {
    period: { from: formatDateOnly(period.from), to: formatDateOnly(period.to) },
    newInPeriod,
    spamInPeriod,
    open: { total: byStatus.reduce((sum, s) => sum + s.count, 0), byStatus },
    waitingForFirstReply: byStatus.find((s) => s.status === 'new')?.count ?? 0,
    firstReply: { medianMinutes: medianMs === null ? null : medianMs / 60_000, replied: f.replies.length },
    conversion: { won, lost, rate: decided > 0 ? won / decided : null },
    followUpsDue: f.followUps[0]?.n ?? 0,
    perWeek,
    funnel,
    byService,
    byBudget,
    bySourcePath: topWithOther(labelled(f.paths, 'Unknown')),
    byUtmSource: topWithOther(labelled(f.utm, 'Direct or untagged')),
  };
}
