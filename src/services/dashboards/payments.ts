import { Types } from 'mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { monthsInPeriod } from '@/lib/dates/ranges';
import { connectToDatabase, mongoose } from '@/lib/db/mongoose';
import { toInrMinor } from '@/lib/money/fx';
import { billableTotalMinor, outstandingMinor } from '@/lib/money/margin';
import { parseObjectId } from '@/lib/validation/common';
import { ClientPayment, FxRate, Project } from '@/models';
import type { SessionUser } from '@/types/session';
import { getSettings } from '@/services/settings.service';
import { resolveInternalClientId, type LedgerRange } from './ledger';

/**
 * The Client payments dashboard (plan section 5, row "Client payments"). Everything is computed from
 * `clientpayments` and the projects' milestones at read time, never invented:
 *
 * - Only `received` entries count; a voided entry is in no figure. Refunds are subtracted.
 * - Money is summed in INR from `amount.inrMinor` and nothing else. Native amounts appear only as a
 *   secondary figure (the by-currency table).
 * - The internal client's receipts are not revenue and are left out, exactly as the ledger does.
 * - The period is the received date. Milestones and outstanding balances are forward-looking, so the
 *   period does not apply to them.
 * - An empty database gives zeros, empty lists and `hasRecords: false`.
 * - Needs payment:view. Everything on this dashboard is money, so a viewer without it gets nothing at
 *   all (FORBIDDEN), never a screen of zeros.
 */

const oid = (id: string) => new Types.ObjectId(parseObjectId(id));
const DAY_MS = 86_400_000;
/** Milestones due within this many days count as "due soon". */
export const DUE_SOON_DAYS = 30;
/** Projects in these statuses owe nothing yet or any more: a proposal is not billed, a cancelled project is not delivered. */
const NOT_BILLABLE = ['proposal', 'cancelled'] as const;

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const monthLabel = (d: Date) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', month: 'short', year: '2-digit' }).format(d);

/** A refund counts against what was received. */
const signedOf = (path: string) => ({ $cond: [{ $eq: ['$type', 'refund'] }, { $multiply: [path, -1] }, path] });

export interface MilestoneTile {
  count: number;
  /** What is still to come in per contract currency (native, a secondary line): amount less what is already received toward each. */
  remaining: Array<{ currency: string; amountMinor: number }>;
}

export interface UpcomingMilestoneRow {
  projectId: string;
  projectRef: string;
  projectName: string;
  clientName: string;
  milestoneId: string;
  title: string;
  /** "YYYY-MM-DD" */
  dueOn: string;
  status: 'pending' | 'invoiced';
  /** In the contract currency. */
  currency: string;
  amountMinor: number;
  /** Received toward this milestone so far, in the contract currency. */
  receivedMinor: number;
  /** Negative: days past due. */
  daysFromToday: number;
  overdue: boolean;
}

export interface OutstandingRow {
  projectId: string;
  projectRef: string;
  projectName: string;
  clientName: string;
  currency: string;
  billableMinor: number;
  receivedMinor: number;
  outstandingMinor: number;
  /** At the latest table rate, or null when that currency has none yet. */
  outstandingInr: number | null;
}

export interface PaymentsDashboard {
  /** Any entry at all for these filters, in any period, void included. False shows the "no payments yet" state. */
  hasRecords: boolean;
  /** Net of refunds, INR, in the period. */
  receivedInr: number;
  receiptsInr: number;
  receipts: number;
  refundsInr: number;
  refunds: number;
  /** TDS deducted by clients on receipts in the period, in INR at each entry's own rate. */
  tdsInr: number;
  dueSoon: MilestoneTile;
  overdue: MilestoneTile;
  /** One entry per month of the period, zero-filled. */
  byMonth: Array<{ month: string; label: string; receivedInr: number }>;
  /** Net native total and INR value per currency, largest INR first. */
  byCurrency: Array<{ currency: string; nativeMinor: number; inrMinor: number }>;
  byMode: Array<{ mode: string; inrMinor: number }>;
  outstanding: {
    /** Largest first, capped at 10. */
    rows: OutstandingRow[];
    /** How many projects have something outstanding (rows may be fewer). */
    projects: number;
    /** The sum of every convertible balance at the latest rates; null when none could be converted. */
    totalInr: number | null;
    /** Currencies with a balance but no rate on file: those balances are left out of the INR total. */
    missingRates: string[];
  };
  /** Overdue first, then the next 30 days, soonest first, capped at 15. */
  upcoming: UpcomingMilestoneRow[];
}

