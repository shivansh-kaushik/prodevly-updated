import { z } from 'zod';
import { first, objectIdParam, type RawSearchParams } from '@/lib/admin/search-params';
import type { WorkLogFilter } from '@/services/work-log.service';
import { objectIdSchema } from './common';
import { dateOnlySchema } from './task';

/** 5 minutes to 12 hours in one entry. Whole minutes only. */
export const MIN_LOG_MINUTES = 5;
export const MAX_LOG_MINUTES = 720;
/** One person's total for one calendar day. The form warns above 12 hours. */
export const MAX_DAY_MINUTES = 960;
export const WARN_DAY_MINUTES = 720;

const minutes = z
  .number({ error: 'Enter how long you worked' })
  .int({ error: 'Whole minutes only' })
  .min(MIN_LOG_MINUTES, { error: 'Log at least 5 minutes' })
  .max(MAX_LOG_MINUTES, { error: 'One entry can be at most 12 hours' });

const note = z
  .string({ error: 'Say what you did' })
  .trim()
  .min(3, { error: 'Say what you did (at least 3 characters)' })
  .max(500, { error: 'Keep the note under 500 characters' });

export const createWorkLogSchema = z
  .object({
    taskId: objectIdSchema,
    /** Never trusted: derived from the task. Accepted only so a disagreeing value can be rejected as LINK_MISMATCH. */
    projectId: objectIdSchema.optional(),
    clientId: objectIdSchema.optional(),
    workedOn: dateOnlySchema,
    minutes,
    note,
    /** Defaults to true on hourly projects, false otherwise. */
    billable: z.boolean().optional(),
  })
  .strict();

/** The task cannot change: delete the entry and log it again on the right task. */
export const updateWorkLogSchema = z
  .object({
    workedOn: dateOnlySchema.optional(),
    minutes: minutes.optional(),
    note: note.optional(),
    billable: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'Nothing to update' });

export const dayTotalQuerySchema = z.object({ date: dateOnlySchema });

export type CreateWorkLogInput = z.infer<typeof createWorkLogSchema>;
export type UpdateWorkLogInput = z.infer<typeof updateWorkLogSchema>;

/** Reads the work-log filters from URL params. A malformed date is left for the service to reject (422 on the API). */
export function parseWorkLogFilter(sp: RawSearchParams): WorkLogFilter {
  const filter: WorkLogFilter = {};
  const adminId = objectIdParam(sp, 'adminId');
  if (adminId) filter.adminId = adminId;
  const projectId = objectIdParam(sp, 'projectId');
  if (projectId) filter.projectId = projectId;
  const clientId = objectIdParam(sp, 'clientId');
  if (clientId) filter.clientId = clientId;
  const taskId = objectIdParam(sp, 'taskId');
  if (taskId) filter.taskId = taskId;
  const from = first(sp, 'from');
  if (from) filter.from = from;
  const to = first(sp, 'to');
  if (to) filter.to = to;
  const billable = first(sp, 'billable');
  if (billable === 'yes') filter.billable = true;
  else if (billable === 'no') filter.billable = false;
  return filter;
}
