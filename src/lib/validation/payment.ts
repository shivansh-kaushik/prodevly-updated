import { z } from 'zod';
import { PAYMENT_STATUSES, PAYMENT_TYPES } from '@/config/statuses';
import { first, objectIdParam, oneOf, type RawSearchParams } from '@/lib/admin/search-params';
import { objectIdSchema } from './common';
import { currencySchema, dateOnlyString, fxPayloadFields } from './fx';
import { MAX_MINOR } from './project';

/**
 * Client payment schemas, shared by the payment form, the routes and the service (which parses again,
 * because a service can be called without a route in front of it). No database in here.
 *
 * The client NEVER sends an INR value, a rate source or a client id that counts: the server derives the
 * client from the project and the INR value from the rate (`resolveFx`). `clientId` is accepted only so a
 * disagreeing value can be refused as LINK_MISMATCH.
 */

export const MAX_ATTACHMENTS = 10;
/** Dates before this are a typo (0202 for 2020), not a payment. */
export const EARLIEST_RECEIVED_ON = '2000-01-01';

/** A lowercase hex id: a hex id has two spellings and every comparison downstream is on the lowercase one. */
const id = objectIdSchema.transform((v) => v.toLowerCase());

const amountMinor = z
  .number({ error: 'Enter an amount' })
  .int({ error: 'Enter a whole number of minor units' })
  .min(1, { error: 'Enter an amount above zero' })
  .max(MAX_MINOR, { error: 'That amount is too large' });

/** TDS and charges: zero is fine (and means "none"). */
const sideAmount = z
  .number({ error: 'Enter an amount' })
  .int({ error: 'Enter a whole number of minor units' })
  .min(0, { error: 'The amount cannot be negative' })
  .max(MAX_MINOR, { error: 'That amount is too large' });

const receivedOn = dateOnlyString.refine((v) => v >= EARLIEST_RECEIVED_ON, { error: 'That date is too far in the past' });

const mode = z.string({ error: 'Pick how it was paid' }).trim().min(1, { error: 'Pick how it was paid' }).max(40, { error: 'That mode is too long' });
const transactionRef = z.string().trim().max(120, { error: 'Keep the transaction reference under 120 characters' });
const invoiceRef = z.string().trim().max(60, { error: 'Keep the invoice reference under 60 characters' });
const note = z.string().trim().max(1000, { error: 'Keep the note under 1,000 characters' });

/** On create an empty text field means "not given". */
const optionalText = (schema: z.ZodString) => schema.optional().transform((v) => (v ? v : undefined));
/** On edit an empty text field (or null) clears the value; undefined leaves it alone. */
const clearableText = (schema: z.ZodString) => schema.nullable().optional().transform((v) => (v === '' ? null : v));

const eitherRate = {
  error: 'Give either the exact rate or the INR amount that arrived, not both',
  path: ['manualRate'],
};

const recordShape = {
  /** A refund reduces what counts as received. */
  type: z.enum(PAYMENT_TYPES, { error: 'Pick receipt or refund' }).default('receipt'),
  projectId: id,
  /** Never trusted: derived from the project. Accepted only so a disagreeing value is refused. */
  clientId: id.optional(),
  taskId: id.nullable().optional(),
  milestoneId: id.nullable().optional(),
  amountMinor,
  currency: currencySchema,
  receivedOn,
  ...fxPayloadFields,
  /** The amount in the project's contract currency, to correct what the exchange rates give. Only for another currency. */
  contractEquivalentMinor: amountMinor.optional(),
  tdsMinor: sideAmount.optional(),
  chargesMinor: sideAmount.optional(),
  mode,
  transactionRef: optionalText(transactionRef),
  invoiceRef: optionalText(invoiceRef),
  note: optionalText(note),
  attachmentMediaIds: z.array(id).max(MAX_ATTACHMENTS, { error: `At most ${MAX_ATTACHMENTS} files` }).default([]),
  /** Superadmins only (money:approve): allows the total received to go above what is billable. */
  recordAsAdvance: z.boolean().optional(),
};

export const recordPaymentSchema = z
  .object(recordShape)
  .strict()
  .refine((v) => !(v.manualRate !== undefined && v.settledInrMinor !== undefined), eitherRate);

/**
 * What an edit may change. The type does not (a receipt does not become a refund: void it and record the
 * other). `null` clears an optional field; a field left out stays as it is.
 */
