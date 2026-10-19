import { Types } from 'mongoose';
import { forbidden } from '@/lib/api/errors';
import { BASE_CURRENCY } from '@/config/currencies';
import { formatDateOnly } from '@/lib/dates/date-only';
import { monthsInPeriod } from '@/lib/dates/ranges';
import { connectToDatabase, mongoose } from '@/lib/db/mongoose';
import { Expense, Project } from '@/models';
import type { SessionUser } from '@/types/session';
import { canSubmitExpenses, canViewAllExpenses, SETTLED_STATUSES } from '@/services/expense.service';
import type { LedgerRange } from './ledger';

/**
 * The Expenses dashboard (plan section 5, row Expenses). Every figure is computed from the records: spend
 * sums `amount.inrMinor` of APPROVED and PAID expenses on their spend date, and rejected and void expenses
 * never appear in any total. Nothing is invented: an empty database gives zeros and empty lists.
 *
 * Who sees what:
 * - `expense:view` sees the company figures below.
 * - A plain admin (`expense:submit` only) gets a small "My expenses" summary of their OWN out-of-pocket
 *   expenses instead, and nothing about anyone else's. Anyone else is refused.
 *
 * The two queues ("awaiting approval" and "owed to admins") are open items, so they count every date and
 * ignore the period; everything else is for expenses spent within the period.
 */

export interface CountAndInr {
  count: number;
  inrMinor: number;
}

export interface ExpensesDashboard {
  scope: 'all';
  /** Date-only, inclusive, "YYYY-MM-DD". */
  range: { from: string; to: string };
  spent: CountAndInr & {
    /** Foreign-currency spend as its own amounts, a secondary line under the INR total. INR never appears here. */
    foreign: Array<{ currency: string; nativeMinor: number; inrMinor: number }>;
  };
  company: CountAndInr;
  project: CountAndInr;
  /** Submitted and not yet decided. All dates. */
  awaitingApproval: CountAndInr;
  /** Approved out-of-pocket expenses not yet reimbursed: what we owe our admins. All dates. */
  owedToAdmins: CountAndInr & { byAdmin: Array<{ adminId: string | null; name: string; count: number; inrMinor: number }> };
  /** One row per month of the period, zero-filled. `categories` are the top five by spend; the rest fall into `other`. */
  perMonth: {
    categories: string[];
    rows: Array<{ month: string; label: string; byCategory: Record<string, number>; other: number }>;
    hasOther: boolean;
  };
  byCategory: Array<{ category: string; count: number; inrMinor: number }>;
  /** The ten projects with the most spend in the period. */
  byProject: Array<{ projectId: string; ref: string; name: string; count: number; inrMinor: number }>;
}

/** What a plain admin sees: their own out-of-pocket expenses only. */
export interface MyExpensesSummary {
  scope: 'own';
  range: { from: string; to: string };
  awaitingApproval: CountAndInr;
  /** Approved and waiting to be paid back to this person. */
  toBePaid: CountAndInr;
  /** Reimbursed, for expenses spent in the period. */
  paidInPeriod: CountAndInr;
  /** Rejected, for expenses spent in the period. */
  rejectedInPeriod: { count: number };
}

export type ExpensesDashboardResult = ExpensesDashboard | MyExpensesSummary;

const TOP_CATEGORIES = 5;
const TOP_PROJECTS = 10;

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const monthLabel = (d: Date) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', month: 'short', year: '2-digit' }).format(d);

const sum = { $sum: '$amount.inrMinor' };
const count = { $sum: 1 };
const none: CountAndInr = { count: 0, inrMinor: 0 };
const total = (row?: { n: number; inr: number }): CountAndInr => (row ? { count: row.n, inrMinor: row.inr } : { ...none });

interface Group {
  n: number;
  inr: number;
}

interface AllFacets {
  byScope: Array<Group & { _id: string }>;
  byCurrency: Array<{ _id: string; native: number; inr: number }>;
  byMonthCategory: Array<{ _id: { month: string; category: string }; inr: number }>;
  byCategory: Array<Group & { _id: string }>;
  byProject: Array<Group & { _id: Types.ObjectId }>;
  awaiting: Group[];
  owed: Array<Group & { _id: Types.ObjectId | null; name: string }>;
}

export async function getExpensesDashboard(viewer: SessionUser, range: LedgerRange): Promise<ExpensesDashboardResult> {
  const all = canViewAllExpenses(viewer);
  if (!all && !canSubmitExpenses(viewer)) throw forbidden('Your access does not allow this action');
  await connectToDatabase();
  return all ? companyDashboard(range) : myExpenses(new Types.ObjectId(viewer.id), range);
}

