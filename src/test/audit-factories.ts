import type { Types } from 'mongoose';
import type { AdminRole } from '@/config/capabilities';
import { AuditLog, type AuditChange, type AuditLogDoc } from '@/models';

/**
 * Audit entries with chosen timestamps. `audit()` always stamps "now", and the model refuses every
 * rewrite, so tests that need a specific time (period bounds, per-day buckets) insert here instead.
 * Rows go through the model, so they are cast and validated like real ones; nothing is redacted on
 * the way in, which lets a test prove that reads redact on their own.
 */
export interface AuditEntryOverrides {
  at?: Date | string;
  actor?: { id?: Types.ObjectId | string | null; name?: string; role?: AdminRole };
  action?: string;
  entity?: { type?: string; id?: Types.ObjectId | string; ref?: string; label?: string };
  summary?: string;
  changes?: AuditChange[];
  context?: { clientId?: Types.ObjectId | string; projectId?: Types.ObjectId | string; taskId?: Types.ObjectId | string };
  ipHash?: string;
  userAgent?: string;
  requestId?: string;
}

/** The actor block for an admin (or any `{ _id, name, role }`). */
export const actorOf = (admin: { _id: Types.ObjectId; name: string; role?: AdminRole }) => ({ id: admin._id, name: admin.name, role: admin.role });

export async function makeAuditEntry(o: AuditEntryOverrides = {}): Promise<AuditLogDoc> {
  const doc = await AuditLog.create({
    at: o.at ? new Date(o.at) : new Date(),
    actor: { id: null, name: 'System', ...o.actor },
    action: o.action ?? 'client.update',
    entity: { type: 'client', ...o.entity },
    summary: o.summary,
    changes: o.changes ?? [],
    context: o.context ?? {},
    ipHash: o.ipHash,
    userAgent: o.userAgent,
    requestId: o.requestId,
  });
  return doc.toObject();
}

/** Inserts several entries in order. */
export async function makeAuditEntries(entries: AuditEntryOverrides[]): Promise<AuditLogDoc[]> {
  const out: AuditLogDoc[] = [];
  for (const e of entries) out.push(await makeAuditEntry(e));
  return out;
}
