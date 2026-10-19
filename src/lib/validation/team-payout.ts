import { z } from 'zod';
import { PAYOUT_STATUSES, TEAM_PAYOUT_BASES } from '@/config/statuses';
import { first, objectIdParam, oneOf, type RawSearchParams } from '@/lib/admin/search-params';
import { parseDateOnly } from '@/lib/dates/date-only';
import { objectIdSchema } from './common';
import { currencySchema, fxPayloadFields } from './fx';
import { MAX_MINOR } from './project';
import { dateOnlySchema } from './task';

/**
 * Team payout schemas, shared by the forms and the routes and parsed again inside the service, so a
 * direct caller cannot skip a rule. Dates travel as "YYYY-MM-DD". Amounts are integer minor units
 * of the payout's own currency; the INR value and the allocations' INR shares are computed on the
 * server and are never accepted from a client.
 */

export type TeamPayoutBasis = (typeof TEAM_PAYOUT_BASES)[number];

/** The longest period one payout may cover. Paying a financial year in one go is allowed; ten years is a typo. */
export const MAX_PERIOD_DAYS = 366;
/** The most projects one payout can be split across. */
export const MAX_ALLOCATIONS = 50;

/**
 * What a pay profile's basis means as a payout basis. Monthly pay is a salary, hourly pay is hours,
 * per-task pay is tasks. "No pay basis" proposes nothing, so it maps to nothing.
 */
export function payoutBasisFor(payBasis: string): TeamPayoutBasis | null {
  if (payBasis === 'monthly') return 'salary';
  if (payBasis === 'hourly') return 'hours';
  if (payBasis === 'per_task') return 'tasks';
  return null;
}

/** `objectIdSchema` accepts both spellings of a hex id; identity checks need exactly one. */
const lowerId = objectIdSchema.transform((v) => v.toLowerCase());

const minor = z
  .number({ error: 'Enter an amount' })
  .int({ error: 'The amount must be a whole number of minor units' })
  .min(1, { error: 'Enter an amount above zero' })
  .max(MAX_MINOR, { error: 'That amount is too large' });

const note = z.string().trim().max(1000, { error: 'Keep the note under 1,000 characters' });

/** One project's share of the payout, in the payout's currency. Client and minutes are derived on the server. */
export const allocationInputSchema = z
  .object({
    projectId: lowerId,
    /** Never trusted: derived from the project. Accepted only so a disagreeing value can be rejected as LINK_MISMATCH. */
    clientId: lowerId.optional(),
    amountMinor: minor,
  })
  .strict();
export type AllocationInput = z.infer<typeof allocationInputSchema>;

const allocations = z.array(allocationInputSchema).max(MAX_ALLOCATIONS, { error: `Split a payout across at most ${MAX_ALLOCATIONS} projects` });

type Refinable = { manualRate?: number; settledInrMinor?: number; periodFrom?: string; periodTo?: string; allocations?: ReadonlyArray<{ projectId: string }> };

/** Rules that look across fields. Shared by create and update; an update may send only one end of the period. */
function crossChecks(v: Refinable, ctx: z.RefinementCtx): void {
  if (v.manualRate !== undefined && v.settledInrMinor !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['manualRate'], message: 'Give either the exact rate or the INR amount that arrived, not both' });
  }
  if (v.periodFrom !== undefined && v.periodTo !== undefined) {
    const from = parseDateOnly(v.periodFrom);
    const to = parseDateOnly(v.periodTo);
    if (from && to) {
      if (to < from) ctx.addIssue({ code: 'custom', path: ['periodTo'], message: 'The period cannot end before it starts' });
      else if ((to.getTime() - from.getTime()) / 86_400_000 + 1 > MAX_PERIOD_DAYS) {
        ctx.addIssue({ code: 'custom', path: ['periodTo'], message: `A payout covers at most ${MAX_PERIOD_DAYS} days. Split a longer period into several payouts.` });
      }
    }
  }
  if (v.allocations) {
    const seen = new Set<string>();
    v.allocations.forEach((a, i) => {
      if (seen.has(a.projectId)) ctx.addIssue({ code: 'custom', path: ['allocations', i, 'projectId'], message: 'This project is already in the split' });
      seen.add(a.projectId);
    });
  }
}

