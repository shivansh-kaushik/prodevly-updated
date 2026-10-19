import { Types } from 'mongoose';
import { mongoose, connectToDatabase } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { monthsInPeriod } from '@/lib/dates/ranges';
import { toInrMinor } from '@/lib/money/fx';
import { Project, ThirdParty, ThirdPartyPayout, WorkOrder, type WorkOrderDoc } from '@/models';
import type { SessionUser } from '@/types/session';
import { lookupRate } from '@/services/fx.service';
import { getSettings } from '@/services/settings.service';
import { loadLinkBriefs, type WorkOrderListItemDTO } from '@/services/work-order.service';
import type { LedgerRange } from './ledger';

/**
 * The Third parties section's numbers (plan section 5, row "Third parties and payouts"). Everything is
 * computed from records at read time. Payout figures sum `amount.inrMinor` over PAID payouts by their paid
 * date; void payouts are never counted, and a payout that is only due is "due", not "paid". Everything
 * about payouts and work orders is left out entirely (`money` is null, never zeros) for a viewer without
 * `payout:view`; the active-third-party count and the type split need only `thirdParty:view`.
 *
 * Work orders are "open" while their status is open or delivered. Their balance is agreed less paid less
 * due (what is still to be recorded as a payout, so it never counts a due payout twice), in the work
 * order's own currency, shown in INR at the latest table rate. A currency with no table rate is listed in
 * `missingRates` and left out of the INR total, which is then not shown as a complete figure.
 */

export interface PaidByCurrency {
  currency: string;
  nativeMinor: number;
  inrMinor: number;
}

export interface OpenWorkOrderRow extends Pick<WorkOrderListItemDTO, 'id' | 'ref' | 'title' | 'thirdPartyId' | 'thirdPartyName' | 'projectId' | 'projectRef' | 'projectName' | 'agreed' | 'paidMinor' | 'dueMinor' | 'balanceMinor' | 'dueOn' | 'overdue' | 'status'> {
  /** The balance at the latest table rate, or null when the currency has none. */
  balanceInr: number | null;
}

export interface ThirdPartiesMoney {
  paid: { inr: number; count: number; byCurrency: PaidByCurrency[] };
  due: { inr: number; count: number; overdueInr: number; overdueCount: number };
  /** One entry per month of the period, zero-filled, oldest first. */
  perMonth: Array<{ month: string; label: string; paidInr: number }>;
  /** Largest first, at most 10. */
  byThirdParty: Array<{ id: string; name: string; paidInr: number }>;
  byProject: Array<{ id: string; ref: string; name: string; paidInr: number }>;
  byType: Array<{ type: string; paidInr: number }>;
  openWorkOrders: {
    count: number;
    /** Total balance in INR over the currencies that have a rate; null when none of the open balance could be converted yet some exists. */
    balanceInr: number | null;
    byCurrency: Array<{ currency: string; balanceMinor: number; balanceInr: number | null }>;
    missingRates: string[];
    /** Largest balance first, at most 25. */
    rows: OpenWorkOrderRow[];
  };
}

export interface ThirdPartiesDashboard {
  /** Active and not archived. */
  activeThirdParties: number;
  /** The same third parties by type, largest first. */
  typeCounts: Array<{ type: string; count: number }>;
  /** Only with `payout:view`. */
  money: ThirdPartiesMoney | null;
}

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const monthLabel = (d: Date) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', month: 'short', year: '2-digit' }).format(d);
const TOP = 10;
const ROWS = 25;

interface PaidFacets {
  total: Array<{ inr: number; n: number }>;
  perMonth: Array<{ _id: string; inr: number }>;
  byThirdParty: Array<{ _id: Types.ObjectId; inr: number }>;
  byProject: Array<{ _id: Types.ObjectId; inr: number }>;
  byCurrency: Array<{ _id: string; native: number; inr: number }>;
}

interface DueFacets {
  total: Array<{ inr: number; n: number }>;
  overdue: Array<{ inr: number; n: number }>;
}