export interface PaymentsDashboardOptions {
  clientId?: string;
  projectId?: string;
  now?: Date;
}

interface Facets {
  totals: Array<{ _id: 'receipt' | 'refund'; n: number; inr: number; tds: number }>;
  byMonth: Array<{ _id: string; inr: number }>;
  byCurrency: Array<{ _id: string; native: number; inr: number }>;
  byMode: Array<{ _id: string; inr: number }>;
}

export async function getPaymentsDashboard(viewer: SessionUser, range: LedgerRange, options: PaymentsDashboardOptions = {}): Promise<PaymentsDashboard> {
  assertCapability(viewer, 'payment:view');
  await connectToDatabase();
  const clientId = options.clientId ? oid(options.clientId) : undefined;
  const projectId = options.projectId ? oid(options.projectId) : undefined;
  const internalClientId = await resolveInternalClientId();
  const { timezone } = await getSettings();
  const today = todayDateOnly(options.now ?? new Date(), timezone);

  // Aggregation stages are not sanitised: every value here is an ObjectId or a Date built from a parsed id.
  const scope: Scope = { clientId, projectId, internalClientId };
  const match: Record<string, unknown> = { status: 'received', receivedOn: { $gte: range.from, $lte: range.to } };
  if (projectId) match.projectId = projectId;
  const client = clientCondition(scope);
  if (client !== undefined) match.clientId = client;

  const [facets] = await ClientPayment.aggregate<Facets>([
    { $match: match },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: '$type',
              n: { $sum: 1 },
              inr: { $sum: '$amount.inrMinor' },
              // TDS is held in the entry's currency: it takes the entry's own INR-per-unit (inrMinor over amountMinor).
              tds: {
                $sum: {
                  $cond: [
                    { $eq: ['$type', 'receipt'] },
                    { $round: [{ $divide: [{ $multiply: [{ $ifNull: ['$tdsMinor', 0] }, '$amount.inrMinor'] }, '$amount.amountMinor'] }, 0] },
                    0,
                  ],
                },
              },
            },
          },
        ],
        byMonth: [{ $group: { _id: { $dateToString: { format: '%Y-%m', date: '$receivedOn' } }, inr: { $sum: signedOf('$amount.inrMinor') } } }],
        byCurrency: [{ $group: { _id: '$amount.currency', native: { $sum: signedOf('$amount.amountMinor') }, inr: { $sum: signedOf('$amount.inrMinor') } } }],
        byMode: [{ $group: { _id: '$mode', inr: { $sum: signedOf('$amount.inrMinor') } } }],
      },
    },
  ]);
  const f: Facets = facets ?? { totals: [], byMonth: [], byCurrency: [], byMode: [] };

  const total = (type: 'receipt' | 'refund') => f.totals.find((t) => t._id === type);
  const receiptsInr = total('receipt')?.inr ?? 0;
  const refundsInr = total('refund')?.inr ?? 0;
  const monthly = new Map(f.byMonth.map((m) => [m._id, m.inr]));

  const [hasRecords, milestones, outstanding] = await Promise.all([
    ClientPayment.exists({ ...(clientId ? { clientId } : {}), ...(projectId ? { projectId } : {}) }).then(Boolean),
    upcomingMilestones({ ...scope, today }),
    outstandingByProject(scope),
  ]);

  return {
    hasRecords,
    receivedInr: receiptsInr - refundsInr,
    receiptsInr,
    receipts: total('receipt')?.n ?? 0,
    refundsInr,
    refunds: total('refund')?.n ?? 0,
    tdsInr: Math.round(total('receipt')?.tds ?? 0),
    dueSoon: milestones.dueSoon,
    overdue: milestones.overdue,
    byMonth: monthsInPeriod(range).map((m) => ({ month: monthKey(m), label: monthLabel(m), receivedInr: monthly.get(monthKey(m)) ?? 0 })),
    byCurrency: f.byCurrency.map((c) => ({ currency: c._id, nativeMinor: c.native, inrMinor: c.inr })).sort((a, b) => b.inrMinor - a.inrMinor || a.currency.localeCompare(b.currency)),
    byMode: f.byMode.map((m) => ({ mode: m._id, inrMinor: m.inr })).sort((a, b) => b.inrMinor - a.inrMinor || a.mode.localeCompare(b.mode)),
    outstanding,
    upcoming: milestones.upcoming,
  };
}