export const createTeamPayoutSchema = z
  .object({
    adminId: lowerId,
    basis: z.enum(TEAM_PAYOUT_BASES, { error: 'Pick what this payout is for' }),
    periodFrom: dateOnlySchema,
    periodTo: dateOnlySchema,
    amountMinor: minor,
    currency: currencySchema,
    /** When it is due. Leave out for today (the organisation's today). The rate is captured for this date. */
    dueOn: dateOnlySchema.optional(),
    note: note.optional(),
    /** The split across projects. Empty means all of it is company overhead. */
    allocations: allocations.default([]),
    ...fxPayloadFields,
  })
  .strict()
  .superRefine(crossChecks);

/**
 * A due payout is edited in place. The person cannot change: void it and record a new one. Anything
 * left out stays as it is; `note: ""` clears the note. Sending `allocations` replaces the whole split.
 */
export const updateTeamPayoutSchema = z
  .object({
    basis: z.enum(TEAM_PAYOUT_BASES, { error: 'Pick what this payout is for' }).optional(),
    periodFrom: dateOnlySchema.optional(),
    periodTo: dateOnlySchema.optional(),
    amountMinor: minor.optional(),
    currency: currencySchema.optional(),
    dueOn: dateOnlySchema.optional(),
    note: note.optional(),
    allocations: allocations.optional(),
    ...fxPayloadFields,
  })
  .strict()
  .superRefine(crossChecks)
  .refine((v) => Object.keys(v).length > 0, { error: 'Nothing to update' });

/**
 * Marking paid needs the paid date, how it was paid and the transaction reference. The exchange
 * rate is captured again for the paid date (table rate, or the exact rate, or the INR that left the
 * account), because that is when the money moved.
 */
export const markPaidSchema = z
  .object({
    paidOn: dateOnlySchema,
    mode: z.string({ error: 'Pick how it was paid' }).trim().min(1, { error: 'Pick how it was paid' }).max(40),
    transactionRef: z.string({ error: 'Enter the transaction reference' }).trim().min(1, { error: 'Enter the transaction reference' }).max(120, { error: 'Keep the reference under 120 characters' }),
    note: note.optional(),
    ...fxPayloadFields,
  })
  .strict()
  .superRefine(crossChecks);

export const voidPayoutSchema = z
  .object({ reason: z.string({ error: 'Give a reason' }).trim().min(3, { error: 'Give a reason' }).max(300, { error: 'Keep the reason under 300 characters' }) })
  .strict();

/** GET /api/admin/team-payouts/suggestion */
export const suggestionQuerySchema = z
  .object({ adminId: lowerId, from: dateOnlySchema, to: dateOnlySchema })
  .strict()
  .superRefine((v, ctx) => {
    const from = parseDateOnly(v.from);
    const to = parseDateOnly(v.to);
    if (from && to) {
      if (to < from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'The period cannot end before it starts' });
      else if ((to.getTime() - from.getTime()) / 86_400_000 + 1 > MAX_PERIOD_DAYS) {
        ctx.addIssue({ code: 'custom', path: ['to'], message: `A payout covers at most ${MAX_PERIOD_DAYS} days` });
      }
    }
  });

export const PAYOUT_SORTS = ['createdAt', 'dueOn', 'paidOn', 'amount', 'person'] as const;
export type PayoutSort = (typeof PAYOUT_SORTS)[number];

/** GET /api/admin/team-payouts. Empty values are dropped by the route before this runs. */
export const payoutListQuerySchema = z
  .object({
    adminId: lowerId.optional(),
    status: z.enum(PAYOUT_STATUSES, { error: 'Pick due, paid or void' }).optional(),
    q: z.string().trim().max(80, { error: 'Search for at most 80 characters' }).optional(),
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
    sort: z.enum(PAYOUT_SORTS).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
  })
  .strict();

export type CreateTeamPayoutInput = z.input<typeof createTeamPayoutSchema>;
export type UpdateTeamPayoutInput = z.input<typeof updateTeamPayoutSchema>;
export type MarkPaidInput = z.input<typeof markPaidSchema>;
export type VoidPayoutInput = z.infer<typeof voidPayoutSchema>;
export type SuggestionQuery = z.infer<typeof suggestionQuerySchema>;

/** The filters of the payouts list, from URL params. Anything malformed is ignored, never an error page. */
export interface PayoutFilter {
  adminId?: string;
  status?: (typeof PAYOUT_STATUSES)[number];
  q?: string;
}

export function parsePayoutFilter(sp: RawSearchParams): PayoutFilter {
  const filter: PayoutFilter = {};
  const adminId = objectIdParam(sp, 'adminId');
  if (adminId) filter.adminId = adminId;
  const status = oneOf(sp, 'status', PAYOUT_STATUSES);
  if (status) filter.status = status;
  const q = first(sp, 'q');
  if (q) filter.q = q.slice(0, 80);
  return filter;
}
