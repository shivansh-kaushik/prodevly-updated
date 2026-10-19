import { Types } from 'mongoose';
import { assertCapability } from '@/lib/auth/guard';
import type { Capability } from '@/config/capabilities';
import { PROJECT_STATUSES, type ProjectStatus } from '@/config/statuses';
import { formatDateOnly } from '@/lib/dates/date-only';
import { monthsInPeriod, type Period } from '@/lib/dates/ranges';
import { connectToDatabase, mongoose } from '@/lib/db/mongoose';
import { Client, Project } from '@/models';
import type { SessionUser } from '@/types/session';
import type { ActivityEntry } from '@/services/activity.service';
import { auditScopeOf, listAudit, type AuditEntryDTO, type AuditScope } from '@/services/audit-log.service';
import { getEnquiriesDashboard } from './enquiries';
import { getExpensesDashboard } from './expenses';
import { getCompanyTotals, getProjectMargins, resolveInternalClientId, runLedger, type LedgerKind, type LedgerRange } from './ledger';
import { getPaymentsDashboard } from './payments';
import { getProjectsDashboard } from './projects';
import { getTasksDashboard } from './tasks';
import { getThirdPartiesDashboard } from './third-parties';

/**
 * The company Overview at /admin (plan sections 2, 4 and 5). It COMPOSES the section dashboards and the
 * ledger instead of working figures out again, so a number here is the number on the section's own page:
 *
 *   cash in and out, company net     getCompanyTotals / runLedger (the one money pipeline)
 *   outstanding, overdue milestones  getPaymentsDashboard (billable less received, at the latest rates)
 *   due payouts, payout count        getThirdPartiesDashboard
 *   reimbursements owed, expenses    getExpensesDashboard
 *   projects, tasks, enquiries       their own dashboards
 *   top projects by margin           getProjectMargins
 *   latest activity                  listAudit (scoped to the viewer by the audit service itself)
 *
 * WHO SEES WHAT is decided in one place, `overviewAccess`, from the viewer's own capabilities. A tile,
 * chart or list the viewer may not see is `null` in the result (and left out of the page), never zero, and
 * its source is not even queried. Company net adds up four ledgers, so it needs all four views:
 * a viewer who may see only some of them would otherwise be able to subtract their way to the rest.
 *
 * Everything is computed from records at read time: only settled money counts (received, paid, approved
 * or paid expenses; void and rejected are excluded by the ledger), the internal client's receipts are not
 * revenue, and an empty database gives zeros and empty lists.
 */

/** The page's decisions, one flag per tile or chart. */
export interface OverviewAccess {
  received: boolean;
  thirdParties: boolean;
  expenses: boolean;
  team: boolean;
  /** Needs all four money views: it is the sum of every ledger. */
  net: boolean;
  outstanding: boolean;
  /** Due payouts plus reimbursements owed: needs both the payout and the expense view. */
  payables: boolean;
  topProjects: boolean;
  projects: boolean;
  tasks: boolean;
  enquiries: boolean;
  /** Whether the ledger has to be read at all. */
  ledger: boolean;
  /** Whether the viewer may look at clients, which the first-run hint needs to know whether any exist. */
  clients: boolean;
}

export function overviewAccess(viewer: Pick<SessionUser, 'capabilities'>): OverviewAccess {
  const has = (c: Capability) => viewer.capabilities.has(c);
  const received = has('payment:view');
  const thirdParties = has('payout:view');
  const expenses = has('expense:view');
  const team = has('team:payView');
  return {
    received,
    thirdParties,
    expenses,
    team,
    net: received && thirdParties && expenses && team,
    outstanding: received,
    payables: thirdParties && expenses,
    topProjects: received && has('project:view'),
    projects: has('project:view'),
    tasks: has('task:view'),
    enquiries: has('lead:view'),
    ledger: received || thirdParties || expenses || team,
    clients: has('client:view'),
  };
}

