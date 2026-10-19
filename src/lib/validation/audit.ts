import { z } from 'zod';
import { first, type RawSearchParams } from '@/lib/admin/search-params';
import { objectIdSchema } from './common';

/**
 * Filters of the audit log, shared by the page (which reads them from the URL) and the service
 * (which parses again, because a service never trusts its caller). Free text is matched literally
 * by the service; these patterns only keep obvious junk out of the query.
 */

/** A hex id has two spellings; identity checks and Mongo casts want one. */
const idField = objectIdSchema.transform((v) => v.toLowerCase());

/** `entity.verb`, or a leading part of it ("payment." matches every payment action). */
const actionField = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z][A-Za-z0-9_.]*$/, { error: 'Not a valid action' });

const entityField = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, { error: 'Not a valid record type' });

const searchField = z.string().trim().max(100);

export const auditFilterSchema = z
  .object({
    /** Honoured only for viewers with audit:viewAll; everyone else is pinned to their own entries. */
    actorId: idField.optional(),
    /** Action prefix, anchored at the start. */
    action: actionField.optional(),
    entityType: entityField.optional(),
    clientId: idField.optional(),
    projectId: idField.optional(),
    /** Matched literally against the person, action, summary, record name and reference, and exactly against the request id. */
    q: searchField.optional().transform((v) => v || undefined),
    /** Only admin management, voids and failed sign-ins. */
    sensitive: z.boolean().optional(),
    /** Instants: `from` inclusive, `to` exclusive (a Period's fromInstant and toInstant). */
    from: z.date().optional(),
    to: z.date().optional(),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from < v.to, { error: 'The end of the period must come after its start', path: ['to'] });

export type AuditFilterInput = z.input<typeof auditFilterSchema>;
export type AuditFilters = z.output<typeof auditFilterSchema>;

export const AUDIT_PAGE_SIZE = 25;

/**
 * Reads the audit filters out of the URL. A bad value is dropped, never an error page: a stale
 * bookmark should still open. Period params (`period`, `from`, `to`) are read by `getPeriod`.
 */
export function parseAuditSearch(sp: RawSearchParams): Pick<AuditFilterInput, 'actorId' | 'action' | 'entityType' | 'clientId' | 'projectId' | 'q' | 'sensitive'> {
  const pick = <T>(schema: z.ZodType<T>, key: string): T | undefined => {
    const raw = first(sp, key);
    if (raw === undefined) return undefined;
    const parsed = schema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  };
  return {
    actorId: pick(idField, 'actor'),
    action: pick(actionField, 'action'),
    entityType: pick(entityField, 'entity'),
    clientId: pick(idField, 'client'),
    projectId: pick(idField, 'project'),
    // Long text is cut, not rejected, like every other list's search box.
    q: first(sp, 'q')?.slice(0, 100),
    sensitive: first(sp, 'sensitive') === '1' ? true : undefined,
  };
}