export const updatePaymentSchema = z
  .object({
    projectId: id.optional(),
    clientId: id.optional(),
    taskId: id.nullable().optional(),
    milestoneId: id.nullable().optional(),
    amountMinor: amountMinor.optional(),
    currency: currencySchema.optional(),
    receivedOn: receivedOn.optional(),
    ...fxPayloadFields,
    /** Take the rate from the rate table again, even if the entry was made with a rate typed by hand. */
    useTableRate: z.literal(true).optional(),
    contractEquivalentMinor: amountMinor.optional(),
    tdsMinor: sideAmount.nullable().optional(),
    chargesMinor: sideAmount.nullable().optional(),
    mode: mode.optional(),
    transactionRef: clearableText(transactionRef),
    invoiceRef: clearableText(invoiceRef),
    note: clearableText(note),
    attachmentMediaIds: z.array(id).max(MAX_ATTACHMENTS, { error: `At most ${MAX_ATTACHMENTS} files` }).optional(),
    recordAsAdvance: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'Nothing to update' })
  .refine((v) => !(v.manualRate !== undefined && v.settledInrMinor !== undefined), eitherRate)
  .refine((v) => !(v.useTableRate && (v.manualRate !== undefined || v.settledInrMinor !== undefined)), {
    error: 'Choose the table rate, or give a rate, not both',
    path: ['manualRate'],
  });

/** A void says why. It is the audit log's explanation, so a word is not enough. */
export const voidPaymentSchema = z
  .object({
    reason: z.string({ error: 'Give a reason' }).trim().min(3, { error: 'Give a reason (at least 3 characters)' }).max(300, { error: 'Keep the reason under 300 characters' }),
  })
  .strict();

export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;
export type RecordPaymentBody = z.infer<typeof recordPaymentSchema>;
export type UpdatePaymentInput = z.input<typeof updatePaymentSchema>;
export type UpdatePaymentBody = z.infer<typeof updatePaymentSchema>;
export type VoidPaymentBody = z.infer<typeof voidPaymentSchema>;

export const PAYMENT_SORT_KEYS = ['receivedOn', 'createdAt', 'amount', 'ref'] as const;
export type PaymentSortKey = (typeof PAYMENT_SORT_KEYS)[number];

/** GET /api/admin/payments: filters, sort and paging as query-string text. Empty values are dropped before this runs. */
export const paymentListQuerySchema = z.object({
  q: z.string().trim().max(100, { error: 'Search for at most 100 characters' }).optional(),
  clientId: id.optional(),
  projectId: id.optional(),
  taskId: id.optional(),
  status: z.enum(PAYMENT_STATUSES, { error: 'Pick received or void' }).optional(),
  type: z.enum(PAYMENT_TYPES, { error: 'Pick receipt or refund' }).optional(),
  mode: z.string().trim().max(40).optional(),
  currency: currencySchema.optional(),
  from: dateOnlyString.optional(),
  to: dateOnlyString.optional(),
  sort: z.enum(PAYMENT_SORT_KEYS, { error: 'Pick a column to sort by' }).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;

/** The filters the page reads from the URL, defensively: a bad value is ignored, never an error page. */
export interface PageFilters {
  q?: string;
  clientId?: string;
  projectId?: string;
  status?: (typeof PAYMENT_STATUSES)[number];
  type?: (typeof PAYMENT_TYPES)[number];
  mode?: string;
  currency?: string;
}

export function parsePaymentFilters(sp: RawSearchParams): PageFilters {
  const out: PageFilters = {};
  const q = first(sp, 'q');
  if (q) out.q = q.slice(0, 100);
  const clientId = objectIdParam(sp, 'client');
  if (clientId) out.clientId = clientId;
  const projectId = objectIdParam(sp, 'project');
  if (projectId) out.projectId = projectId;
  const status = oneOf(sp, 'status', PAYMENT_STATUSES);
  if (status) out.status = status;
  const type = oneOf(sp, 'type', PAYMENT_TYPES);
  if (type) out.type = type;
  const mode = first(sp, 'mode');
  if (mode && /^[a-z0-9_]{1,40}$/i.test(mode)) out.mode = mode;
  const currency = first(sp, 'currency');
  if (currency && /^[A-Za-z]{3}$/.test(currency)) out.currency = currency.toUpperCase();
  return out;
}