async function companyDashboard(range: LedgerRange): Promise<ExpensesDashboard> {
  const settled = { status: { $in: [...SETTLED_STATUSES] }, spentOn: { $gte: range.from, $lte: range.to } };
  const [f] = await Expense.aggregate<AllFacets>([
    // Rejected and void expenses are dropped here, before any total is built.
    { $match: { status: { $in: ['submitted', 'approved', 'paid'] } } },
    {
      $facet: {
        byScope: [{ $match: settled }, { $group: { _id: '$scope', n: count, inr: sum } }],
        byCurrency: [{ $match: settled }, { $group: { _id: '$amount.currency', native: { $sum: '$amount.amountMinor' }, inr: sum } }],
        byMonthCategory: [
          { $match: settled },
          { $group: { _id: { month: { $dateToString: { format: '%Y-%m', date: '$spentOn' } }, category: '$category' }, inr: sum } },
        ],
        byCategory: [{ $match: settled }, { $group: { _id: '$category', n: count, inr: sum } }],
        byProject: [
          { $match: { ...settled, scope: 'project', projectId: { $ne: null } } },
          { $group: { _id: '$projectId', n: count, inr: sum } },
          { $sort: { inr: -1, _id: 1 } },
          { $limit: TOP_PROJECTS },
        ],
        awaiting: [{ $match: { status: 'submitted' } }, { $group: { _id: null, n: count, inr: sum } }],
        owed: [
          { $match: { status: 'approved', paidFrom: 'admin' } },
          { $group: { _id: '$paidByAdmin.id', name: { $last: '$paidByAdmin.name' }, n: count, inr: sum } },
          { $sort: { inr: -1, name: 1 } },
        ],
      },
    },
  ]);
  const facets: AllFacets = f ?? { byScope: [], byCurrency: [], byMonthCategory: [], byCategory: [], byProject: [], awaiting: [], owed: [] };

  const scope = new Map(facets.byScope.map((s) => [s._id, s]));
  const company = total(scope.get('company'));
  const project = total(scope.get('project'));

  const byCategory = facets.byCategory
    .map((c) => ({ category: c._id, count: c.n, inrMinor: c.inr }))
    .sort((a, b) => b.inrMinor - a.inrMinor || a.category.localeCompare(b.category));
  const top = byCategory.slice(0, TOP_CATEGORIES).map((c) => c.category);
  const topSet = new Set(top);
  const cell = new Map(facets.byMonthCategory.map((c) => [`${c._id.month}|${c._id.category}`, c.inr]));
  const monthOf = (month: string) => facets.byMonthCategory.filter((c) => c._id.month === month);
  const rows = monthsInPeriod(range).map((m) => {
    const month = monthKey(m);
    return {
      month,
      label: monthLabel(m),
      byCategory: Object.fromEntries(top.map((c) => [c, cell.get(`${month}|${c}`) ?? 0])),
      other: monthOf(month).filter((c) => !topSet.has(c._id.category)).reduce((s, c) => s + c.inr, 0),
    };
  });

  const projects = facets.byProject.length
    ? await Project.find({ _id: mongoose.trusted({ $in: facets.byProject.map((p) => p._id) }) }).select('ref name').lean()
    : [];
  const projectById = new Map(projects.map((p) => [String(p._id), p]));

  const owed = facets.owed.map((o) => ({ adminId: o._id ? String(o._id) : null, name: o.name, count: o.n, inrMinor: o.inr }));

  return {
    scope: 'all',
    range: { from: formatDateOnly(range.from), to: formatDateOnly(range.to) },
    spent: {
      count: company.count + project.count,
      inrMinor: company.inrMinor + project.inrMinor,
      foreign: facets.byCurrency
        .filter((c) => c._id !== BASE_CURRENCY)
        .map((c) => ({ currency: c._id, nativeMinor: c.native, inrMinor: c.inr }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
    },
    company,
    project,
    awaitingApproval: total(facets.awaiting[0]),
    owedToAdmins: {
      count: owed.reduce((s, o) => s + o.count, 0),
      inrMinor: owed.reduce((s, o) => s + o.inrMinor, 0),
      byAdmin: owed,
    },
    perMonth: { categories: top, rows, hasOther: rows.some((r) => r.other > 0) },
    byCategory,
    byProject: facets.byProject.map((p) => {
      const meta = projectById.get(String(p._id));
      return { projectId: String(p._id), ref: meta?.ref ?? '', name: meta?.name ?? 'Unknown project', count: p.n, inrMinor: p.inr };
    }),
  };
}

async function myExpenses(me: Types.ObjectId, range: LedgerRange): Promise<MyExpensesSummary> {
  const inRange = { $gte: range.from, $lte: range.to };
  const [f] = await Expense.aggregate<{ awaiting: Group[]; toBePaid: Group[]; paid: Group[]; rejected: Group[] }>([
    // Only what this person paid out of pocket. Company-paid expenses are not theirs.
    { $match: { paidFrom: 'admin', 'paidByAdmin.id': me } },
    {
      $facet: {
        awaiting: [{ $match: { status: 'submitted' } }, { $group: { _id: null, n: count, inr: sum } }],
        toBePaid: [{ $match: { status: 'approved' } }, { $group: { _id: null, n: count, inr: sum } }],
        paid: [{ $match: { status: 'paid', spentOn: inRange } }, { $group: { _id: null, n: count, inr: sum } }],
        rejected: [{ $match: { status: 'rejected', spentOn: inRange } }, { $group: { _id: null, n: count, inr: sum } }],
      },
    },
  ]);
  return {
    scope: 'own',
    range: { from: formatDateOnly(range.from), to: formatDateOnly(range.to) },
    awaitingApproval: total(f?.awaiting[0]),
    toBePaid: total(f?.toBePaid[0]),
    paidInPeriod: total(f?.paid[0]),
    rejectedInPeriod: { count: f?.rejected[0]?.n ?? 0 },
  };
}
