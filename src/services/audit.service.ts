import { Types, type ClientSession } from 'mongoose';
import type { AdminRole } from '@/config/capabilities';
import { AuditLog, type AuditChange } from '@/models';

export interface AuditActor {
  /** Null for the system and the seed script. */
  id: string | null;
  name: string;
  role?: AdminRole;
}

export interface AuditInput {
  actor: AuditActor;
  /** `entity.verb`, e.g. `admin.deactivate`, `auth.login_failed`. */
  action: string;
  entity: { type: string; id?: string | null; ref?: string; label?: string };
  summary?: string;
  changes?: AuditChange[];
  context?: { clientId?: string; projectId?: string; taskId?: string };
  meta?: { ipHash?: string; userAgent?: string; requestId?: string };
}

export const SYSTEM_ACTOR: AuditActor = { id: null, name: 'System' };
export const SEED_ACTOR: AuditActor = { id: null, name: 'Seed script' };

/** Paths whose values must never be written to the audit log. */
const SENSITIVE = /password|hash|token|secret|paymentnote|payoutnote|stepup/i;

export function redactChanges(changes: readonly AuditChange[] = []): AuditChange[] {
  return changes.map((c) => (SENSITIVE.test(c.path) ? { path: c.path, before: '[redacted]', after: '[redacted]' } : c));
}

/**
 * Compares the named fields of two plain objects and returns one change per
 * field that differs. Dotted paths (`profile.phone`) are supported.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[],
): AuditChange[] {
  const read = (o: Record<string, unknown>, path: string) =>
    path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), o);
  const out: AuditChange[] = [];
  for (const path of fields) {
    const b = read(before, path);
    const a = read(after, path);
    if (JSON.stringify(b) !== JSON.stringify(a)) out.push({ path, before: b, after: a });
  }
  return out;
}

const oid = (id?: string | null) => (id && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : undefined);

/**
 * Writes one audit entry. Inside a transaction, pass the session so the entry
 * commits or rolls back together with the change it records.
 */
export async function audit(input: AuditInput, session?: ClientSession): Promise<void> {
  await AuditLog.create(
    [
      {
        at: new Date(),
        actor: { id: oid(input.actor.id) ?? null, name: input.actor.name, role: input.actor.role },
        action: input.action,
        entity: { type: input.entity.type, id: oid(input.entity.id), ref: input.entity.ref, label: input.entity.label },
        summary: input.summary,
        changes: redactChanges(input.changes),
        context: {
          clientId: oid(input.context?.clientId),
          projectId: oid(input.context?.projectId),
          taskId: oid(input.context?.taskId),
        },
        ipHash: input.meta?.ipHash,
        userAgent: input.meta?.userAgent,
        requestId: input.meta?.requestId,
      },
    ],
    { session },
  );
}
