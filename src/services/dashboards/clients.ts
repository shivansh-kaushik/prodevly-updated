import { Types } from 'mongoose';
import { connectToDatabase, mongoose } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { CLIENT_STATUSES } from '@/config/statuses';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import type { Period } from '@/lib/dates/ranges';
import { toInrMinor } from '@/lib/money/fx';
import { billableTotalMinor, computeMargin, outstandingMinor } from '@/lib/money/margin';
import { Client, ClientPayment, Project } from '@/models';
import type { SessionUser } from '@/types/session';
import { getProjectMargins } from '@/services/dashboards/ledger';
import { lookupRate } from '@/services/fx.service';
import { getSettings } from '@/services/settings.service';

/**
 * The Clients dashboard (plan section 5). The client counts need only client:view. Everything that
 * is money (received, outstanding, top-three share, overdue milestones) needs payment:view and is
 * `null` otherwise, so the page leaves those tiles out instead of showing zero. The internal client
 * never counts as a client here and its receipts are never revenue.
 */
export interface RankedClient {
  id: string;
  name: string;
  inrMinor: number;
}

export interface OverdueMilestone {
  clientId: string;
  clientName: string;
  projectId: string;
  projectName: string;
  milestone: string;
  amountMinor: number;
  currency: string;
  dueOn: string;
  daysLate: number;
}

export interface ClientsMoney {
  /** Clients with at least one receipt in the period. */
  receivingClients: number;
  receivedInrMinor: number;
  /** Share of the period's net receipts that came from the three biggest payers, or null when nothing was received. */
  topThreeSharePct: number | null;
  receivedByClient: RankedClient[];
  /** Billable minus received, never negative per project, at the latest table rate. */
  outstandingInrMinor: number;
  /** Contract currencies with no rate yet: their outstanding is left out of the INR total and listed here. */
  outstandingMissingRates: string[];
  outstandingByCurrency: Array<{ currency: string; minor: number }>;
  outstandingByClient: RankedClient[];
  overdueMilestones: OverdueMilestone[];
}

export interface ClientsDashboard {
  total: number;
  byStatus: Record<(typeof CLIENT_STATUSES)[number], number>;
  newInPeriod: number;
  byCountry: Array<{ country: string; count: number }>;
  money: ClientsMoney | null;
}

const TOP = 10;
/** Projects whose unpaid contract value is still owed. A proposal or a cancelled project is not. */
const BILLABLE_STATUSES = ['active', 'in_review', 'on_hold', 'delivered', 'maintenance', 'closed'] as const;

