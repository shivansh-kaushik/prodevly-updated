import { Types } from 'mongoose';
import { PAYMENT_STATUSES, PAYMENT_TYPES } from '@/config/statuses';
import { escapeRegex, pageMeta, type PageMeta } from '@/lib/admin/search-params';
import { notFound, validationFailed } from '@/lib/api/errors';
import { assertCapability } from '@/lib/auth/guard';
import { formatDateOnly, parseDateOnly } from '@/lib/dates/date-only';
import { connectToDatabase } from '@/lib/db/mongoose';
import { billableTotalMinor } from '@/lib/money/margin';
import { parseObjectId } from '@/lib/validation/common';
import { PAYMENT_SORT_KEYS, type PaymentSortKey } from '@/lib/validation/payment';
import { Client, ClientPayment, Project, type ClientPaymentDoc, type ProjectDoc } from '@/models';
import type { SessionUser } from '@/types/session';
import { loadBriefs, toPaymentDTO, type PaymentDTO } from './client-payment.dto';
import { SIGNED_CONTRACT, type MilestoneStatus } from './client-payment.rules';

/**
 * Reading client payments: the ledger, one entry, the form's view of a project, and the names behind the page
 * filters. Everything here needs payment:view, except the form context (payment:record). The writes are in
 * ./client-payment.service, which re-exports these so callers import from one place.
 */

const oid = (id: string) => new Types.ObjectId(id);
const ymd = (d: Date) => formatDateOnly(d);

export interface PaymentFilter {
  q?: string;
  clientId?: string;
  projectId?: string;
  taskId?: string;
  status?: (typeof PAYMENT_STATUSES)[number];
  type?: (typeof PAYMENT_TYPES)[number];
  mode?: string;
  currency?: string;
  /** Date-only (UTC midnight), inclusive, on the received date. */
  from?: Date;
  to?: Date;
}

export interface PaymentSearch extends PaymentFilter {
  sort?: PaymentSortKey;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface PaymentSummary {
  /** Net of refunds, INR, over the entries that match and are not void. */
  receivedInr: number;
  receipts: number;
  refunds: number;
  refundsInr: number;
  /** Void entries that match: shown in the list, counted in no total. */
  voided: number;
}

export interface PaymentPage {
  items: PaymentDTO[];
  meta: PageMeta;
  summary: PaymentSummary;
}

/**
 * The filter as a raw aggregation `$match`. Built ONLY from parsed values (ids become ObjectIds, dates are
 * checked, search text is escaped), because aggregation stages are not sanitised by Mongoose.
 */
function rawMatch(f: PaymentFilter): Record<string, unknown> {
  const m: Record<string, unknown> = {};
  if (f.clientId) m.clientId = oid(parseObjectId(f.clientId));
  if (f.projectId) m.projectId = oid(parseObjectId(f.projectId));
  if (f.taskId) m.taskId = oid(parseObjectId(f.taskId));
  if (f.status !== undefined) {
    if (!(PAYMENT_STATUSES as readonly string[]).includes(f.status)) throw validationFailed({ status: 'Pick received or void' });
    m.status = f.status;
  }
  if (f.type !== undefined) {
    if (!(PAYMENT_TYPES as readonly string[]).includes(f.type)) throw validationFailed({ type: 'Pick receipt or refund' });
    m.type = f.type;
  }
  if (f.mode !== undefined) {
    if (typeof f.mode !== 'string' || !/^[A-Za-z0-9_]{1,40}$/.test(f.mode)) throw validationFailed({ mode: 'Pick a payment mode' });
    m.mode = f.mode;
  }
  if (f.currency !== undefined) {
    if (typeof f.currency !== 'string' || !/^[A-Za-z]{3}$/.test(f.currency)) throw validationFailed({ currency: 'Pick a currency' });
    m['amount.currency'] = f.currency.toUpperCase();
  }
  if (f.from || f.to) {
    const range: Record<string, Date> = {};
    for (const [key, op, value] of [['from', '$gte', f.from], ['to', '$lte', f.to]] as const) {
      if (!value) continue;
      if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw validationFailed({ [key]: 'Enter a valid date' });
      range[op] = new Date(Math.floor(value.getTime() / 86_400_000) * 86_400_000);
    }
    m.receivedOn = range;
  }
  if (f.q !== undefined && typeof f.q !== 'string') throw validationFailed({ q: 'Search for text' });
  const q = f.q?.trim().slice(0, 100);
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    m.$or = [{ ref: re }, { transactionRef: re }, { invoiceRef: re }];
  }
  return m;
}

const SORT_FIELD: Record<PaymentSortKey, string> = { receivedOn: 'receivedOn', createdAt: 'createdAt', amount: 'amount.inrMinor', ref: 'ref' };

