import { z } from 'zod';
import { CURRENCY_CODES, isCurrencyCode } from '@/config/currencies';
import {
  MILESTONE_STATUSES,
  PRICING_MODELS,
  PRIORITIES,
  PROJECT_HEALTH,
  PROJECT_STATUSES,
  PROJECT_TRANSITIONS,
  PROJECT_TYPES,
  type ProjectStatus,
} from '@/config/statuses';
import { parseDateOnly } from '@/lib/dates/date-only';
import { objectIdSchema } from './common';

/**
 * Project schemas, shared by the forms and the route handlers, and the pure status rules the
 * service enforces and the status dialog uses to decide what to offer. No database in here.
 */

/** Largest amount a form may send, in minor units (INR 10 billion). Keeps INR conversion inside safe integers. */
export const MAX_MINOR = 1_000_000_000_000;
export const MAX_MILESTONES = 50;

/** Statuses in which work is under way: overdue and health only mean something here. */
export const WORKING_STATUSES: readonly ProjectStatus[] = ['active', 'in_review', 'on_hold'];

const dateOnly = z.string({ error: 'Enter a date' }).refine((v) => parseDateOnly(v) !== null, { error: 'Enter a valid date' });

/** http(s) only: these render as links, and a `javascript:` address must never get through. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** A web address, or an empty string to clear it. */
const link = z
  .string()
  .trim()
  .max(300, { error: 'That address is too long' })
  .refine((v) => v === '' || isHttpUrl(v), { error: 'Enter a full web address starting with https://' });

const name = z.string({ error: 'Name is required' }).trim().min(2, { error: 'Name is required' }).max(140, { error: 'Name is too long' });
const scope = z.string().trim().max(4000, { error: 'Keep the summary under 4,000 characters' });
const tags = z.array(z.string().trim().min(1).max(40)).max(20, { error: 'Up to 20 tags' });
const amount = z.number({ error: 'Enter an amount' }).int({ error: 'Whole minor units only' }).min(0).max(MAX_MINOR, { error: 'That amount is too large' });
const currency = z
  .string({ error: 'Pick a currency' })
  .trim()
  .toUpperCase()
  .refine((v) => isCurrencyCode(v), { error: 'Pick a currency' });

const links = z
  .object({ repo: link.optional(), staging: link.optional(), live: link.optional(), design: link.optional() })
  .strict();

const contract = z
  .object({
    pricingModel: z.enum(PRICING_MODELS, { error: 'Pick a pricing model' }),
    /** Zero is allowed: hourly and retainer projects bill by milestone or rate. */
    amountMinor: amount,
    currency,
    hourlyRateMinor: amount.nullable().optional(),
    retainerMonthlyMinor: amount.nullable().optional(),
  })
  .strict();

const contractPatch = contract.partial();

function deadlineAfterStart<T extends { startOn?: string | null; deadlineOn?: string | null }>(v: T): boolean {
  if (!v.startOn || !v.deadlineOn) return true;
  return v.deadlineOn >= v.startOn; // YYYY-MM-DD compares correctly as text
}
const deadlineMessage = { error: 'The deadline cannot be before the start date', path: ['deadlineOn'] };

export const createProjectSchema = z
  .object({
    clientId: objectIdSchema,
    name,
    type: z.enum(PROJECT_TYPES, { error: 'Pick a project type' }),
    /** A project starts as a proposal, or straight as active (which captures the agreed snapshot). */
    status: z.enum(['proposal', 'active']).optional(),
    health: z.enum(PROJECT_HEALTH).optional(),
    priority: z.enum(PRIORITIES).optional(),
    leadId: objectIdSchema.optional(),
    memberIds: z.array(objectIdSchema).max(50).optional(),
    startOn: dateOnly.optional(),
    deadlineOn: dateOnly.optional(),
    contract: contract.optional(),
    costBudgetInrMinor: amount.optional(),
    scopeSummary: scope.optional(),
    links: links.optional(),
    tags: tags.optional(),
  })
  .strict()
  .refine(deadlineAfterStart, deadlineMessage);

export const updateProjectSchema = z
  .object({
    clientId: objectIdSchema.optional(),
    name: name.optional(),
    type: z.enum(PROJECT_TYPES).optional(),
    health: z.enum(PROJECT_HEALTH).optional(),
    priority: z.enum(PRIORITIES).optional(),
    leadId: objectIdSchema.nullable().optional(),
    memberIds: z.array(objectIdSchema).max(50).optional(),
    startOn: dateOnly.nullable().optional(),
    deadlineOn: dateOnly.nullable().optional(),
    contract: contractPatch.optional(),
    costBudgetInrMinor: amount.nullable().optional(),
    scopeSummary: scope.nullable().optional(),
    links: links.optional(),
    tags: tags.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'Nothing to update' })
  .refine(deadlineAfterStart, deadlineMessage);

export const statusChangeSchema = z
  .object({
    to: z.enum(PROJECT_STATUSES, { error: 'Pick a status' }),
    note: z.string().trim().max(500, { error: 'Keep the note under 500 characters' }).optional(),
  })
  .strict();

const milestoneTitle = z.string({ error: 'Give the milestone a title' }).trim().min(2, { error: 'Give the milestone a title' }).max(120);
const milestoneAmount = z.number({ error: 'Enter an amount' }).int({ error: 'Whole minor units only' }).min(1, { error: 'The amount must be above zero' }).max(MAX_MINOR, { error: 'That amount is too large' });
const invoiceRef = z.string().trim().max(60);

export const createMilestoneSchema = z
  .object({
    title: milestoneTitle,
    amountMinor: milestoneAmount,
    dueOn: dateOnly.optional(),
    invoiceRef: invoiceRef.optional(),
  })
  .strict();

export const updateMilestoneSchema = z
  .object({
    title: milestoneTitle.optional(),
    amountMinor: milestoneAmount.optional(),
    dueOn: dateOnly.nullable().optional(),
    status: z.enum(MILESTONE_STATUSES).optional(),
    invoiceRef: invoiceRef.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'Nothing to update' });

export const archiveSchema = z.object({ reason: z.string().trim().max(300).optional() }).strict();

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type StatusChangeInput = z.infer<typeof statusChangeSchema>;
export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>;
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneSchema>;
export type ArchiveInput = z.infer<typeof archiveSchema>;
export type ContractInput = z.infer<typeof contract>;
export type ContractPatchInput = z.infer<typeof contractPatch>;

export { CURRENCY_CODES };

/* ---- status rules (plan section 3, "Status transitions") ---- */

export function allowedMoves(from: ProjectStatus): readonly ProjectStatus[] {
  return PROJECT_TRANSITIONS[from];
}

export function isAllowedMove(from: ProjectStatus, to: ProjectStatus): boolean {
  return PROJECT_TRANSITIONS[from].includes(to);
}

/** Going back to active from a finished state: delivered, closed or cancelled. */
export function isReopen(from: ProjectStatus, to: ProjectStatus): boolean {
  return to === 'active' && (from === 'delivered' || from === 'closed' || from === 'cancelled');
}

/** Moving to on hold or cancelled, and any reopen, must say why. */
export function moveNeedsNote(from: ProjectStatus, to: ProjectStatus): boolean {
  return to === 'on_hold' || to === 'cancelled' || isReopen(from, to);
}

/** Reopening a closed or cancelled project is for superadmins only. Delivered back to active is not. */
export function moveNeedsSuperadmin(from: ProjectStatus, to: ProjectStatus): boolean {
  return to === 'active' && (from === 'closed' || from === 'cancelled');
}
