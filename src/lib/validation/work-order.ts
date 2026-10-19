import { z } from 'zod';
import { WORK_ORDER_STATUSES } from '@/config/statuses';
import { first, objectIdParam, oneOf, type RawSearchParams } from '@/lib/admin/search-params';
import { dateOnlyString, currencySchema } from './fx';
import { objectIdSchema } from './common';

/**
 * Work orders: what we agreed to pay a third party for a client's project. The CLIENT is never taken
 * from the request (it follows the project); a `clientId` is accepted only so a value that
 * disagrees can be refused as LINK_MISMATCH. The cached `paidMinor` and `dueMinor` are not writable:
 * only the payout service sets them.
 */
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

/** Whole minor units above zero. */
export const amountMinorSchema = z
  .number({ error: 'Enter an amount' })
  .int({ error: 'Enter an amount' })
  .positive({ error: 'Enter an amount above zero' })
  .max(1_000_000_000_000, { error: 'That amount is too large' }); // keeps INR conversion and dashboard sums inside safe integers

const title = z.string({ error: 'Give the work order a title' }).trim().min(2, { error: 'Give the work order a title' }).max(200, { error: 'That title is too long' });
const scope = z.string().trim().max(4000, { error: 'Keep the scope under 4000 characters' });
const note = z.string().trim().min(3, { error: 'Give a reason (at least 3 characters)' }).max(500);

export const createWorkOrderSchema = z
  .object({
    thirdPartyId: objectIdSchema,
    projectId: objectIdSchema,
    /** Never trusted: derived from the project. */
    clientId: objectIdSchema.optional(),
    taskId: objectIdSchema.nullable().optional(),
    title,
    scope: scope.optional(),
    amountMinor: amountMinorSchema,
    currency: currencySchema,
    dueOn: dateOnlyString.optional(),
  })
  .strict();

/**
 * The third party and the project are what a work order IS: to change either, cancel it and raise a
 * new one. The currency can change only while no payout exists.
 */
export const updateWorkOrderSchema = z
  .object({
    title: title.optional(),
    scope: scope.nullable().optional(),
    amountMinor: amountMinorSchema.optional(),
    currency: currencySchema.optional(),
    dueOn: dateOnlyString.nullable().optional(),
    taskId: objectIdSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'Nothing to update' });

export const workOrderStatusSchema = z.object({ status: z.enum(WORK_ORDER_STATUSES, { error: 'Pick a status' }), note: note.optional() }).strict();

export type CreateWorkOrderBody = z.infer<typeof createWorkOrderSchema>;
export type CreateWorkOrderInput = z.input<typeof createWorkOrderSchema>;
export type UpdateWorkOrderInput = z.infer<typeof updateWorkOrderSchema>;
export type WorkOrderStatusInput = z.infer<typeof workOrderStatusSchema>;

/**
 * Allowed moves. Cancelling and reopening (moving back to open) need a note; the service enforces
 * both, and refuses to cancel while a payout that is paid or still due refers to the work order.
 */
export const WORK_ORDER_TRANSITIONS: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  open: ['delivered', 'closed', 'cancelled'],
  delivered: ['open', 'closed', 'cancelled'],
  closed: ['open'],
  cancelled: ['open'],
};

/** Work orders that still have something left to do or to pay. */
export const CURRENT_STATUSES: readonly WorkOrderStatus[] = ['open', 'delivered'];

export const WORK_ORDER_SORTS = ['updatedAt', 'createdAt', 'dueOn', 'ref', 'title'] as const;
export type WorkOrderSort = (typeof WORK_ORDER_SORTS)[number];

export interface WorkOrderFilter {
  q?: string;
  /** A status, or `current` for open and delivered together. */
  status?: WorkOrderStatus | 'current';
  thirdPartyId?: string;
  projectId?: string;
  clientId?: string;
}

/** Reads the work-order filters from URL params, defensively: a bad value is ignored, never an error page. */
export function parseWorkOrderFilter(sp: RawSearchParams): WorkOrderFilter {
  const filter: WorkOrderFilter = {};
  const q = first(sp, 'q');
  if (q) filter.q = q.slice(0, 100);
  const status = oneOf(sp, 'status', [...WORK_ORDER_STATUSES, 'current'] as const);
  if (status) filter.status = status;
  const thirdPartyId = objectIdParam(sp, 'thirdParty');
  if (thirdPartyId) filter.thirdPartyId = thirdPartyId;
  const projectId = objectIdParam(sp, 'project');
  if (projectId) filter.projectId = projectId;
  const clientId = objectIdParam(sp, 'client');
  if (clientId) filter.clientId = clientId;
  return filter;
}
