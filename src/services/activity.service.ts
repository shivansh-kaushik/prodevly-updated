import { Types } from 'mongoose';
import { connectToDatabase, mongoose } from '@/lib/db/mongoose';
import { AuditLog, type AuditChange } from '@/models';
import { escapeRegex } from '@/lib/admin/search-params';
import type { Capability } from '@/config/capabilities';
import type { SessionUser } from '@/types/session';

/**
 * Reads the audit log as an activity feed. This function does NOT decide who may see what:
 * the CALLER passes the scope its viewer is entitled to (all of it for `audit:viewAll`, their own
 * entries otherwise, or one record's history on a page the viewer can already open).
 */
export interface ActivityEntry {
  id: string;
  at: string;
  actorId?: string | null;
  actorName: string;
  actorRole: string | null;
  action: string;
  summary: string | null;
  entity: { type: string; id: string | null; ref: string | null; label: string | null };
  changes: AuditChange[];
}

export interface ActivityFilter {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  clientId?: string;
  projectId?: string;
  taskId?: string;
  /** Matches actions that start with this, e.g. "payment." */
  actionPrefix?: string;
}

const oid = (v?: string) => (v && /^[a-f\d]{24}$/i.test(v) ? new Types.ObjectId(v) : undefined);

export async function getActivity(filter: ActivityFilter = {}, options: { limit?: number; before?: Date } = {}): Promise<ActivityEntry[]> {
  await connectToDatabase();
  const query: Record<string, unknown> = {};
  if (filter.entityType) query['entity.type'] = filter.entityType;
  const entityId = oid(filter.entityId);
  if (entityId) query['entity.id'] = entityId;
  const actorId = oid(filter.actorId);
  if (actorId) query['actor.id'] = actorId;
  const clientId = oid(filter.clientId);
  if (clientId) query['context.clientId'] = clientId;
  const projectId = oid(filter.projectId);
  if (projectId) query['context.projectId'] = projectId;
  const taskId = oid(filter.taskId);
  if (taskId) query['context.taskId'] = taskId;
  if (filter.actionPrefix) query.action = new RegExp(`^${escapeRegex(filter.actionPrefix)}`);
  if (options.before) query.at = mongoose.trusted({ $lt: options.before });

  const rows = await AuditLog.find(query)
    .sort({ at: -1 })
    .limit(Math.min(options.limit ?? 20, 100))
    .lean();

  return rows.map((r) => ({
    id: String(r._id),
    at: r.at.toISOString(),
    actorId: r.actor.id ? String(r.actor.id) : null,
    actorName: r.actor.name,
    actorRole: r.actor.role ?? null,
    action: r.action,
    summary: r.summary ?? null,
    entity: { type: r.entity.type, id: r.entity.id ? String(r.entity.id) : null, ref: r.entity.ref ?? null, label: r.entity.label ?? null },
    changes: r.changes ?? [],
  }));
}

/* ------------------- viewer-aware reads (for record-level feeds) ------------------- */

/** Entity types that carry money or pay, and the capability needed to see an entry about them. */
const ENTITY_CAPABILITY: Record<string, Capability> = {
  payment: 'payment:view',
  clientPayment: 'payment:view',
  thirdPartyPayout: 'payout:view',
  workOrder: 'payout:view',
  expense: 'expense:view',
  teamPayout: 'team:payView',
  payProfile: 'team:payView',
};
/** Entries about these are shown to anyone who can open the record; their money FIELDS are stripped below. */
const PLAIN_ENTITIES = new Set(['project', 'task', 'client', 'lead', 'enquiry']);
const MONEY_PATH = /^(contract|milestones|costBudget|agreed)/;

/**
 * The activity feed of one record (a client, project or task), filtered for THIS viewer, so a feed can never
 * be a way around a capability: money and pay entries need their capability, work-log entries need
 * worklog:viewAll unless the viewer did them, and the contract, milestone and budget fields of project
 * entries need payment:view. Anything of an unknown kind needs every money view.
 */
export async function getRecordActivity(viewer: SessionUser, filter: ActivityFilter, limit = 30): Promise<ActivityEntry[]> {
  const rows = await getActivity(filter, { limit: Math.min(limit * 4, 100) });
  const allMoney = (['payment:view', 'payout:view', 'expense:view', 'team:payView'] as const).every((c) => viewer.capabilities.has(c));
  const seesMoneyFields = viewer.capabilities.has('payment:view');
  return rows
    .filter((e) => {
      const needed = ENTITY_CAPABILITY[e.entity.type];
      if (needed) return viewer.capabilities.has(needed);
      if (e.entity.type === 'workLog') return viewer.capabilities.has('worklog:viewAll') || e.actorId === viewer.id;
      return PLAIN_ENTITIES.has(e.entity.type) || allMoney;
    })
    .map((e) => (seesMoneyFields ? e : { ...e, changes: e.changes.filter((c) => !MONEY_PATH.test(c.path)) }))
    .slice(0, limit);
}
