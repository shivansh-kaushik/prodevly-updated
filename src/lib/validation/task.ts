import { z } from 'zod';
import { ASSIGNEE_KINDS, PRIORITIES, TASK_STATUSES } from '@/config/statuses';
import { parseDateOnly } from '@/lib/dates/date-only';
import { first, objectIdParam, oneOf, type RawSearchParams } from '@/lib/admin/search-params';
import type { TaskFilter, TaskSort } from '@/services/task.service';
import { objectIdSchema } from './common';

/** A calendar date as "YYYY-MM-DD". Real dates only (2026-02-30 is rejected). The service turns it into UTC midnight. */
export const dateOnlySchema = z
  .string({ error: 'Pick a date' })
  .trim()
  .refine((v) => parseDateOnly(v) !== null, { error: 'Enter a valid date' });

/** A new task starts open: finishing or cancelling is a status change with its own history. */
export const CREATABLE_TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked'] as const;

const note = z.string().trim().min(3, { error: 'Give a reason (at least 3 characters)' }).max(500);

/** Who is on a task. The NAME is never taken from the client: the service reads it from the record. */
export const assigneeRefSchema = z.object({ kind: z.enum(ASSIGNEE_KINDS), id: objectIdSchema }).strict();
export type AssigneeRef = z.infer<typeof assigneeRefSchema>;

const assignees = z.array(assigneeRefSchema).max(12, { error: 'At most 12 people on one task' });

const title = z.string({ error: 'Give the task a title' }).trim().min(2, { error: 'Give the task a title' }).max(200, { error: 'That title is too long' });
const estimate = z.number().int().min(1, { error: 'The estimate must be at least a minute' }).max(100_000, { error: 'That estimate is too large' });

export const createTaskSchema = z
  .object({
    projectId: objectIdSchema,
    /** Never trusted: derived from the project. Accepted only so a disagreeing value can be rejected as LINK_MISMATCH. */
    clientId: objectIdSchema.optional(),
    title,
    description: z.string().trim().max(8000).optional(),
    status: z.enum(CREATABLE_TASK_STATUSES).default('todo'),
    priority: z.enum(PRIORITIES).default('medium'),
    assignees: assignees.default([]),
    estimateMinutes: estimate.nullable().optional(),
    dueOn: dateOnlySchema.nullable().optional(),
    labels: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  })
  .strict();

/** Status is NOT here: it moves through its own route so history and its rules cannot be bypassed. */
export const updateTaskSchema = z
  .object({
    /** Moving a task to another project. Refused once a work log or money entry references it. */
    projectId: objectIdSchema.optional(),
    title: title.optional(),
    description: z.string().trim().max(8000).nullable().optional(),
    priority: z.enum(PRIORITIES).optional(),
    estimateMinutes: estimate.nullable().optional(),
    dueOn: dateOnlySchema.nullable().optional(),
    labels: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'Nothing to update' });

export const changeStatusSchema = z.object({ status: z.enum(TASK_STATUSES, { error: 'Pick a status' }), note: note.optional() }).strict();

export const setAssigneesSchema = z.object({ assignees }).strict();

export const reorderSchema = z
  .object({
    projectId: objectIdSchema,
    status: z.enum(TASK_STATUSES),
    /** The column, top to bottom. Tasks of the column that are left out keep their order after these. */
    orderedIds: z.array(objectIdSchema).min(1).max(500),
  })
  .strict();

/** What a route hands the service (defaults applied). Services also accept the looser `z.input` shape. */
export type CreateTaskBody = z.infer<typeof createTaskSchema>;
export type CreateTaskInput = z.input<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;
export type SetAssigneesInput = z.infer<typeof setAssigneesSchema>;
export type ReorderInput = z.infer<typeof reorderSchema>;

export const TASK_SORT_KEYS = ['updatedAt', 'dueOn', 'createdAt', 'title', 'ref'] as const satisfies readonly TaskSort[];

/**
 * Reads the task filters from URL params, defensively: a bad value is ignored, never an error page.
 * `assignee` is `unassigned`, `me` (needs `viewerId`), `admin:<id>` or `thirdParty:<id>`. The same
 * reader serves the list page, the board, the dashboard band and the API, so they always agree.
 */
export function parseTaskFilter(sp: RawSearchParams, options: { viewerId?: string } = {}): TaskFilter {
  const filter: TaskFilter = {};
  const q = first(sp, 'q');
  if (q) filter.q = q.slice(0, 100);
  const status = oneOf(sp, 'status', [...TASK_STATUSES, 'open'] as const);
  if (status) filter.status = status;
  const priority = oneOf(sp, 'priority', PRIORITIES);
  if (priority) filter.priority = priority;
  const projectId = objectIdParam(sp, 'projectId');
  if (projectId) filter.projectId = projectId;
  const clientId = objectIdParam(sp, 'clientId');
  if (clientId) filter.clientId = clientId;
  const assignee = first(sp, 'assignee');
  if (assignee === 'unassigned') filter.assignee = 'unassigned';
  else if (assignee === 'me' && options.viewerId) filter.assignee = { kind: 'admin', id: options.viewerId };
  else if (assignee) {
    const [kind, id] = assignee.split(':');
    if ((kind === 'admin' || kind === 'thirdParty') && id && /^[a-f\d]{24}$/i.test(id)) filter.assignee = { kind, id: id.toLowerCase() };
  }
  if (first(sp, 'overdue') === '1') filter.overdue = true;
  if (first(sp, 'archived') === '1') filter.archived = true;
  return filter;
}