interface Scope {
  clientId?: Types.ObjectId;
  projectId?: Types.ObjectId;
  internalClientId?: string;
}

/**
 * The client condition shared by every query here: the chosen client, else everyone but the internal
 * client (its receipts are not revenue and its projects are never billed). Choosing the internal client
 * itself therefore shows nothing.
 */
function clientCondition(scope: Scope): Types.ObjectId | { $in: never[] } | { $ne: Types.ObjectId } | undefined {
  const internal = scope.internalClientId ? new Types.ObjectId(scope.internalClientId) : undefined;
  if (scope.clientId) return internal && scope.clientId.equals(internal) ? { $in: [] } : scope.clientId;
  return internal ? { $ne: internal } : undefined;
}

/** Projects that can still owe money: not archived, not a proposal or cancelled, not the internal client's. */
function billableProjectFilter(scope: Scope): Record<string, unknown> {
  const filter: Record<string, unknown> = { archivedAt: null, status: mongoose.trusted({ $nin: [...NOT_BILLABLE] }) };
  if (scope.projectId) filter._id = scope.projectId;
  const client = clientCondition(scope);
  if (client !== undefined) filter.clientId = client instanceof Types.ObjectId ? client : mongoose.trusted(client);
  return filter;
}

interface MilestoneRow {
  _id: Types.ObjectId;
  ref: string;
  name: string;
  clientName: string;
  currency: string;
  milestone: { _id: Types.ObjectId; title: string; amountMinor: number; dueOn: Date; status: 'pending' | 'invoiced' };
}

async function upcomingMilestones(scope: Scope & { today: Date }) {
  const horizon = new Date(scope.today.getTime() + DUE_SOON_DAYS * DAY_MS);
  const match: Record<string, unknown> = { archivedAt: null, status: { $nin: [...NOT_BILLABLE] } };
  if (scope.projectId) match._id = scope.projectId;
  const client = clientCondition(scope);
  if (client !== undefined) match.clientId = client;

  const rows = await Project.aggregate<MilestoneRow>([
    { $match: match },
    { $unwind: '$milestones' },
    { $match: { 'milestones.status': { $ne: 'paid' }, 'milestones.dueOn': { $lte: horizon } } },
    { $project: { ref: 1, name: 1, clientName: 1, currency: '$contract.currency', milestone: '$milestones' } },
    { $sort: { 'milestone.dueOn': 1, _id: 1, 'milestone._id': 1 } },
  ]);

  const received = new Map<string, number>();
  if (rows.length > 0) {
    const sums = await ClientPayment.aggregate<{ _id: Types.ObjectId; total: number }>([
      { $match: { status: 'received', milestoneId: { $in: rows.map((r) => r.milestone._id) } } },
      { $group: { _id: '$milestoneId', total: { $sum: signedOf('$contractEquivalentMinor') } } },
    ]);
    for (const s of sums) received.set(String(s._id), s.total);
  }

  const tile = (): { count: number; byCurrency: Map<string, number> } => ({ count: 0, byCurrency: new Map() });
  const soon = tile();
  const late = tile();
  const upcoming: UpcomingMilestoneRow[] = [];
  for (const r of rows) {
    const receivedMinor = received.get(String(r.milestone._id)) ?? 0;
    const daysFromToday = Math.round((r.milestone.dueOn.getTime() - scope.today.getTime()) / DAY_MS);
    const overdue = daysFromToday < 0;
    const bucket = overdue ? late : soon;
    bucket.count += 1;
    const left = Math.max(0, r.milestone.amountMinor - receivedMinor);
    bucket.byCurrency.set(r.currency, (bucket.byCurrency.get(r.currency) ?? 0) + left);
    upcoming.push({
      projectId: String(r._id),
      projectRef: r.ref,
      projectName: r.name,
      clientName: r.clientName,
      milestoneId: String(r.milestone._id),
      title: r.milestone.title,
      dueOn: formatDateOnly(r.milestone.dueOn),
      status: r.milestone.status,
      currency: r.currency,
      amountMinor: r.milestone.amountMinor,
      receivedMinor,
      daysFromToday,
      overdue,
    });
  }
  const remaining = (m: Map<string, number>) =>
    [...m.entries()].filter(([, v]) => v > 0).map(([currency, amountMinor]) => ({ currency, amountMinor })).sort((a, b) => a.currency.localeCompare(b.currency));
  return {
    dueSoon: { count: soon.count, remaining: remaining(soon.byCurrency) } satisfies MilestoneTile,
    overdue: { count: late.count, remaining: remaining(late.byCurrency) } satisfies MilestoneTile,
    upcoming: upcoming.slice(0, 15),
  };
}

