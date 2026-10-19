import { z } from 'zod';
import { EXPENSE_PAID_FROM, EXPENSE_SCOPES, EXPENSE_STATUSES } from '@/config/statuses';
import { first, objectIdParam, oneOf, type RawSearchParams } from '@/lib/admin/search-params';
import { parseDateOnly } from '@/lib/dates/date-only';
import type { ExpenseFilter, ExpenseSort } from '@/services/expense.service';
import { objectIdSchema } from './common';
import { currencySchema, dateOnlyString, fxPayloadFields } from './fx';

/**
 * Expense schemas, shared by the form, the routes and the service (which parses again, so a caller that
 * skips the route cannot skip the rules). Dates are "YYYY-MM-DD" and become UTC midnight in the service.
 * Names and links are never taken from the client: the service derives the client from the project and
 * the project from the task, and the INR value comes from `resolveFx`, never from a request.
 *
 * Two kinds of expense start here (docs/plan section 3, Expenses flow):
 *   paidFrom "company"  recorded directly as PAID by someone with expense:record (needs paidOn and mode)
 *   paidFrom "admin"    an out-of-pocket expense SUBMITTED for reimbursement (the submitter is the payer)
 */

const amountMinor = z
  .number({ error: 'Enter an amount' })
  .int({ error: 'Enter a whole number of minor units' })
  .positive({ error: 'Enter an amount above zero' });

const category = z.string({ error: 'Pick a category' }).trim().min(1, { error: 'Pick a category' }).max(60);
const description = z.string({ error: 'Say what this was for' }).trim().min(2, { error: 'Say what this was for' }).max(500, { error: 'That description is too long' });
const payee = z.string().trim().max(120, { error: 'That name is too long' });
const mode = z.string({ error: 'Pick how it was paid' }).trim().min(1, { error: 'Pick how it was paid' }).max(40);
const transactionRef = z.string().trim().max(120, { error: 'That reference is too long' });
const reason = z.string({ error: 'Give a reason' }).trim().min(3, { error: 'Give a reason (at least 3 characters)' }).max(300, { error: 'Keep the reason under 300 characters' });

/** Receipts are private media uploaded for expenses; the service verifies each id inside the transaction. */
const receiptMediaIds = z.array(objectIdSchema).max(10, { error: 'Attach at most 10 receipts' });

const COMPANY_LINK_ERROR = 'A company expense is not charged to a client, project or task';

export const createExpenseSchema = z
  .object({
    scope: z.enum(EXPENSE_SCOPES, { error: 'Say whether this is a company or a project expense' }),
    /** Never trusted: derived from the project. Accepted only so a disagreeing value can be rejected as LINK_MISMATCH. */
    clientId: objectIdSchema.optional(),
    projectId: objectIdSchema.optional(),
    taskId: objectIdSchema.optional(),
    category,
    description,
    payee: payee.optional(),
    amountMinor,
    currency: currencySchema,
    spentOn: dateOnlyString,
    ...fxPayloadFields,
    paidFrom: z.enum(EXPENSE_PAID_FROM, { error: 'Say who paid' }),
    /** Company-paid only: the date the company paid, and how. */
    paidOn: dateOnlyString.optional(),
    mode: mode.optional(),
    transactionRef: transactionRef.optional(),
    receiptMediaIds: receiptMediaIds.default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    const add = (path: string, message: string) => ctx.addIssue({ code: 'custom', message, path: [path] });
    if (v.manualRate !== undefined && v.settledInrMinor !== undefined) add('manualRate', 'Give either the exact rate or the INR amount that arrived, not both');
    if (v.scope === 'company' && (v.clientId || v.projectId || v.taskId)) add('scope', COMPANY_LINK_ERROR);
    if (v.scope === 'project' && !v.projectId && !v.taskId) add('projectId', 'Pick the project this was spent on');
    if (v.paidFrom === 'company') {
      if (!v.paidOn) add('paidOn', 'Enter the date it was paid');
      if (!v.mode) add('mode', 'Pick how it was paid');
    } else {
      // An out-of-pocket submission has not been paid back yet: payment details belong to the reimbursement.
      if (v.paidOn) add('paidOn', 'The payment date is recorded when the expense is reimbursed');
      if (v.mode) add('mode', 'The payment mode is recorded when the expense is reimbursed');
      if (v.transactionRef) add('transactionRef', 'The reference is recorded when the expense is reimbursed');
    }
  });