/** The payments ledger, filtered, sorted and paged. Void rows are listed (with their status) but add to no total. */
export async function searchPayments(viewer: SessionUser, params: PaymentSearch = {}): Promise<PaymentPage> {
  assertCapability(viewer, 'payment:view');
  await connectToDatabase();
  const match = rawMatch(params);
  const pageSize = Math.min(Math.max(params.pageSize ?? 25, 1), 100);
  const sort: PaymentSortKey = params.sort && (PAYMENT_SORT_KEYS as readonly string[]).includes(params.sort) ? params.sort : 'receivedOn';
  const dir = (params.dir ?? (sort === 'ref' ? 'asc' : 'desc')) === 'asc' ? 1 : -1;

  const [facet] = await ClientPayment.aggregate<{ total: Array<{ n: number }>; groups: Array<{ _id: { status: string; type: string }; n: number; inr: number }> }>([
    { $match: match },
    {
      $facet: {
        total: [{ $count: 'n' }],
        groups: [{ $group: { _id: { status: '$status', type: '$type' }, n: { $sum: 1 }, inr: { $sum: '$amount.inrMinor' } } }],
      },
    },
  ]);
  const meta = pageMeta(Math.max(params.page ?? 1, 1), pageSize, facet?.total[0]?.n ?? 0);

  const rows = await ClientPayment.aggregate<ClientPaymentDoc>([
    { $match: match },
    { $sort: { [SORT_FIELD[sort]]: dir, _id: -1 } },
    { $skip: (meta.page - 1) * pageSize },
    { $limit: pageSize },
  ]);
  const briefs = await loadBriefs(rows);

  const summary: PaymentSummary = { receivedInr: 0, receipts: 0, refunds: 0, refundsInr: 0, voided: 0 };
  for (const g of facet?.groups ?? []) {
    if (g._id.status === 'void') summary.voided += g.n;
    else if (g._id.type === 'refund') {
      summary.refunds += g.n;
      summary.refundsInr += g.inr;
      summary.receivedInr -= g.inr;
    } else {
      summary.receipts += g.n;
      summary.receivedInr += g.inr;
    }
  }
  return { items: rows.map((r) => toPaymentDTO(r, briefs)), meta, summary };
}

/** The route's GET: the same search from query-string values already parsed by `paymentListQuerySchema`. */
export function filterFromQuery(q: {
  q?: string;
  clientId?: string;
  projectId?: string;
  taskId?: string;
  status?: PaymentFilter['status'];
  type?: PaymentFilter['type'];
  mode?: string;
  currency?: string;
  from?: string;
  to?: string;
}): PaymentFilter {
  return {
    q: q.q,
    clientId: q.clientId,
    projectId: q.projectId,
    taskId: q.taskId,
    status: q.status,
    type: q.type,
    mode: q.mode || undefined,
    currency: q.currency,
    from: q.from ? (parseDateOnly(q.from) ?? undefined) : undefined,
    to: q.to ? (parseDateOnly(q.to) ?? undefined) : undefined,
  };
}

export async function getPayment(viewer: SessionUser, id: string): Promise<PaymentDTO> {
  assertCapability(viewer, 'payment:view');
  await connectToDatabase();
  const doc = await ClientPayment.findById(parseObjectId(id)).lean();
  if (!doc) throw notFound('We could not find that payment');
  return toPaymentDTO(doc, await loadBriefs([doc]));
}

export interface PaymentContextDTO {
  project: { id: string; ref: string; name: string; archived: boolean };
  client: { id: string; name: string };
  contractCurrency: string;
  pricingModel: ProjectDoc['contract']['pricingModel'];
  /** In the contract currency. */
  billableMinor: number;
  receivedMinor: number;
  /** Negative means more was received than is billable (an advance). */
  outstandingMinor: number;
  milestones: Array<{ id: string; title: string; amountMinor: number; dueOn: string | null; status: MilestoneStatus; receivedMinor: number }>;
}

/**
 * What the payment form needs to know about the project being paid: its contract currency (the default
 * for the amount), what is billable and received, and its milestones with what each has received.
 */
export async function getPaymentContext(viewer: SessionUser, projectId: string): Promise<PaymentContextDTO> {
  assertCapability(viewer, 'payment:record');
  await connectToDatabase();
  const id = oid(parseObjectId(projectId));
  const project = await Project.findById(id).lean();
  if (!project) throw notFound('We could not find that project');

  const [total, perMilestone] = await Promise.all([
    ClientPayment.aggregate<{ total: number }>([{ $match: { projectId: id, status: 'received' } }, { $group: { _id: null, total: { $sum: SIGNED_CONTRACT } } }]),
    ClientPayment.aggregate<{ _id: Types.ObjectId; total: number }>([
      { $match: { projectId: id, status: 'received', milestoneId: { $ne: null } } },
      { $group: { _id: '$milestoneId', total: { $sum: SIGNED_CONTRACT } } },
    ]),
  ]);
  const byMilestone = new Map(perMilestone.map((m) => [String(m._id), m.total]));
  const billableMinor = billableTotalMinor(project.contract, project.milestones);
  const receivedMinor = total[0]?.total ?? 0;
  return {
    project: { id: String(project._id), ref: project.ref, name: project.name, archived: Boolean(project.archivedAt) },
    client: { id: String(project.clientId), name: project.clientName },
    contractCurrency: project.contract.currency,
    pricingModel: project.contract.pricingModel,
    billableMinor,
    receivedMinor,
    outstandingMinor: billableMinor - receivedMinor,
    milestones: project.milestones.map((m) => ({
      id: String(m._id),
      title: m.title,
      amountMinor: m.amountMinor,
      dueOn: m.dueOn ? ymd(m.dueOn) : null,
      status: m.status as MilestoneStatus,
      receivedMinor: byMilestone.get(String(m._id)) ?? 0,
    })),
  };
}


/* --------------------------------------------------- filter labels for the page */

/**
 * The names behind the client and project filters in the URL, so the list page can show which client or
 * project it is narrowed to. Needs payment:view only: the names are the ones every row already shows.
 */
export async function getFilterLabels(
  viewer: SessionUser,
  ids: { clientId?: string; projectId?: string },
): Promise<{ client: { id: string; label: string } | null; project: { id: string; label: string; ref: string } | null }> {
  assertCapability(viewer, 'payment:view');
  await connectToDatabase();
  const [client, project] = await Promise.all([
    ids.clientId ? Client.findById(parseObjectId(ids.clientId)).select('name').lean() : null,
    ids.projectId ? Project.findById(parseObjectId(ids.projectId)).select('name ref').lean() : null,
  ]);
  return {
    client: client ? { id: String(client._id), label: client.name } : null,
    project: project ? { id: String(project._id), label: project.name, ref: project.ref } : null,
  };
}