export interface OverviewMoney {
  net: { inrMinor: number } | null;
  received: { inrMinor: number } | null;
  thirdParties: { inrMinor: number; payouts: number } | null;
  expenses: { inrMinor: number; count: number } | null;
  team: { inrMinor: number } | null;
  /**
   * Billable less received per project, at the latest table rates. `inrMinor` is null when every balance is in
   * a currency with no rate yet (nothing can be totalled); `missingRates` lists the currencies left out of it.
   */
  outstanding: { inrMinor: number | null; missingRates: string[]; overdueMilestones: number } | null;
  /** What we owe: due third-party payouts plus approved out-of-pocket expenses not yet reimbursed. Not period-bound. */
  payables: {
    inrMinor: number;
    duePayouts: { inrMinor: number; count: number; overdueCount: number };
    reimbursements: { inrMinor: number; count: number };
  } | null;
}

export interface CashFlowMonth {
  /** "2026-04" */
  month: string;
  label: string;
  /** Each figure is null when the viewer may not see that ledger. */
  cashInInr: number | null;
  thirdPartyInr: number | null;
  expenseInr: number | null;
  teamInr: number | null;
  /** Cash in less all three cash outs. Present only with all four views. */
  netInr: number | null;
}

export interface CashFlow {
  /** Which series the viewer may see. */
  series: { cashIn: boolean; thirdParties: boolean; expenses: boolean; team: boolean };
  /** One entry per month of the period, zero-filled. */
  months: CashFlowMonth[];
}

export interface TopProject {
  projectId: string;
  ref: string;
  name: string;
  clientName: string;
  receivedInr: number;
  marginInr: number;
  /** One decimal, or null when nothing was received. */
  marginPct: number | null;
}

export interface OverviewDashboard {
  period: { key: string; label: string; fyLabel: string | null; from: string; to: string };
  money: OverviewMoney;
  /** Null when the viewer may see none of the four ledgers. */
  cashFlow: CashFlow | null;
  /** The five best margins of the period, external projects only. Null without payment:view and project:view. */
  topProjects: TopProject[] | null;
  projects: {
    /** Not archived. */
    total: number;
    active: number;
    /** Deadline passed while active, in review or on hold. */
    overdue: number;
    byStatus: Array<{ status: ProjectStatus; count: number }>;
  } | null;
  tasks: { open: number; overdue: number; blocked: number; inProgress: number } | null;
  enquiries: {
    /** Received in the period, spam left out. */
    newInPeriod: number;
    /** Right now, whatever the period: open enquiries nobody has moved off "new". */
    waitingForFirstReply: number;
  } | null;
  /** The viewer's part of the audit log: everyone's for audit:viewAll, otherwise only their own. */
  activity: { scope: AuditScope; entries: ActivityEntry[] };
  /** First-run hints. Null when the viewer may not look. */
  setup: { hasClients: boolean | null; hasProjects: boolean | null };
}

export const OVERVIEW_ACTIVITY_LIMIT = 15;
const TOP_PROJECTS = 5;

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const monthLabel = (d: Date) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', month: 'short', year: '2-digit' }).format(d);

/**
 * The viewer as the section dashboards want to see them. Each section service asserts its own capability
 * (the third-party dashboard wants thirdParty:view even for the payout figures; the projects dashboard
 * builds a whole money section for payment:view). The Overview has already decided tile by tile what this
 * viewer may see, so each call gets exactly the capabilities that service needs for the figures taken from
 * it here, and nothing else. What a section returns beyond those figures is dropped, not passed on.
 */
function forSection(viewer: SessionUser, ...capabilities: Capability[]): SessionUser {
  return { ...viewer, capabilities: new Set(capabilities) };
}

/** A section call that cannot come back empty for the capabilities it was given. A miss is a bug, not a state. */
function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`The ${what} dashboard returned nothing for a viewer it was called for`);
  return value;
}

interface MonthKindRow {
  _id: { month: string; kind: LedgerKind };
  inr: number;
}