export async function getClientsDashboard(viewer: SessionUser, period: Period, now = new Date()): Promise<ClientsDashboard> {
  assertCapability(viewer, 'client:view');
  await connectToDatabase();
  const settings = await getSettings();
  const internal = await Client.findOne({ isInternal: true }).select('_id').lean();
  const notInternal = internal ? { _id: mongoose.trusted({ $ne: internal._id }) } : {};

  const [statusRows, countryRows, newInPeriod] = await Promise.all([
    Client.aggregate<{ _id: string; n: number }>([
      { $match: { archivedAt: null, isInternal: false } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
    Client.aggregate<{ _id: string | null; n: number }>([
      { $match: { archivedAt: null, isInternal: false } },
      { $group: { _id: '$country', n: { $sum: 1 } } },
      { $sort: { n: -1, _id: 1 } },
    ]),
    Client.countDocuments({ isInternal: false, createdAt: mongoose.trusted({ $gte: period.fromInstant, $lt: period.toInstant }) }),
  ]);

  const byStatus = Object.fromEntries(CLIENT_STATUSES.map((s) => [s, 0])) as ClientsDashboard['byStatus'];
  for (const r of statusRows) if (r._id in byStatus) byStatus[r._id as keyof typeof byStatus] = r.n;

  const named = countryRows.filter((r) => r._id);
  const unknown = countryRows.filter((r) => !r._id).reduce((s, r) => s + r.n, 0);
  const top = named.slice(0, 8).map((r) => ({ country: r._id as string, count: r.n }));
  const other = named.slice(8).reduce((s, r) => s + r.n, 0) + unknown;
  const byCountry = other > 0 ? [...top, { country: unknown > 0 && named.length <= 8 ? 'Not set' : 'Other', count: other }] : top;

  const base = {
    total: Object.values(byStatus).reduce((a, b) => a + b, 0),
    byStatus,
    newInPeriod,
    byCountry,
  };
  if (!viewer.capabilities.has('payment:view')) return { ...base, money: null };

  const today = todayDateOnly(now, settings.timezone);
  const names = new Map((await Client.find(notInternal).select('name').lean()).map((c) => [String(c._id), c.name]));

  // Receipts in the period, net of refunds, by client (INR, from the entry's own captured value).
  const received = await ClientPayment.aggregate<{ _id: Types.ObjectId; net: number; receipts: number }>([
    { $match: { status: 'received', receivedOn: { $gte: period.from, $lte: period.to }, ...(internal ? { clientId: { $ne: internal._id } } : {}) } },
    {
      $group: {
        _id: '$clientId',
        net: { $sum: { $cond: [{ $eq: ['$type', 'refund'] }, { $multiply: ['$amount.inrMinor', -1] }, '$amount.inrMinor'] } },
        receipts: { $sum: { $cond: [{ $eq: ['$type', 'refund'] }, 0, 1] } },
      },
    },
  ]);
  const receivedSorted = received.filter((r) => r.net !== 0).sort((a, b) => b.net - a.net);
  const receivedInrMinor = received.reduce((s, r) => s + r.net, 0);
  const topThree = receivedSorted.slice(0, 3).reduce((s, r) => s + r.net, 0);

  // Outstanding per project in its contract currency, then at the latest table rate.
  const projects = await Project.find({ archivedAt: null, status: mongoose.trusted({ $in: [...BILLABLE_STATUSES] }), ...(internal ? { clientId: mongoose.trusted({ $ne: internal._id }) } : {}) })
    .select('clientId clientName name contract milestones')
    .lean();
  const paid = await ClientPayment.aggregate<{ _id: Types.ObjectId; contractMinor: number }>([
    { $match: { status: 'received', projectId: { $in: projects.map((p) => p._id) } } },
    { $group: { _id: '$projectId', contractMinor: { $sum: { $cond: [{ $eq: ['$type', 'refund'] }, { $multiply: ['$contractEquivalentMinor', -1] }, '$contractEquivalentMinor'] } } } },
  ]);
  const receivedContract = new Map(paid.map((p) => [String(p._id), p.contractMinor]));

  const rates = new Map<string, number | null>();
  const rateFor = async (currency: string) => {
    if (!rates.has(currency)) rates.set(currency, (await lookupRate(currency, today))?.rate ?? null);
    return rates.get(currency) ?? null;
  };

  const byCurrency = new Map<string, number>();
  const byClient = new Map<string, number>();
  const missing = new Set<string>();
  let outstandingInr = 0;
  const overdue: OverdueMilestone[] = [];
  for (const p of projects) {
    const owed = Math.max(0, outstandingMinor(billableTotalMinor(p.contract, p.milestones ?? []), receivedContract.get(String(p._id)) ?? 0));
    if (owed > 0) {
      const currency = p.contract.currency;
      byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + owed);
      const rate = await rateFor(currency);
      if (rate === null) missing.add(currency);
      else {
        const inr = toInrMinor(owed, currency, rate);
        outstandingInr += inr;
        byClient.set(String(p.clientId), (byClient.get(String(p.clientId)) ?? 0) + inr);
      }
    }
    for (const m of p.milestones ?? []) {
      if (m.status === 'paid' || !m.dueOn || m.dueOn >= today) continue;
      overdue.push({
        clientId: String(p.clientId),
        clientName: p.clientName,
        projectId: String(p._id),
        projectName: p.name,
        milestone: m.title,
        amountMinor: m.amountMinor,
        currency: p.contract.currency,
        dueOn: formatDateOnly(m.dueOn),
        daysLate: Math.round((today.getTime() - m.dueOn.getTime()) / 86_400_000),
      });
    }
  }
  overdue.sort((a, b) => b.daysLate - a.daysLate || a.clientName.localeCompare(b.clientName));

  const rank = (m: Map<string, number>): RankedClient[] =>
    [...m.entries()]
      .map(([id, inrMinor]) => ({ id, name: names.get(id) ?? 'Unknown client', inrMinor }))
      .sort((a, b) => b.inrMinor - a.inrMinor)
      .slice(0, TOP);

  return {
    ...base,
    money: {
      receivingClients: received.filter((r) => r.receipts > 0).length,
      receivedInrMinor,
      topThreeSharePct: receivedInrMinor > 0 ? Math.round((topThree / receivedInrMinor) * 100) : null,
      receivedByClient: rank(new Map(receivedSorted.map((r) => [String(r._id), r.net]))),
      outstandingInrMinor: outstandingInr,
      outstandingMissingRates: [...missing].sort(),
      outstandingByCurrency: [...byCurrency.entries()].map(([currency, minor]) => ({ currency, minor })).sort((a, b) => b.minor - a.minor),
      outstandingByClient: rank(byClient),
      overdueMilestones: overdue.slice(0, 15),
    },
  };
}

/* ------------------------- one client's money tab ------------------------- */

export interface ClientMoneyProject {
  id: string;
  ref: string;
  name: string;
  status: string;
  currency: string;
  billableMinor: number;
  receivedContractMinor: number;
  /** Billable minus received in the contract currency. Negative means an advance. */
  outstandingMinor: number;
  receivedInrMinor: number;
  thirdPartyInrMinor: number;
  expenseInrMinor: number;
  teamInrMinor: number;
  marginInrMinor: number;
}

export interface ClientMoneyReport {
  projects: ClientMoneyProject[];
  totals: { receivedInrMinor: number; thirdPartyInrMinor: number; expenseInrMinor: number; teamInrMinor: number; marginInrMinor: number; marginPct: number | null };
  isInternal: boolean;
}

/** Received, costs and margin for one client, all time, per project and in total. Needs client:view and payment:view. */
export async function getClientMoney(viewer: SessionUser, clientId: string): Promise<ClientMoneyReport> {
  assertCapability(viewer, 'client:view');
  assertCapability(viewer, 'payment:view');
  await connectToDatabase();
  const id = new Types.ObjectId(clientId);
  const client = await Client.findById(id).select('isInternal').lean();
  const projects = await Project.find({ clientId: id }).select('ref name status contract milestones').sort({ createdAt: -1 }).lean();
  const paid = await ClientPayment.aggregate<{ _id: Types.ObjectId; contractMinor: number }>([
    { $match: { status: 'received', clientId: id } },
    { $group: { _id: '$projectId', contractMinor: { $sum: { $cond: [{ $eq: ['$type', 'refund'] }, { $multiply: ['$contractEquivalentMinor', -1] }, '$contractEquivalentMinor'] } } } },
  ]);
  const receivedContract = new Map(paid.map((p) => [String(p._id), p.contractMinor]));
  const margins = new Map((await getProjectMargins(undefined, projects.map((p) => String(p._id)))).map((m) => [m.projectId, m]));

  const rows: ClientMoneyProject[] = projects.map((p) => {
    const m = margins.get(String(p._id));
    const receivedContractMinor = receivedContract.get(String(p._id)) ?? 0;
    return {
      id: String(p._id),
      ref: p.ref,
      name: p.name,
      status: p.status,
      currency: p.contract.currency,
      billableMinor: billableTotalMinor(p.contract, p.milestones ?? []),
      receivedContractMinor,
      outstandingMinor: outstandingMinor(billableTotalMinor(p.contract, p.milestones ?? []), receivedContractMinor),
      receivedInrMinor: m?.receivedInr ?? 0,
      thirdPartyInrMinor: m?.thirdPartyInr ?? 0,
      expenseInrMinor: m?.expenseInr ?? 0,
      teamInrMinor: m?.teamInr ?? 0,
      marginInrMinor: m?.marginInr ?? 0,
    };
  });
  const sum = (pick: (r: ClientMoneyProject) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const totals = computeMargin({ receivedInr: sum((r) => r.receivedInrMinor), thirdPartyInr: sum((r) => r.thirdPartyInrMinor), expenseInr: sum((r) => r.expenseInrMinor), teamInr: sum((r) => r.teamInrMinor) });
  return {
    projects: rows,
    isInternal: Boolean(client?.isInternal),
    totals: {
      receivedInrMinor: totals.receivedInr,
      thirdPartyInrMinor: totals.thirdPartyInr,
      expenseInrMinor: totals.expenseInr,
      teamInrMinor: totals.teamInr,
      marginInrMinor: totals.marginInr,
      marginPct: totals.marginPct,
    },
  };
}
