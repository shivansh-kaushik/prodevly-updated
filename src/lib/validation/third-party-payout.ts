import { z } from 'zod';
import { PAYOUT_STATUSES } from '@/config/statuses';
import { first, objectIdParam, oneOf, type RawSearchParams } from '@/lib/admin/search-params';
import { currencySchema, dateOnlyString, fxPayloadFields } from './fx';
import { objectIdSchema } from './common';
import { amountMinorSchema } from './work-order';

/**
 * Third-party payouts. A payout is recorded as DUE; a superadmin marks it paid (which re-captures the
 * exchange rate for the day the money left) or voids it with a reason. With a work order the client,
 * project and task are COPIED from it, so a request that names a different one is refused as
 * LINK_MISMATCH and a different currency as CURRENCY_MISMATCH (both checked by the service).
 */
const note = z.string().trim().max(1000, { error: 'Keep the note under 1000 characters' });
const tdsMinor = z.number({ error: 'Enter the TDS amount' }).int({ error: 'Enter the TDS amount' }).min(0, { error: 'TDS cannot be negative' }).max(Number.MAX_SAFE_INTEGER);
const attachments = z.array(objectIdSchema).max(10, { error: 'At most 10 attachments' });

const exclusiveFx = <T extends { manualRate?: number; settledInrMinor?: number }>(v: T) => !(v.manualRate !== undefined && v.settledInrMinor !== undefined);
const exclusiveFxMessage = { error: 'Give either the exact rate or the INR amount that left the account, not both', path: ['manualRate'] };

export const createPayoutSchema = z
  .object({
    /** Required without a work order; with one it must be the work order's own third party. */
    thirdPartyId: objectIdSchema.optional(),
    workOrderId: objectIdSchema.optional(),
    /** Never trusted: derived from the project (or copied from the work order). */
    clientId: objectIdSchema.optional(),
    projectId: objectIdSchema.optional(),
    taskId: objectIdSchema.nullable().optional(),
    amountMinor: amountMinorSchema,
    /** Required without a work order; with one it must equal the work order's currency. */
    currency: currencySchema.optional(),
    /** The day it falls due. The first exchange-rate capture is for this day. Defaults to today. */
    dueOn: dateOnlyString.optional(),
    /** TDS withheld out of the amount. The amount stays the full cost. */
    tdsMinor: tdsMinor.optional(),
    note: note.optional(),
    attachmentMediaIds: attachments.default([]),
    ...fxPayloadFields,
  })
  .strict()
  .refine(exclusiveFx, exclusiveFxMessage);

/** Only while the payout is due. Who it is for and which project it belongs to are not editable: void it and record a new one. */
export const updatePayoutSchema = z
  .object({
    amountMinor: amountMinorSchema.optional(),
    currency: currencySchema.optional(),
    dueOn: dateOnlyString.optional(),
    tdsMinor: tdsMinor.nullable().optional(),
    note: note.nullable().optional(),
    taskId: objectIdSchema.nullable().optional(),
    attachmentMediaIds: attachments.optional(),
    ...fxPayloadFields,
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'Nothing to update' })
  .refine(exclusiveFx, exclusiveFxMessage);

export const markPaidSchema = z
  .object({
    /** The day the money left the account. Not in the future. */
    paidOn: dateOnlyString,
    mode: z.string({ error: 'Pick how it was paid' }).trim().min(2, { error: 'Pick how it was paid' }).max(40),
    transactionRef: z.string().trim().max(120).optional(),
    /** A transfer confirmation, added to whatever is already attached. */
    attachmentMediaIds: attachments.optional(),
    ...fxPayloadFields,
  })
  .strict()
  .refine(exclusiveFx, exclusiveFxMessage);

export const voidPayoutSchema = z
  .object({ reason: z.string({ error: 'Give a reason' }).trim().min(3, { error: 'Give a reason (at least 3 characters)' }).max(300, { error: 'Keep the reason under 300 characters' }) })
  .strict();

export type CreatePayoutBody = z.infer<typeof createPayoutSchema>;
export type CreatePayoutInput = z.input<typeof createPayoutSchema>;
export type UpdatePayoutInput = z.infer<typeof updatePayoutSchema>;
export type MarkPaidInput = z.infer<typeof markPaidSchema>;
export type VoidPayoutInput = z.infer<typeof voidPayoutSchema>;

export const PAYOUT_SORTS = ['dueOn', 'paidOn', 'createdAt', 'updatedAt', 'ref'] as const;
export type PayoutSort = (typeof PAYOUT_SORTS)[number];

export interface PayoutFilter {
  q?: string;
  status?: (typeof PAYOUT_STATUSES)[number];
  /** Due and past its due date. */
  overdue?: boolean;
  thirdPartyId?: string;
  workOrderId?: string;
  projectId?: string;
  clientId?: string;
}

/** Reads the payout filters from URL params, defensively: a bad value is ignored, never an error page. */
export function parsePayoutFilter(sp: RawSearchParams): PayoutFilter {
  const filter: PayoutFilter = {};
  const q = first(sp, 'q');
  if (q) filter.q = q.slice(0, 100);
  const status = oneOf(sp, 'status', PAYOUT_STATUSES);
  if (status) filter.status = status;
  if (first(sp, 'overdue') === '1') filter.overdue = true;
  const thirdPartyId = objectIdParam(sp, 'thirdParty');
  if (thirdPartyId) filter.thirdPartyId = thirdPartyId;
  const workOrderId = objectIdParam(sp, 'workOrder');
  if (workOrderId) filter.workOrderId = workOrderId;
  const projectId = objectIdParam(sp, 'project');
  if (projectId) filter.projectId = projectId;
  const clientId = objectIdParam(sp, 'client');
  if (clientId) filter.clientId = clientId;
  return filter;
}