async function loadLedger(period: Period, can: OverviewAccess) {
  const range: LedgerRange = { from: period.from, to: period.to };
  const [totals, rows] = await Promise.all([
    getCompanyTotals(range),
    // The same pipeline and the same options as the totals, grouped by month, so the months add up to the tiles.
    runLedger<MonthKindRow>({ range, scope: 'company', excludeInternalRevenue: true }, [
      { $group: { _id: { month: { $dateToString: { format: '%Y-%m', date: '$date' } }, kind: '$kind' }, inr: { $sum: '$inrMinor' } } },
    ]),
  ]);

  const cell = new Map(rows.map((r) => [`${r._id.month}|${r._id.kind}`, r.inr]));
  const months: CashFlowMonth[] = monthsInPeriod(period).map((m) => {
    const key = monthKey(m);
    const of = (kind: LedgerKind) => cell.get(`${key}|${kind}`) ?? 0;
    // A refund is stored negative, so adding it nets it out of cash in.
    const cashIn = of('receipt') + of('refund');
    const thirdParty = of('thirdPartyPayout');
    const expense = of('expense');
    const team = of('teamPayout');
    return {
      month: key,
      label: monthLabel(m),
      cashInInr: can.received ? cashIn : null,
      thirdPartyInr: can.thirdParties ? thirdParty : null,
      expenseInr: can.expenses ? expense : null,
      teamInr: can.team ? team : null,
      netInr: can.net ? cashIn - thirdParty - expense - team : null,
    };
  });

  return {
    totals,
    cashFlow: { series: { cashIn: can.received, thirdParties: can.thirdParties, expenses: can.expenses, team: can.team }, months } satisfies CashFlow,
  };
}

async function loadTopProjects(range: LedgerRange): Promise<TopProject[]> {
  const [margins, internalClientId] = await Promise.all([getProjectMargins(range), resolveInternalClientId()]);
  if (margins.length === 0) return [];
  const projects = await Project.find({ _id: mongoose.trusted({ $in: margins.map((m) => new Types.ObjectId(m.projectId)) }) })
    .select('ref name clientId clientName')
    .lean();
  const meta = new Map(projects.map((p) => [String(p._id), p]));

  const rows: TopProject[] = [];
  for (const m of margins) {
    const p = meta.get(m.projectId);
    // Our own projects are costs without revenue, never a margin worth ranking.
    if (!p || (internalClientId && String(p.clientId) === internalClientId)) continue;
    rows.push({ projectId: m.projectId, ref: p.ref, name: p.name, clientName: p.clientName, receivedInr: m.receivedInr, marginInr: m.marginInr, marginPct: m.marginPct });
  }
  return rows.sort((a, b) => b.marginInr - a.marginInr || b.receivedInr - a.receivedInr || a.name.localeCompare(b.name) || a.projectId.localeCompare(b.projectId)).slice(0, TOP_PROJECTS);
}

/** The feed's own row shape: the audit entry without its ids for filtering, request id or IP hash. */
function toFeedEntry(e: AuditEntryDTO): ActivityEntry {
  return { id: e.id, at: e.at, actorName: e.actorName, actorRole: e.actorRole, action: e.action, summary: e.summary, entity: e.entity, changes: e.changes };
}

export interface OverviewOptions {
  /** The clock, for tests. */
  now?: Date;
}