async function outstandingByProject(scope: Scope): Promise<PaymentsDashboard['outstanding']> {
  const projects = await Project.find(billableProjectFilter(scope)).select('ref name clientName contract milestones.amountMinor milestones.status').lean();
  const none = { rows: [], projects: 0, totalInr: null, missingRates: [] };
  if (projects.length === 0) return none;

  const sums = await ClientPayment.aggregate<{ _id: Types.ObjectId; total: number }>([
    { $match: { status: 'received', projectId: { $in: projects.map((p) => p._id) } } },
    { $group: { _id: '$projectId', total: { $sum: signedOf('$contractEquivalentMinor') } } },
  ]);
  const received = new Map(sums.map((s) => [String(s._id), s.total]));

  const open = projects.flatMap((p) => {
    const billableMinor = billableTotalMinor(p.contract, p.milestones);
    const receivedMinor = received.get(String(p._id)) ?? 0;
    const left = outstandingMinor(billableMinor, receivedMinor);
    return left > 0 ? [{ p, billableMinor, receivedMinor, left }] : [];
  });
  if (open.length === 0) return none;

  // At the latest table rate, as the Overview does; INR needs none.
  const currencies = [...new Set(open.map((o) => o.p.contract.currency))];
  const rates = new Map<string, number>([['INR', 1]]);
  for (const currency of currencies) {
    if (rates.has(currency)) continue;
    const row = await FxRate.findOne({ currency }).sort({ rateOn: -1 }).select('rate').lean();
    if (row) rates.set(currency, row.rate);
  }
  const rows: OutstandingRow[] = open.map(({ p, billableMinor, receivedMinor, left }) => {
    const rate = rates.get(p.contract.currency);
    return {
      projectId: String(p._id),
      projectRef: p.ref,
      projectName: p.name,
      clientName: p.clientName,
      currency: p.contract.currency,
      billableMinor,
      receivedMinor,
      outstandingMinor: left,
      outstandingInr: rate === undefined ? null : toInrMinor(left, p.contract.currency, rate),
    };
  });
  rows.sort((a, b) => (b.outstandingInr ?? -1) - (a.outstandingInr ?? -1) || b.outstandingMinor - a.outstandingMinor || a.projectName.localeCompare(b.projectName));
  const convertible = rows.filter((r) => r.outstandingInr !== null);
  return {
    rows: rows.slice(0, 10),
    projects: rows.length,
    totalInr: convertible.length > 0 ? convertible.reduce((s, r) => s + (r.outstandingInr ?? 0), 0) : null,
    missingRates: currencies.filter((c) => !rates.has(c)).sort(),
  };
}