export async function getThirdPartiesDashboard(viewer: SessionUser, range: LedgerRange, options: { now?: Date } = {}): Promise<ThirdPartiesDashboard> {
  assertCapability(viewer, 'thirdParty:view');
  await connectToDatabase();
  const [active, byType] = await Promise.all([
    ThirdParty.countDocuments({ status: 'active', archivedAt: null }),
    ThirdParty.aggregate<{ _id: string; n: number }>([{ $match: { status: 'active', archivedAt: null } }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
  ]);
  const dash: ThirdPartiesDashboard = {
    activeThirdParties: active,
    typeCounts: byType.map((t) => ({ type: t._id, count: t.n })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    money: null,
  };
  if (!viewer.capabilities.has('payout:view')) return dash;

  const { timezone } = await getSettings();
  const today = todayDateOnly(options.now ?? new Date(), timezone);
  const inRange = { $gte: range.from, $lte: range.to };

  const [paidRows, dueRows, orders] = await Promise.all([
    ThirdPartyPayout.aggregate<PaidFacets>([
      { $match: { status: 'paid', paidOn: inRange } },
      {
        $facet: {
          total: [{ $group: { _id: null, inr: { $sum: '$amount.inrMinor' }, n: { $sum: 1 } } }],
          perMonth: [{ $group: { _id: { $dateToString: { format: '%Y-%m', date: '$paidOn' } }, inr: { $sum: '$amount.inrMinor' } } }],
          byThirdParty: [{ $group: { _id: '$thirdPartyId', inr: { $sum: '$amount.inrMinor' } } }],
          byProject: [{ $group: { _id: '$projectId', inr: { $sum: '$amount.inrMinor' } } }],
          byCurrency: [{ $group: { _id: '$amount.currency', native: { $sum: '$amount.amountMinor' }, inr: { $sum: '$amount.inrMinor' } } }],
        },
      },
    ]),
    ThirdPartyPayout.aggregate<DueFacets>([
      { $match: { status: 'due' } },
      {
        $facet: {
          total: [{ $group: { _id: null, inr: { $sum: '$amount.inrMinor' }, n: { $sum: 1 } } }],
          // `dueOn` is date-only; a payout with no due date is never "overdue" (a $match on the field skips it).
          overdue: [{ $match: { dueOn: { $lt: today } } }, { $group: { _id: null, inr: { $sum: '$amount.inrMinor' }, n: { $sum: 1 } } }],
        },
      },
    ]),
    WorkOrder.find({ status: mongoose.trusted({ $in: ['open', 'delivered'] }) }).lean(),
  ]);

  const paid = paidRows[0] ?? { total: [], perMonth: [], byThirdParty: [], byProject: [], byCurrency: [] };
  const due = dueRows[0] ?? { total: [], overdue: [] };

  // Names for the top rows, and the third-party type of every third party paid in the period.
  const partyInr = new Map(paid.byThirdParty.map((r) => [String(r._id), r.inr]));
  const parties = partyInr.size
    ? await ThirdParty.find({ _id: mongoose.trusted({ $in: [...partyInr.keys()].map((i) => new Types.ObjectId(i)) }) })
        .select('name type')
        .lean()
    : [];
  const partyById = new Map(parties.map((p) => [String(p._id), p]));
  const byThirdParty = [...partyInr.entries()]
    .map(([id, inr]) => ({ id, name: partyById.get(id)?.name ?? 'Unknown third party', paidInr: inr }))
    .sort((a, b) => b.paidInr - a.paidInr || a.name.localeCompare(b.name));
  const typeInr = new Map<string, number>();
  for (const [id, inr] of partyInr) {
    const type = partyById.get(id)?.type ?? 'unknown';
    typeInr.set(type, (typeInr.get(type) ?? 0) + inr);
  }

  const topProjects = [...paid.byProject].sort((a, b) => b.inr - a.inr).slice(0, TOP);
  const projects = topProjects.length
    ? await Project.find({ _id: mongoose.trusted({ $in: topProjects.map((p) => p._id) }) })
        .select('ref name')
        .lean()
    : [];
  const projectById = new Map(projects.map((p) => [String(p._id), p]));

  const perMonth = new Map(paid.perMonth.map((m) => [m._id, m.inr]));

  const open = await buildOpenWorkOrders(orders, today);

  return {
    ...dash,
    money: {
      paid: {
        inr: paid.total[0]?.inr ?? 0,
        count: paid.total[0]?.n ?? 0,
        byCurrency: paid.byCurrency
          .map((c) => ({ currency: c._id, nativeMinor: c.native, inrMinor: c.inr }))
          .sort((a, b) => a.currency.localeCompare(b.currency)),
      },
      due: { inr: due.total[0]?.inr ?? 0, count: due.total[0]?.n ?? 0, overdueInr: due.overdue[0]?.inr ?? 0, overdueCount: due.overdue[0]?.n ?? 0 },
      perMonth: monthsInPeriod(range).map((m) => ({ month: monthKey(m), label: monthLabel(m), paidInr: perMonth.get(monthKey(m)) ?? 0 })),
      byThirdParty: byThirdParty.slice(0, TOP),
      byProject: topProjects.map((p) => ({
        id: String(p._id),
        ref: projectById.get(String(p._id))?.ref ?? '',
        name: projectById.get(String(p._id))?.name ?? 'Unknown project',
        paidInr: p.inr,
      })),
      byType: [...typeInr.entries()].map(([type, paidInr]) => ({ type, paidInr })).sort((a, b) => b.paidInr - a.paidInr || a.type.localeCompare(b.type)),
      openWorkOrders: open,
    },
  };
}

/** The open work orders: their count, the balance per currency at the latest rate, and the biggest rows. */
async function buildOpenWorkOrders(orders: readonly WorkOrderDoc[], today: Date): Promise<ThirdPartiesMoney['openWorkOrders']> {
  const balance = (w: WorkOrderDoc) => w.agreed.amountMinor - (w.paidMinor ?? 0) - (w.dueMinor ?? 0);

  // Only a positive balance is something left to record; an overrun is shown on its row, not netted off the total.
  const perCurrency = new Map<string, number>();
  for (const w of orders) {
    const left = Math.max(0, balance(w));
    if (left > 0) perCurrency.set(w.agreed.currency, (perCurrency.get(w.agreed.currency) ?? 0) + left);
  }
  const currencies = new Set([...perCurrency.keys(), ...orders.map((w) => w.agreed.currency)]);
  const rates = new Map<string, number | null>();
  for (const c of currencies) rates.set(c, (await lookupRate(c, today))?.rate ?? null);
  const inr = (minor: number, currency: string) => {
    const rate = rates.get(currency);
    return rate === null || rate === undefined ? null : toInrMinor(minor, currency, rate);
  };

  const byCurrency = [...perCurrency.entries()]
    .map(([currency, balanceMinor]) => ({ currency, balanceMinor, balanceInr: inr(balanceMinor, currency) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  const converted = byCurrency.filter((c) => c.balanceInr !== null);
  const missingRates = byCurrency.filter((c) => c.balanceInr === null).map((c) => c.currency);

  const ranked = [...orders].sort((a, b) => (inr(Math.max(0, balance(b)), b.agreed.currency) ?? 0) - (inr(Math.max(0, balance(a)), a.agreed.currency) ?? 0) || a.ref.localeCompare(b.ref)).slice(0, ROWS);
  const briefs = await loadLinkBriefs(ranked.map((w) => w.projectId), []);
  const rows: OpenWorkOrderRow[] = ranked.map((w) => {
    const project = briefs.projects.get(String(w.projectId));
    return {
      id: String(w._id),
      ref: w.ref,
      title: w.title,
      thirdPartyId: String(w.thirdPartyId),
      thirdPartyName: w.thirdPartyName,
      projectId: String(w.projectId),
      projectRef: project?.ref ?? '',
      projectName: project?.name ?? 'Unknown project',
      agreed: { amountMinor: w.agreed.amountMinor, currency: w.agreed.currency },
      paidMinor: w.paidMinor ?? 0,
      dueMinor: w.dueMinor ?? 0,
      balanceMinor: balance(w),
      balanceInr: inr(Math.max(0, balance(w)), w.agreed.currency),
      dueOn: w.dueOn ? formatDateOnly(w.dueOn) : null,
      overdue: Boolean(w.dueOn && w.dueOn.getTime() < today.getTime()),
      status: w.status,
    };
  });

  return {
    count: orders.length,
    balanceInr: converted.length === 0 && byCurrency.length > 0 ? null : converted.reduce((s, c) => s + (c.balanceInr ?? 0), 0),
    byCurrency,
    missingRates,
    rows,
  };
}