/**
 * Changes to an expense. Everything is optional and a `null` clears an optional link or note. The status is
 * NOT here: it moves through approve, reject, mark paid and void, so its history and its rules cannot be skipped.
 * Sending any of the money fields re-resolves the exchange rate (see `updateExpense`).
 */
export const updateExpenseSchema = z
  .object({
    scope: z.enum(EXPENSE_SCOPES).optional(),
    clientId: objectIdSchema.nullable().optional(),
    projectId: objectIdSchema.nullable().optional(),
    taskId: objectIdSchema.nullable().optional(),
    category: category.optional(),
    description: description.optional(),
    payee: payee.nullable().optional(),
    amountMinor: amountMinor.optional(),
    currency: currencySchema.optional(),
    spentOn: dateOnlyString.optional(),
    ...fxPayloadFields,
    paidOn: dateOnlyString.optional(),
    mode: mode.optional(),
    transactionRef: transactionRef.nullable().optional(),
    receiptMediaIds: receiptMediaIds.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.manualRate !== undefined && v.settledInrMinor !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'Give either the exact rate or the INR amount that arrived, not both', path: ['manualRate'] });
    }
    if (v.scope === 'company' && (v.clientId || v.projectId || v.taskId)) ctx.addIssue({ code: 'custom', message: COMPANY_LINK_ERROR, path: ['scope'] });
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'Nothing to update' });

export const rejectExpenseSchema = z.object({ reason }).strict();
export const voidExpenseSchema = z.object({ reason }).strict();

/** Reimbursing an approved out-of-pocket expense: when, how, and the bank reference when there is one (cash has none). */
export const markPaidSchema = z
  .object({
    paidOn: dateOnlyString,
    mode,
    transactionRef: transactionRef.optional(),
  })
  .strict();

export type CreateExpenseBody = z.infer<typeof createExpenseSchema>;
/** What callers hand the service (defaults not yet applied). */
export type CreateExpenseInput = z.input<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type RejectExpenseInput = z.infer<typeof rejectExpenseSchema>;
export type VoidExpenseInput = z.infer<typeof voidExpenseSchema>;
export type MarkPaidInput = z.infer<typeof markPaidSchema>;

export const EXPENSE_SORT_KEYS = ['spentOn', 'createdAt', 'amount', 'status', 'ref'] as const satisfies readonly ExpenseSort[];

/** "Approved or paid": the statuses that count as spent (plan section 4). */
export const SETTLED_FILTER = 'settled';
export const EXPENSE_STATUS_FILTERS = [...EXPENSE_STATUSES, SETTLED_FILTER] as const;

/**
 * Reads the expense filters from URL params, defensively: a bad value is ignored, never an error page.
 * The same reader serves the list page, the dashboard and the API, so they always agree. The period is
 * not here (it needs the organisation's settings): pass it to the service as `range`.
 */
export function parseExpenseFilter(sp: RawSearchParams): ExpenseFilter {
  const filter: ExpenseFilter = {};
  const q = first(sp, 'q');
  if (q) filter.q = q.slice(0, 100);
  const status = oneOf(sp, 'status', EXPENSE_STATUS_FILTERS);
  if (status) filter.status = status;
  const scope = oneOf(sp, 'scope', EXPENSE_SCOPES);
  if (scope) filter.scope = scope;
  const paidFrom = oneOf(sp, 'paidFrom', EXPENSE_PAID_FROM);
  if (paidFrom) filter.paidFrom = paidFrom;
  const category = first(sp, 'category');
  if (category) filter.category = category.slice(0, 60);
  const projectId = objectIdParam(sp, 'projectId');
  if (projectId) filter.projectId = projectId;
  const personId = objectIdParam(sp, 'person');
  if (personId) filter.personId = personId;
  return filter;
}

/** `from` and `to` from the query string as a date-only range, or undefined unless both are real dates in order. */
export function parseRangeParams(sp: RawSearchParams): { from: Date; to: Date } | undefined {
  const from = first(sp, 'from');
  const to = first(sp, 'to');
  const a = from ? parseDateOnly(from) : null;
  const b = to ? parseDateOnly(to) : null;
  return a && b && a <= b ? { from: a, to: b } : undefined;
}