export async function getOverviewDashboard(viewer: SessionUser, period: Period, options: OverviewOptions = {}): Promise<OverviewDashboard> {
  assertCapability(viewer, 'dashboard:view');
  await connectToDatabase();
  const now = options.now ?? new Date();
  const can = overviewAccess(viewer);
  const range: LedgerRange = { from: period.from, to: period.to };

  // A section is read only when the viewer may see a figure from it.
  const [ledger, payments, thirdParties, expenses, projects, tasks, enquiries, topProjects, audit, hasClients, hasProjects] = await Promise.all([
    can.ledger ? loadLedger(period, can) : null,
    can.outstanding ? getPaymentsDashboard(forSection(viewer, 'payment:view'), period, { now }) : null,
    can.thirdParties || can.payables ? getThirdPartiesDashboard(forSection(viewer, 'thirdParty:view', 'payout:view'), range, { now }) : null,
    can.expenses || can.payables ? getExpensesDashboard(forSection(viewer, 'expense:view'), range) : null,
    can.projects ? getProjectsDashboard(forSection(viewer, 'project:view'), range, { now }) : null,
    can.tasks ? getTasksDashboard(forSection(viewer, 'task:view'), period, {}, now) : null,
    can.enquiries ? getEnquiriesDashboard(forSection(viewer, 'lead:view'), period, { now }) : null,
    can.topProjects ? loadTopProjects(range) : null,
    listAudit(viewer, {}, { pageSize: OVERVIEW_ACTIVITY_LIMIT }),
    can.clients ? Client.exists({ isInternal: false }).then(Boolean) : null,
    can.projects ? Project.exists({}).then(Boolean) : null,
  ]);

  const totals = ledger?.totals;
  const party = thirdParties ? required(thirdParties.money, 'third-party money') : null;
  // The viewer given to the expenses dashboard holds expense:view, so it answers with the company figures.
  if (expenses && expenses.scope !== 'all') throw new Error('The expenses dashboard answered with a personal summary for a viewer who may see the company figures');
  const spend = expenses && expenses.scope === 'all' ? expenses : null;

  const money: OverviewMoney = {
    net: can.net && totals ? { inrMinor: totals.netInr } : null,
    received: can.received && totals ? { inrMinor: totals.receivedInr } : null,
    thirdParties: can.thirdParties && totals && party ? { inrMinor: totals.thirdPartyInr, payouts: party.paid.count } : null,
    expenses: can.expenses && totals && spend ? { inrMinor: totals.expenseInr, count: spend.spent.count } : null,
    team: can.team && totals ? { inrMinor: totals.teamInr } : null,
    outstanding: can.outstanding && payments
      ? {
          // Nothing outstanding is zero; balances that all lack a rate cannot be totalled at all.
          inrMinor: payments.outstanding.totalInr ?? (payments.outstanding.missingRates.length > 0 ? null : 0),
          missingRates: payments.outstanding.missingRates,
          overdueMilestones: payments.overdue.count,
        }
      : null,
    payables: can.payables && party && spend
      ? {
          inrMinor: party.due.inr + spend.owedToAdmins.inrMinor,
          duePayouts: { inrMinor: party.due.inr, count: party.due.count, overdueCount: party.due.overdueCount },
          reimbursements: { inrMinor: spend.owedToAdmins.inrMinor, count: spend.owedToAdmins.count },
        }
      : null,
  };

  return {
    period: { key: period.key, label: period.label, fyLabel: period.fyLabel, from: formatDateOnly(period.from), to: formatDateOnly(period.to) },
    money,
    cashFlow: ledger?.cashFlow ?? null,
    topProjects,
    projects: projects
      ? {
          total: projects.total,
          active: projects.active,
          overdue: projects.overdue,
          // Every status, in workflow order, as the Projects page lists them.
          byStatus: PROJECT_STATUSES.map((status) => ({ status, count: projects.byStatus.find((s) => s.status === status)?.count ?? 0 })),
        }
      : null,
    tasks: tasks ? { open: tasks.openTotal, overdue: tasks.overdue, blocked: tasks.blocked, inProgress: tasks.openByStatus.in_progress } : null,
    enquiries: enquiries ? { newInPeriod: enquiries.newInPeriod, waitingForFirstReply: enquiries.waitingForFirstReply } : null,
    activity: { scope: auditScopeOf(viewer), entries: audit.entries.map(toFeedEntry) },
    setup: { hasClients, hasProjects },
  };
}
