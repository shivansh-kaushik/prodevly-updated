import { Types } from 'mongoose';
import { mongoose, connectToDatabase } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { TASK_STATUSES, PROJECT_STATUSES, type ProjectStatus } from '@/config/statuses';
import { notFound } from '@/lib/api/errors';
import { formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { monthsInPeriod } from '@/lib/dates/ranges';
import { toInrMinor } from '@/lib/money/fx';
import {
  billableTotalMinor,
  budgetUsedPercent,
  marginPercent,
  outstandingMinor,
  projectedMargin,
  type Margin,
  type Projected,
} from '@/lib/money/margin';
import { parseObjectId } from '@/lib/validation/common';
import { WORKING_STATUSES } from '@/lib/validation/project';
import { Admin, ClientPayment, FxRate, Project, Task, TeamPayout, ThirdPartyPayout, WorkLog, WorkOrder } from '@/models';
import type { SessionUser } from '@/types/session';
import { getRecordActivity, type ActivityEntry } from '@/services/activity.service';
import { getSettings } from '@/services/settings.service';
import { getProjectMargins, resolveInternalClientId, runLedger, type LedgerRange } from './ledger';

/**
 * The Projects section's numbers: the list-page dashboard, and the per-project read models behind
 * the money, tasks, team and activity tabs. Everything is computed from records at read time. Money
 * comes from the ledger (INR sums only; voided and rejected entries never appear), and money
 * figures are left out entirely (not zeroed) for a viewer without payment:view.
 */

const oid = (id: string) => new Types.ObjectId(parseObjectId(id));
const day = (d?: Date | null) => (d ? formatDateOnly(d) : null);
const DAY_MS = 86_400_000;

/* ---------------------------- list dashboard ---------------------------- */

export interface MarginRow {
  projectId: string;
  ref: string;
  name: string;
  clientName: string;
  receivedInr: number;
  thirdPartyInr: number;
  expenseInr: number;
  teamInr: number;
  marginInr: number;
  marginPct: number | null;
}

export interface BudgetRow {
  projectId: string;
  ref: string;
  name: string;
  budgetInr: number;
  costInr: number;
  usedPct: number;
}

export interface ProjectsDashboard {
  /** Not archived, after the client filter. */
  total: number;
  /** Every status, zero-filled, in workflow order. */
  byStatus: Array<{ status: ProjectStatus; count: number }>;
  active: number;
  atRisk: number;
  offTrack: number;
  /** Deadline passed while active, in review or on hold. */
  overdue: number;
  deliveredInPeriod: number;
  /** Delivered date minus deadline, averaged over projects delivered in the period that had a deadline. Negative is early. Null with no such project. */
  avgSlipDays: number | null;
  slipSample: number;
  /** One entry per month of the period, zero-filled. */
  startedVsDelivered: Array<{ month: string; label: string; started: number; delivered: number }>;
  byType: Array<{ type: string; count: number }>;
  /** Present only with payment:view. */
  money: null | {
    /** Totals over EVERY external project with settled money in the period, not just the rows shown. */
    receivedInr: number;
    thirdPartyInr: number;
    expenseInr: number;
    teamInr: number;
    costInr: number;
    marginInr: number;
    marginPct: number | null;
    /** Costs of internal projects: not part of the margin above (internal work is never revenue). */
    internalCostInr: number;
    /** External projects with settled money in the period, largest receipts first, capped at 25. */
    rows: MarginRow[];
    /** How many external projects had settled money in the period (rows may be fewer). */
    projectsWithMoney: number;
    internal: null | { projects: number; thirdPartyInr: number; expenseInr: number; teamInr: number; costInr: number };
    /** Projects with a cost budget, most used first (all-time costs against the budget). */
    budgets: BudgetRow[];
  };
}

export interface DashboardOptions {
  clientId?: string;
  now?: Date;
}

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const monthLabel = (d: Date) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', month: 'short', year: '2-digit' }).format(d);

interface Facets {
  byStatus: Array<{ _id: ProjectStatus; n: number }>;
  byType: Array<{ _id: string; n: number }>;
  health: Array<{ _id: string; n: number }>;
  overdue: Array<{ n: number }>;
  delivered: Array<{ n: number; withDeadline: number; slipMs: number }>;
  started: Array<{ _id: string; n: number }>;
  deliveredByMonth: Array<{ _id: string; n: number }>;
  budgeted: Array<{ _id: Types.ObjectId; ref: string; name: string; costBudgetInrMinor: number }>;
}

export async function getProjectsDashboard(viewer: SessionUser, range: LedgerRange, options: DashboardOptions = {}): Promise<ProjectsDashboard> {
  assertCapability(viewer, 'project:view');
  await connectToDatabase();
  const withMoney = viewer.capabilities.has('payment:view');
  const { timezone } = await getSettings();
  const today = todayDateOnly(options.now ?? new Date(), timezone);
  const clientId = options.clientId ? oid(options.clientId) : undefined;

  const inRange = { $gte: range.from, $lte: range.to };
  const [facets] = await Project.aggregate<Facets>([
    { $match: { archivedAt: null, ...(clientId ? { clientId } : {}) } },
    {
      $facet: {
        byStatus: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
        byType: [{ $group: { _id: '$type', n: { $sum: 1 } } }],
        health: [
          { $match: { status: { $in: WORKING_STATUSES }, health: { $in: ['at_risk', 'off_track'] } } },
          { $group: { _id: '$health', n: { $sum: 1 } } },
        ],
        overdue: [{ $match: { status: { $in: WORKING_STATUSES }, deadlineOn: { $lt: today } } }, { $count: 'n' }],
        delivered: [
          { $match: { deliveredOn: inRange } },
          {
            $group: {
              _id: null,
              n: { $sum: 1 },
              withDeadline: { $sum: { $cond: [{ $ifNull: ['$deadlineOn', false] }, 1, 0] } },
              // Both are date-only (UTC midnight), so the difference is a whole number of days.
              slipMs: { $sum: { $cond: [{ $ifNull: ['$deadlineOn', false] }, { $subtract: ['$deliveredOn', '$deadlineOn'] }, 0] } },
            },
          },
        ],
        started: [{ $match: { startOn: inRange } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$startOn' } }, n: { $sum: 1 } } }],
        deliveredByMonth: [{ $match: { deliveredOn: inRange } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$deliveredOn' } }, n: { $sum: 1 } } }],
        budgeted: withMoney ? [{ $match: { costBudgetInrMinor: { $gt: 0 } } }, { $project: { ref: 1, name: 1, costBudgetInrMinor: 1 } }] : [{ $match: { _id: null } }],
      },
    },
  ]);
  const f: Facets = facets ?? { byStatus: [], byType: [], health: [], overdue: [], delivered: [], started: [], deliveredByMonth: [], budgeted: [] };

  const statusCount = new Map(f.byStatus.map((s) => [s._id, s.n]));
  const byStatus = PROJECT_STATUSES.map((status) => ({ status, count: statusCount.get(status) ?? 0 }));
  const health = new Map(f.health.map((h) => [h._id, h.n]));
  const delivered = f.delivered[0];
  const started = new Map(f.started.map((s) => [s._id, s.n]));
  const deliveredBy = new Map(f.deliveredByMonth.map((s) => [s._id, s.n]));

  const dash: ProjectsDashboard = {
    total: byStatus.reduce((s, x) => s + x.count, 0),
    byStatus,
    active: statusCount.get('active') ?? 0,
    atRisk: health.get('at_risk') ?? 0,
    offTrack: health.get('off_track') ?? 0,
    overdue: f.overdue[0]?.n ?? 0,
    deliveredInPeriod: delivered?.n ?? 0,
    avgSlipDays: delivered && delivered.withDeadline > 0 ? Math.round((delivered.slipMs / DAY_MS / delivered.withDeadline) * 10) / 10 : null,
    slipSample: delivered?.withDeadline ?? 0,
    startedVsDelivered: monthsInPeriod(range).map((m) => ({
      month: monthKey(m),
      label: monthLabel(m),
      started: started.get(monthKey(m)) ?? 0,
      delivered: deliveredBy.get(monthKey(m)) ?? 0,
    })),
    byType: f.byType.map((t) => ({ type: t._id, count: t.n })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    money: null,
  };
  if (!withMoney) return dash;

  dash.money = await buildMoneySection(range, options.clientId, f.budgeted);
  return dash;
}

async function buildMoneySection(range: LedgerRange, clientId: string | undefined, budgeted: Facets['budgeted']): Promise<NonNullable<ProjectsDashboard['money']>> {
  const [margins, internalClientId] = await Promise.all([getProjectMargins(range, undefined, { clientId }), resolveInternalClientId()]);
  const projects = await Project.find({ _id: mongoose.trusted({ $in: margins.map((m) => new Types.ObjectId(m.projectId)) }) })
    .select('ref name clientId clientName')
    .lean();
  const meta = new Map(projects.map((p) => [String(p._id), p]));

  const external: MarginRow[] = [];
  const internal = { projects: 0, thirdPartyInr: 0, expenseInr: 0, teamInr: 0, costInr: 0 };
  for (const m of margins) {
    const p = meta.get(m.projectId);
    if (!p) continue;
    if (internalClientId && String(p.clientId) === internalClientId) {
      internal.projects += 1;
      internal.thirdPartyInr += m.thirdPartyInr;
      internal.expenseInr += m.expenseInr;
      internal.teamInr += m.teamInr;
      internal.costInr += m.costInr;
      continue;
    }
    external.push({
      projectId: m.projectId, ref: p.ref, name: p.name, clientName: p.clientName,
      receivedInr: m.receivedInr, thirdPartyInr: m.thirdPartyInr, expenseInr: m.expenseInr, teamInr: m.teamInr,
      marginInr: m.marginInr, marginPct: m.marginPct,
    });
  }
  external.sort((a, b) => b.receivedInr - a.receivedInr || b.marginInr - a.marginInr || a.name.localeCompare(b.name));
  const sum = (pick: (r: MarginRow) => number) => external.reduce((s, r) => s + pick(r), 0);
  const receivedInr = sum((r) => r.receivedInr);
  const thirdPartyInr = sum((r) => r.thirdPartyInr);
  const expenseInr = sum((r) => r.expenseInr);
  const teamInr = sum((r) => r.teamInr);
  const costInr = thirdPartyInr + expenseInr + teamInr;
  const marginInr = receivedInr - costInr;

  // Cost budget used: all-time costs against the budget, since a budget covers the whole project.
  const budgetMargins = budgeted.length > 0 ? await getProjectMargins(undefined, budgeted.map((b) => String(b._id))) : [];
  const costOf = new Map(budgetMargins.map((m) => [m.projectId, m.costInr]));
  const budgets: BudgetRow[] = budgeted
    .map((b) => {
      const cost = costOf.get(String(b._id)) ?? 0;
      return { projectId: String(b._id), ref: b.ref, name: b.name, budgetInr: b.costBudgetInrMinor, costInr: cost, usedPct: budgetUsedPercent(cost, b.costBudgetInrMinor) ?? 0 };
    })
    .sort((a, b) => b.usedPct - a.usedPct || a.name.localeCompare(b.name))
    .slice(0, 10);

  return {
    receivedInr,
    thirdPartyInr,
    expenseInr,
    teamInr,
    costInr,
    marginInr,
    marginPct: marginPercent(marginInr, receivedInr),
    internalCostInr: internal.costInr,
    rows: external.slice(0, 25),
    projectsWithMoney: external.length,
    internal: internal.projects > 0 ? internal : null,
    budgets,
  };
}

/* ---------------------------- project money tab ---------------------------- */

export interface ProjectMoneyReport {
  contractCurrency: string;
  /** In the contract currency. */
  billableMinor: number;
  receivedContractMinor: number;
  /** Negative means more was received than is billable (an advance). */
  outstandingMinor: number;
  /** All-time, INR, from the ledger. */
  margin: Margin;
  /** Native amounts grouped by currency, a secondary line under the INR total. */
  receivedByCurrency: Array<{ currency: string; nativeMinor: number; inrMinor: number }>;
  committed: { dueThirdPartyInr: number; openWorkOrderInr: number | null; dueTeamInr: number };
  /** Billable total at the latest table rate. Null when that currency has no rate yet. */
  billableInr: number | null;
  rate: { rate: number; rateOn: string } | null;
  /** Currencies (contract or work order) with no table rate, which stops the projection. */
  missingRates: string[];
  projected: Projected | null;
  budget: { budgetInr: number; costInr: number; usedPct: number | null } | null;
}

async function latestRate(currency: string): Promise<{ rate: number; rateOn: Date } | null> {
  if (currency === 'INR') return { rate: 1, rateOn: new Date(0) };
  const row = await FxRate.findOne({ currency }).sort({ rateOn: -1 }).lean();
  return row ? { rate: row.rate, rateOn: row.rateOn } : null;
}

/** The money tab of one project (plan section 4). Needs payment:view. All-time, not period-limited. */
export async function getProjectMoney(viewer: SessionUser, id: string): Promise<ProjectMoneyReport> {
  assertCapability(viewer, 'project:view');
  assertCapability(viewer, 'payment:view');
  await connectToDatabase();
  const projectId = oid(id);
  const project = await Project.findById(projectId).lean();
  if (!project) throw notFound('We could not find that project');

  const billableMinor = billableTotalMinor(project.contract, project.milestones);

  const [receivedRows, margins, byCurrency, dueThirdParty, dueTeam, workOrders] = await Promise.all([
    ClientPayment.aggregate<{ total: number }>([
      { $match: { projectId, status: 'received' } },
      { $group: { _id: null, total: { $sum: { $cond: [{ $eq: ['$type', 'refund'] }, { $multiply: ['$contractEquivalentMinor', -1] }, '$contractEquivalentMinor'] } } } },
    ]),
    getProjectMargins(undefined, [String(projectId)]),
    runLedger<{ _id: string; nativeMinor: number; inrMinor: number }>({ projectId: String(projectId), scope: 'project', excludeInternalRevenue: true }, [
      { $match: { kind: { $in: ['receipt', 'refund'] } } },
      { $group: { _id: '$currency', nativeMinor: { $sum: '$nativeMinor' }, inrMinor: { $sum: '$inrMinor' } } },
      { $sort: { _id: 1 } },
    ]),
    ThirdPartyPayout.aggregate<{ inr: number }>([{ $match: { projectId, status: 'due' } }, { $group: { _id: null, inr: { $sum: '$amount.inrMinor' } } }]),
    TeamPayout.aggregate<{ inr: number }>([
      { $match: { status: 'due', 'allocations.projectId': projectId } },
      { $unwind: '$allocations' },
      { $match: { 'allocations.projectId': projectId } },
      { $group: { _id: null, inr: { $sum: '$allocations.inrMinor' } } },
    ]),
    WorkOrder.find({ projectId, status: mongoose.trusted({ $in: ['open', 'delivered'] }) }).select('agreed paidMinor dueMinor').lean(),
  ]);

  const receivedContractMinor = receivedRows[0]?.total ?? 0;
  const margin = margins[0] ?? { projectId: String(projectId), ...zeroMargin() };
  const dueThirdPartyInr = dueThirdParty[0]?.inr ?? 0;
  const dueTeamInr = dueTeam[0]?.inr ?? 0;

  // Open work-order balance (agreed minus paid minus due), per currency, converted at the latest table rate.
  const balances = new Map<string, number>();
  for (const wo of workOrders) {
    const left = Math.max(0, wo.agreed.amountMinor - wo.paidMinor - wo.dueMinor);
    if (left > 0) balances.set(wo.agreed.currency, (balances.get(wo.agreed.currency) ?? 0) + left);
  }
  const currencies = new Set([project.contract.currency, ...balances.keys()]);
  const rates = new Map<string, { rate: number; rateOn: Date } | null>();
  for (const c of currencies) rates.set(c, await latestRate(c));
  const missingRates = [...currencies].filter((c) => !rates.get(c)).sort();

  const contractRate = rates.get(project.contract.currency) ?? null;
  const billableInr = contractRate ? toInrMinor(billableMinor, project.contract.currency, contractRate.rate) : null;
  let openWorkOrderInr: number | null = 0;
  for (const [currency, amount] of balances) {
    const r = rates.get(currency);
    if (!r) openWorkOrderInr = null;
    else if (openWorkOrderInr !== null) openWorkOrderInr += toInrMinor(amount, currency, r.rate);
  }

  const projected =
    billableInr !== null && openWorkOrderInr !== null
      ? projectedMargin({ billableInr, settledCostInr: margin.costInr, dueThirdPartyInr, openWorkOrderInr, dueTeamInr })
      : null;
  const budgetInr = project.costBudgetInrMinor ?? 0;

  return {
    contractCurrency: project.contract.currency,
    billableMinor,
    receivedContractMinor,
    outstandingMinor: outstandingMinor(billableMinor, receivedContractMinor),
    margin,
    receivedByCurrency: byCurrency.map((c) => ({ currency: c._id, nativeMinor: c.nativeMinor, inrMinor: c.inrMinor })),
    committed: { dueThirdPartyInr, openWorkOrderInr, dueTeamInr },
    billableInr,
    rate: contractRate && project.contract.currency !== 'INR' ? { rate: contractRate.rate, rateOn: formatDateOnly(contractRate.rateOn) } : null,
    missingRates,
    projected,
    budget: budgetInr > 0 ? { budgetInr, costInr: margin.costInr, usedPct: budgetUsedPercent(margin.costInr, budgetInr) } : null,
  };
}

function zeroMargin(): Margin {
  return { receivedInr: 0, thirdPartyInr: 0, expenseInr: 0, teamInr: 0, costInr: 0, marginInr: 0, marginPct: null };
}

/* --------------------------- tasks, team, activity --------------------------- */

export interface ProjectTaskRow {
  id: string;
  ref: string;
  title: string;
  status: string;
  priority: string;
  dueOn: string | null;
  assignees: string[];
  estimateMinutes: number | null;
  loggedMinutes: number;
}

/** The project's tasks, board order within each status. Needs task:view as well, because it lists task records. */
export async function getProjectTasks(viewer: SessionUser, id: string): Promise<{ items: ProjectTaskRow[]; total: number; byStatus: Record<string, number> }> {
  assertCapability(viewer, 'project:view');
  assertCapability(viewer, 'task:view');
  await connectToDatabase();
  const projectId = oid(id);
  const filter = { projectId, archivedAt: null };
  const [rows, total, counts] = await Promise.all([
    Task.find(filter).sort({ order: 1, _id: 1 }).limit(200).lean(),
    Task.countDocuments(filter),
    Task.aggregate<{ _id: string; n: number }>([{ $match: filter }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  const rank = new Map(TASK_STATUSES.map((s, i) => [s, i]));
  rows.sort((a, b) => (rank.get(a.status) ?? 99) - (rank.get(b.status) ?? 99));
  return {
    total,
    byStatus: Object.fromEntries(counts.map((c) => [c._id, c.n])),
    items: rows.map((t) => ({
      id: String(t._id),
      ref: t.ref,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueOn: day(t.dueOn),
      assignees: (t.assignees ?? []).map((a) => a.name),
      estimateMinutes: t.estimateMinutes ?? null,
      loggedMinutes: t.loggedMinutes ?? 0,
    })),
  };
}

export interface ProjectTeamDTO {
  lead: { id: string | null; name: string } | null;
  members: Array<{ id: string; name: string; designation: string | null; isLead: boolean; active: boolean; member: boolean; minutes: number | null; billableMinutes: number | null }>;
  totalMinutes: number;
  /** False when the viewer sees only their own hours (no worklog:viewAll). */
  sawAllHours: boolean;
}

/**
 * Members and the hours logged on the project. Everyone with project:view sees who is on the team and
 * the project's total hours; per-person hours need worklog:viewAll, otherwise a viewer sees their own.
 */
export async function getProjectTeam(viewer: SessionUser, id: string): Promise<ProjectTeamDTO> {
  assertCapability(viewer, 'project:view');
  await connectToDatabase();
  const projectId = oid(id);
  const project = await Project.findById(projectId).select('lead memberIds').lean();
  if (!project) throw notFound('We could not find that project');

  const hours = await WorkLog.aggregate<{ _id: Types.ObjectId; name: string; minutes: number; billable: number }>([
    { $match: { projectId } },
    { $group: { _id: '$adminId', name: { $last: '$adminName' }, minutes: { $sum: '$minutes' }, billable: { $sum: { $cond: ['$billable', '$minutes', 0] } } } },
  ]);
  const totalMinutes = hours.reduce((s, h) => s + h.minutes, 0);
  const sawAllHours = viewer.capabilities.has('worklog:viewAll');
  const hoursOf = new Map(hours.map((h) => [String(h._id), h]));

  const memberIds = new Set((project.memberIds ?? []).map(String));
  const shown = new Set(memberIds);
  if (sawAllHours) for (const h of hours) shown.add(String(h._id));
  else if (hoursOf.has(viewer.id)) shown.add(viewer.id);
  if (project.lead?.id) shown.add(String(project.lead.id));

  const admins = await Admin.find({ _id: mongoose.trusted({ $in: [...shown].map((i) => new Types.ObjectId(i)) }) })
    .select('name status profile.designation')
    .lean();
  const leadId = project.lead?.id ? String(project.lead.id) : null;
  const members = admins
    .map((a) => {
      const h = hoursOf.get(String(a._id));
      const visible = sawAllHours || String(a._id) === viewer.id;
      return {
        id: String(a._id),
        name: a.name,
        designation: a.profile?.designation ?? null,
        isLead: String(a._id) === leadId,
        active: a.status === 'active',
        member: memberIds.has(String(a._id)),
        minutes: visible ? (h?.minutes ?? 0) : null,
        billableMinutes: visible ? (h?.billable ?? 0) : null,
      };
    })
    .sort((a, b) => Number(b.isLead) - Number(a.isLead) || Number(b.member) - Number(a.member) || a.name.localeCompare(b.name));

  return { lead: project.lead ? { id: leadId, name: project.lead.name } : null, members, totalMinutes, sawAllHours };
}

/** The audit entity types that carry money, and the capability needed to see them. */

/**
 * The audit trail of one project. Money entries (payments, payouts, expenses) and the contract,
 * milestone and budget fields of project entries are only shown to viewers who may see that money:
 * an activity feed must not become a way around a capability.
 */
export async function getProjectActivity(viewer: SessionUser, id: string, limit = 30): Promise<ActivityEntry[]> {
  assertCapability(viewer, 'project:view');
  const projectId = parseObjectId(id);
  return getRecordActivity(viewer, { projectId }, limit);
}

