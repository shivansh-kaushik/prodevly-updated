import { Types, type PipelineStage } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { computeMargin, type Margin } from '@/lib/money/margin';
import { Client, ClientPayment, Expense, TeamPayout, ThirdPartyPayout } from '@/models';

/**
 * THE LEDGER: the one pipeline every money dashboard is built on (plan section 4).
 *
 * It starts from `clientpayments` and `$unionWith`s the other three money collections, each
 * projected to the same row, so a single `$group` or `$facet` after it can total cash in, cash
 * out and margins without any dashboard re-deriving what "counts".
 *
 *   { kind, date, clientId, projectId, taskId, inrMinor, currency, nativeMinor, fxSource }
 *
 *   kind        'receipt' | 'refund' | 'thirdPartyPayout' | 'expense' | 'teamPayout'
 *   date        the settlement date: receivedOn, paidOn (payouts), spentOn (expenses)
 *   clientId    null for a company expense and for a whole (company-view) team payout
 *   projectId   null for the same rows
 *   taskId      null when the entry is not tied to a task (and for team payouts)
 *   inrMinor    INR paise, SIGNED: a refund is negative, so summing a set of rows nets it out
 *   currency    the entry's own currency
 *   nativeMinor the entry's own amount in minor units, signed like inrMinor
 *   fxSource    how the rate was set ('identity' | 'table' | 'bank' | 'manual')
 *
 * WHAT COUNTS (only settled money, nothing open, void or rejected ever appears):
 *   client payments   status received, refunds subtracted        date = receivedOn
 *   third-party       status paid                                 date = paidOn
 *   expenses          status approved or paid (already spent)     date = spentOn
 *   team payouts      status paid                                 date = paidOn
 * Dashboards sum `inrMinor` and nothing else; native amounts are only a secondary line.
 *
 * SCOPE
 *   'company' (default)  every row; a team payout is ONE row for the whole payout amount, a company
 *                        expense has no project.
 *   'project'            only rows that belong to a project; a team payout is UNWOUND by allocation, one
 *                        row per allocation carrying that allocation's INR share (the remainder of the
 *                        payout is overhead and is not a project cost). Passing clientId, projectId or
 *                        projectIds implies this scope, because a whole payout belongs to a person.
 *   Company totals use the payout amount and project margins use the allocations, so nothing is
 *   counted twice.
 *
 * INTERNAL CLIENT: projects of "ProDevly (internal)" never count as revenue. `internalClientId` drops
 * receipts and refunds of that client; their COSTS still appear (company totals, and an Internal row
 * in project tables). `runLedger` resolves the id when you set `excludeInternalRevenue`.
 *
 * SAFETY: aggregation pipelines are NOT sanitised by Mongoose, so every value in a `$match` here is a
 * parsed primitive (an ObjectId built from a 24-hex string, a Date), never a raw request value. Nothing
 * in this file checks a viewer's capability: it is a data layer. Every dashboard that calls it asserts
 * the capability for the figures it shows (payment:view for received and margins, and so on).
 */

