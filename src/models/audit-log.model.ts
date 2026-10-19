import { Schema, model, models, type Model, type Types } from 'mongoose';
import { ADMIN_ROLES, type AdminRole } from '@/config/capabilities';
import { text } from './shared.schema';

export interface AuditChange {
  path: string;
  before?: unknown;
  after?: unknown;
}

/** Append-only record of every change and every sign-in event. */
export interface AuditLogDoc {
  _id: Types.ObjectId;
  at: Date;
  /** `id` is null for the system and the seed script. */
  actor: { id: Types.ObjectId | null; name: string; role?: AdminRole };
  /** `entity.verb`, e.g. `payment.void`, `admin.deactivate`, `auth.login_failed`. */
  action: string;
  entity: { type: string; id?: Types.ObjectId; ref?: string; label?: string };
  summary?: string;
  /** Password hashes, payment notes and tokens are redacted before they get here. */
  changes: AuditChange[];
  /** Lets a project's whole history be filtered. */
  context: { clientId?: Types.ObjectId; projectId?: Types.ObjectId; taskId?: Types.ObjectId };
  ipHash?: string;
  userAgent?: string;
  requestId?: string;
}

const auditSchema = new Schema<AuditLogDoc>(
  {
    at: { type: Date, required: true, default: Date.now },
    actor: {
      id: { type: Schema.Types.ObjectId, default: null },
      name: { ...text(120, true) },
      role: { type: String, enum: ADMIN_ROLES },
    },
    action: { ...text(80, true) },
    entity: {
      type: { ...text(40, true) },
      id: { type: Schema.Types.ObjectId },
      ref: text(60),
      label: text(200),
    },
    summary: text(500),
    changes: {
      type: [new Schema({ path: String, before: Schema.Types.Mixed, after: Schema.Types.Mixed }, { _id: false })],
      default: [],
    },
    context: {
      clientId: { type: Schema.Types.ObjectId },
      projectId: { type: Schema.Types.ObjectId },
      taskId: { type: Schema.Types.ObjectId },
    },
    ipHash: text(80),
    userAgent: text(400),
    requestId: text(80),
  },
  { versionKey: false },
);

// `_id` breaks ties between entries written in the same millisecond, so offset pages never repeat or
// skip a row, and the audit page's sort (at, then _id, newest first) is served by an index instead
// of an in-memory sort over entries that carry before/after payloads. The actor index carries `_id`
// too, because everyone but a superadmin reads the log through it (their own entries only).
auditSchema.index({ at: -1, _id: -1 });
auditSchema.index({ 'actor.id': 1, at: -1, _id: -1 });
auditSchema.index({ 'entity.type': 1, 'entity.id': 1, at: -1 });
auditSchema.index({ action: 1, at: -1 });
auditSchema.index({ 'context.projectId': 1, at: -1 });
auditSchema.index({ 'context.clientId': 1, at: -1 });

/**
 * Defence in depth: there is no update or delete code path, and the model
 * refuses one even if somebody writes it. Inserts only.
 */
const FORBIDDEN = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
] as const;
for (const op of FORBIDDEN) {
  auditSchema.pre(op, async function () {
    throw new Error('Audit logs are append-only');
  });
}
auditSchema.pre('save', async function () {
  if (!this.isNew) throw new Error('Audit logs are append-only');
});
// bulkWrite can carry updates and deletes too; only plain inserts are allowed through.
auditSchema.pre('bulkWrite', async function (ops: readonly object[]) {
  if (ops.some((op) => !('insertOne' in op))) throw new Error('Audit logs are append-only');
});

declare module 'mongoose' {
  interface Models {
    AuditLog: Model<AuditLogDoc>;
  }
}

export const AuditLog: Model<AuditLogDoc> = models.AuditLog ?? model<AuditLogDoc>('AuditLog', auditSchema);