export const LEDGER_KINDS = ['receipt', 'refund', 'thirdPartyPayout', 'expense', 'teamPayout'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export interface LedgerRow {
  kind: LedgerKind;
  date: Date;
  clientId: Types.ObjectId | null;
  projectId: Types.ObjectId | null;
  taskId: Types.ObjectId | null;
  inrMinor: number;
  currency: string;
  nativeMinor: number;
  fxSource: string;
}

/** Inclusive on both ends, both date-only (UTC midnight), as `resolvePeriod` returns them. */
export interface LedgerRange {
  from: Date;
  to: Date;
}

export interface LedgerPipelineOptions {
  range?: LedgerRange;
  clientId?: string;
  projectId?: string;
  projectIds?: readonly string[];
  scope?: 'company' | 'project';
  /** Receipts and refunds of this client are not revenue and are left out. */
  internalClientId?: string;
}

export interface LedgerOptions extends Omit<LedgerPipelineOptions, 'internalClientId'> {
  /** Resolve the internal client and leave its receipts and refunds out. */
  excludeInternalRevenue?: boolean;
}

const HEX_ID = /^[a-f\d]{24}$/i;

function toObjectId(value: string, name: string): Types.ObjectId {
  if (!HEX_ID.test(value)) throw new Error(`${name} must be a 24-character hex id`);
  return new Types.ObjectId(value.toLowerCase());
}

interface Resolved {
  range?: LedgerRange;
  clientId?: Types.ObjectId;
  projectIds?: Types.ObjectId[];
  projectScope: boolean;
  internalClientId?: Types.ObjectId;
}

function resolve(o: LedgerPipelineOptions): Resolved {
  if (o.projectId !== undefined && o.projectIds !== undefined) throw new Error('Pass projectId or projectIds, not both');
  if (o.range) {
    const { from, to } = o.range;
    if (!(from instanceof Date) || !(to instanceof Date) || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw new Error('The ledger range needs two valid dates, from on or before to');
    }
  }
  const projectIds =
    o.projectId !== undefined
      ? [toObjectId(o.projectId, 'projectId')]
      : o.projectIds
        ? [...new Set(o.projectIds.map((id) => id.toLowerCase()))].map((id) => toObjectId(id, 'projectIds'))
        : undefined;
  const clientId = o.clientId !== undefined ? toObjectId(o.clientId, 'clientId') : undefined;
  return {
    range: o.range,
    clientId,
    projectIds,
    projectScope: o.scope === 'project' || clientId !== undefined || projectIds !== undefined,
    internalClientId: o.internalClientId !== undefined ? toObjectId(o.internalClientId, 'internalClientId') : undefined,
  };
}

type Cond = Record<string, unknown>;

const dateCond = (field: string, range?: LedgerRange): Cond[] => (range ? [{ [field]: { $gte: range.from, $lte: range.to } }] : []);

function linkConds(r: Resolved, clientField: string, projectField: string): Cond[] {
  const out: Cond[] = [];
  if (r.clientId) out.push({ [clientField]: r.clientId });
  if (r.projectIds) out.push({ [projectField]: { $in: r.projectIds } });
  else if (r.projectScope) out.push({ [projectField]: { $ne: null } }); // company rows have no project
  return out;
}

const match = (conds: Cond[]): PipelineStage => ({ $match: { $and: conds } });
const nul = { $literal: null };
const orNull = (path: string) => ({ $ifNull: [path, null] });

/** The common row. `kind`, `clientId`, `projectId`, `taskId`, `inrMinor` and `nativeMinor` vary per source. */
function project(fields: Record<string, unknown>): PipelineStage {
  return { $project: { _id: 0, ...fields } } as PipelineStage;
}

function receiptStages(r: Resolved): PipelineStage[] {
  const conds: Cond[] = [{ status: 'received' }, ...dateCond('receivedOn', r.range), ...linkConds(r, 'clientId', 'projectId')];
  if (r.internalClientId) conds.push({ clientId: { $ne: r.internalClientId } });
  const sign = (path: string) => ({ $cond: [{ $eq: ['$type', 'refund'] }, { $multiply: [path, -1] }, path] });
  return [
    match(conds),
    project({
      kind: { $cond: [{ $eq: ['$type', 'refund'] }, 'refund', 'receipt'] },
      date: '$receivedOn',
      clientId: '$clientId',
      projectId: '$projectId',
      taskId: orNull('$taskId'),
      inrMinor: sign('$amount.inrMinor'),
      currency: '$amount.currency',
      nativeMinor: sign('$amount.amountMinor'),
      fxSource: '$amount.fxSource',
    }),
  ];
}

function thirdPartyStages(r: Resolved): PipelineStage[] {
  return [
    match([{ status: 'paid' }, ...dateCond('paidOn', r.range), ...linkConds(r, 'clientId', 'projectId')]),
    project({
      kind: { $literal: 'thirdPartyPayout' },
      date: '$paidOn',
      clientId: '$clientId',
      projectId: '$projectId',
      taskId: orNull('$taskId'),
      inrMinor: '$amount.inrMinor',
      currency: '$amount.currency',
      nativeMinor: '$amount.amountMinor',
      fxSource: '$amount.fxSource',
    }),
  ];
}

function expenseStages(r: Resolved): PipelineStage[] {
  return [
    match([{ status: { $in: ['approved', 'paid'] } }, ...dateCond('spentOn', r.range), ...linkConds(r, 'clientId', 'projectId')]),
    project({
      kind: { $literal: 'expense' },
      date: '$spentOn',
      clientId: orNull('$clientId'),
      projectId: orNull('$projectId'),
      taskId: orNull('$taskId'),
      inrMinor: '$amount.inrMinor',
      currency: '$amount.currency',
      nativeMinor: '$amount.amountMinor',
      fxSource: '$amount.fxSource',
    }),
  ];
}

function teamPayoutStages(r: Resolved): PipelineStage[] {
  const base: Cond[] = [{ status: 'paid' }, ...dateCond('paidOn', r.range)];
  if (!r.projectScope) {
    return [
      match(base),
      project({
        kind: { $literal: 'teamPayout' },
        date: '$paidOn',
        clientId: nul,
        projectId: nul,
        taskId: nul,
        inrMinor: '$amount.inrMinor',
        currency: '$amount.currency',
        nativeMinor: '$amount.amountMinor',
        fxSource: '$amount.fxSource',
      }),
    ];
  }
  // A payout can allocate to several projects, so filter twice: before the unwind (to use the
  // allocations.projectId index and skip payouts that cannot match) and after it (to keep only the
  // allocations that do).
  const pre: Cond[] = [...base];
  if (r.clientId) pre.push({ 'allocations.clientId': r.clientId });
  if (r.projectIds) pre.push({ 'allocations.projectId': { $in: r.projectIds } });
  return [
    match(pre),
    { $unwind: '$allocations' },
    match([{ status: 'paid' }, ...linkConds(r, 'allocations.clientId', 'allocations.projectId')]),
    project({
      kind: { $literal: 'teamPayout' },
      date: '$paidOn',
      clientId: '$allocations.clientId',
      projectId: '$allocations.projectId',
      taskId: nul,
      inrMinor: '$allocations.inrMinor',
      currency: '$amount.currency',
      nativeMinor: '$allocations.amountMinor',
      fxSource: '$amount.fxSource',
    }),
  ];
}

type UnionStage = PipelineStage.UnionWith['$unionWith'];
const union = (coll: string, pipeline: PipelineStage[]): PipelineStage => ({
  $unionWith: { coll, pipeline } as UnionStage,
});

/**
 * The aggregation stages. Run them with `ClientPayment.aggregate(...)` (the base collection), or use
 * `runLedger`. Append your own `$group` or `$facet` to total the rows.
 */
export function ledgerUnionPipeline(options: LedgerPipelineOptions = {}): PipelineStage[] {
  const r = resolve(options);
  return [
    ...receiptStages(r),
    union(ThirdPartyPayout.collection.name, thirdPartyStages(r)),
    union(Expense.collection.name, expenseStages(r)),
    union(TeamPayout.collection.name, teamPayoutStages(r)),
  ];
}

/** The id of "ProDevly (internal)", or undefined before it exists (a fresh database). */
export async function resolveInternalClientId(): Promise<string | undefined> {
  await connectToDatabase();
  const internal = await Client.findOne({ isInternal: true }).select('_id').lean();
  return internal ? String(internal._id) : undefined;
}

/** Runs the ledger pipeline followed by your own stages. */
export async function runLedger<T = LedgerRow>(options: LedgerOptions = {}, tail: PipelineStage[] = []): Promise<T[]> {
  await connectToDatabase();
  const { excludeInternalRevenue, ...rest } = options;
  const internalClientId = excludeInternalRevenue ? await resolveInternalClientId() : undefined;
  return ClientPayment.aggregate<T>([...ledgerUnionPipeline({ ...rest, internalClientId }), ...tail]);
}

interface KindTotal {
  _id: LedgerKind;
  inr: number;
}

function emptyKinds(): Record<LedgerKind, number> {
  return { receipt: 0, refund: 0, thirdPartyPayout: 0, expense: 0, teamPayout: 0 };
}

export interface CompanyTotals {
  /** External client receipts net of refunds. Internal-client projects are not revenue. */
  receivedInr: number;
  thirdPartyInr: number;
  expenseInr: number;
  /** The paid payout amounts, whole (allocations are for project views). */
  teamInr: number;
  netInr: number;
}

/**
 * Company net for a period: external received minus paid third-party payouts minus approved and
 * paid expenses (company and project scope) minus paid team payouts. Costs of internal projects
 * count here; their receipts do not.
 */
export async function getCompanyTotals(range?: LedgerRange): Promise<CompanyTotals> {
  const rows = await runLedger<KindTotal>({ range, scope: 'company', excludeInternalRevenue: true }, [
    { $group: { _id: '$kind', inr: { $sum: '$inrMinor' } } },
  ]);
  const by = emptyKinds();
  for (const row of rows) by[row._id] += row.inr;
  const receivedInr = by.receipt + by.refund; // refunds are already negative
  return {
    receivedInr,
    thirdPartyInr: by.thirdPartyPayout,
    expenseInr: by.expense,
    teamInr: by.teamPayout,
    netInr: receivedInr - by.thirdPartyPayout - by.expense - by.teamPayout,
  };
}

export interface ProjectMargin extends Margin {
  projectId: string;
}

/**
 * Margin per project (plan section 4): received minus third-party, expense and team cost, where team
 * cost is the project's share of paid payouts by allocation. Only projects with at least one settled
 * row come back, except that every id in `projectIds` is returned (as zeros) so a table of known
 * projects never has holes. Receipts of internal-client projects are excluded, so an internal
 * project shows costs and no revenue.
 */
export async function getProjectMargins(
  range?: LedgerRange,
  projectIds?: readonly string[],
  options: { clientId?: string } = {},
): Promise<ProjectMargin[]> {
  if (projectIds && projectIds.length === 0) return [];
  const rows = await runLedger<{ _id: { projectId: Types.ObjectId; kind: LedgerKind }; inr: number }>(
    { range, projectIds, clientId: options.clientId, scope: 'project', excludeInternalRevenue: true },
    [{ $group: { _id: { projectId: '$projectId', kind: '$kind' }, inr: { $sum: '$inrMinor' } } }],
  );

  const byProject = new Map<string, Record<LedgerKind, number>>();
  for (const id of projectIds ?? []) byProject.set(id.toLowerCase(), emptyKinds());
  for (const row of rows) {
    const key = String(row._id.projectId);
    const kinds = byProject.get(key) ?? emptyKinds();
    kinds[row._id.kind] += row.inr;
    byProject.set(key, kinds);
  }

  return [...byProject.entries()]
    .map(([projectId, k]) => ({
      projectId,
      ...computeMargin({ receivedInr: k.receipt + k.refund, thirdPartyInr: k.thirdPartyPayout, expenseInr: k.expense, teamInr: k.teamPayout }),
    }))
    .sort((a, b) => b.receivedInr - a.receivedInr || b.marginInr - a.marginInr || a.projectId.localeCompare(b.projectId));
}
