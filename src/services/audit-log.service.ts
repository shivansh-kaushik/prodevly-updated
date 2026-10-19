import { Types } from 'mongoose';
import { connectToDatabase, mongoose } from '@/lib/db/mongoose';
import { DEFAULT_TIMEZONE } from '@/lib/dates/fiscal-year';
import { escapeRegex, pageMeta, type PageMeta } from '@/lib/admin/search-params';
import { validationFailed } from '@/lib/api/errors';
import { auditFilterSchema, type AuditFilterInput, type AuditFilters } from '@/lib/validation/audit';
import { fieldErrors } from '@/lib/validation/common';
import { Admin, AuditLog, Client, Project, type AuditChange, type AuditLogDoc } from '@/models';
import type { SessionUser } from '@/types/session';
import type { ActivityEntry } from './activity.service';
import { redactChanges } from './audit.service';

/**
 * Reads of the audit log for /admin/audit (the log is written only by `audit()`).
 *
 * WHO SEES WHAT is decided in exactly one place, `scopeFilter`: a viewer with `audit:viewAll`
 * (superadmins; it is never grantable) reads every entry, everyone else reads ONLY entries where
 * they are the actor. The list, the filter options and the dashboard all start from it, and an
 * actor filter sent by a non-superadmin is ignored, not honoured: asking for someone else's
 * entries returns your own, never theirs.
 *
 * Nothing here needs a capability to be called (every signed-in admin has their own trail), so
 * there is no FORBIDDEN path: the capability decides the SCOPE.
 */

export type AuditScope = 'all' | 'own';

export const auditScopeOf = (viewer: SessionUser): AuditScope => (viewer.capabilities.has('audit:viewAll') ? 'all' : 'own');

/** The base filter every audit read starts from. Compose it, never bypass it. */
export function scopeFilter(viewer: SessionUser): Record<string, unknown> {
  return auditScopeOf(viewer) === 'all' ? {} : { 'actor.id': new Types.ObjectId(viewer.id) };
}

/**
 * What counts as a sensitive action (plan section 5): account management, voids (money is never
 * deleted, so a void is the strongest thing that can happen to a record) and failed sign-ins.
 * Strings, not RegExp objects, so the dashboard can hand them to `$regexMatch` and the list to a query.
 */
export const SENSITIVE = {
  adminManagement: '^admin\\.',
  voids: '\\.void$',
  failedSignIns: '^auth\\.login_failed$',
} as const;
export const SENSITIVE_ANY = Object.values(SENSITIVE).join('|');

/** A zone name that Intl accepts, else the default: a bad settings value must not break the page. */
export function resolveZone(timeZone: string | undefined): string {
  if (!timeZone) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** One audit entry as the screen sees it. A superset of the activity feed's row, so `AuditFeed` renders it as is. */
export interface AuditEntryDTO extends ActivityEntry {
  /** Null for the system, the seed script and failed sign-ins. */
  actorId: string | null;
  context: { clientId: string | null; projectId: string | null; taskId: string | null };
  requestId: string | null;
  /** Salted hash of the caller's address, present ONLY for audit:viewAll. The raw address is never stored. */
  ipHash?: string | null;
}

export interface AuditPage {
  entries: AuditEntryDTO[];
  meta: PageMeta;
  scope: AuditScope;
}

const MAX_DEPTH = 8;

/** Reuses the writer's own list of sensitive names, so the two can never drift apart. */
const isSecretKey = (key: string) => redactChanges([{ path: key, before: 1, after: 1 }])[0]?.before === '[redacted]';

/**
 * Turns whatever Mongo stored in a before/after value into plain JSON: ids become strings, dates ISO
 * strings, binary data a marker. Secrets are removed AGAIN here (by key, at any depth): the writer
 * redacts by path, but a nested `{ profile: { passwordHash } }` or a row inserted by some other
 * path must still never reach a screen.
 */
function plain(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return value;
  if (type === 'bigint') return String(value);
  if (type !== 'object') return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Buffer.isBuffer(value)) return '[binary]';
  const bson = (value as { _bsontype?: string })._bsontype;
  if (bson) return bson === 'Binary' ? '[binary]' : String(value);
  if (depth >= MAX_DEPTH) return '[too deep]';
  if (Array.isArray(value)) return value.map((v) => plain(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = isSecretKey(k) ? '[redacted]' : plain(v, depth + 1);
  return out;
}

function safeChanges(changes: readonly AuditChange[] | undefined): AuditChange[] {
  return redactChanges(changes ?? []).map((c) => ({ path: c.path, before: plain(c.before), after: plain(c.after) }));
}

type AuditRow = Pick<AuditLogDoc, '_id' | 'at' | 'actor' | 'action' | 'entity' | 'summary' | 'changes' | 'context' | 'ipHash' | 'requestId'>;

const idOrNull = (id: Types.ObjectId | null | undefined) => (id ? String(id) : null);

function toAuditEntryDTO(row: AuditRow, includeIpHash: boolean): AuditEntryDTO {
  // The log is append-only for good, so it also holds whatever older code or a script wrote. One odd
  // row must never take the whole page down: fall back to a plain label instead of throwing.
  const actor = row.actor ?? { id: null, name: 'Unknown' };
  const entity = row.entity ?? { type: 'unknown' };
  return {
    id: String(row._id),
    at: row.at.toISOString(),
    actorId: idOrNull(actor.id),
    actorName: actor.name ?? 'Unknown',
    actorRole: actor.role ?? null,
    action: row.action,
    summary: row.summary ?? null,
    entity: { type: entity.type, id: idOrNull(entity.id), ref: entity.ref ?? null, label: entity.label ?? null },
    changes: safeChanges(row.changes),
    context: { clientId: idOrNull(row.context?.clientId), projectId: idOrNull(row.context?.projectId), taskId: idOrNull(row.context?.taskId) },
    requestId: row.requestId ?? null,
    // The key is absent, not null, for everyone else: there is nothing to hide behind a null.
    ...(includeIpHash ? { ipHash: row.ipHash ?? null } : {}),
  };
}

function parseFilters(input: AuditFilterInput): AuditFilters {
  const parsed = auditFilterSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  return parsed.data;
}

/** The Mongo filter for parsed filters. Everything the caller typed is matched literally. */
export function buildFilter(viewer: SessionUser, f: AuditFilters): Record<string, unknown> {
  const filter: Record<string, unknown> = { ...scopeFilter(viewer) };
  // Only a viewer of everything may pick a person. For anyone else the pin from scopeFilter stands.
  if (auditScopeOf(viewer) === 'all' && f.actorId) filter['actor.id'] = new Types.ObjectId(f.actorId);
  if (f.entityType) filter['entity.type'] = f.entityType;
  if (f.clientId) filter['context.clientId'] = new Types.ObjectId(f.clientId);
  if (f.projectId) filter['context.projectId'] = new Types.ObjectId(f.projectId);
  if (f.from || f.to) {
    filter.at = mongoose.trusted({ ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lt: f.to } : {}) });
  }

  // Several conditions on `action` (a prefix and "sensitive") or a free-text `$or` need an explicit $and.
  const all: Array<Record<string, unknown>> = [];
  if (f.action) all.push({ action: new RegExp(`^${escapeRegex(f.action)}`) });
  if (f.sensitive) all.push({ action: new RegExp(SENSITIVE_ANY) });
  if (f.q) {
    const re = new RegExp(escapeRegex(f.q), 'i');
    // A request id is an opaque token: exact match only.
    all.push({ $or: [{ 'actor.name': re }, { action: re }, { summary: re }, { 'entity.label': re }, { 'entity.ref': re }, { requestId: f.q }] });
  }
  if (all.length > 0) filter.$and = all;
  return filter;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * The log, newest first, in offset pages. `meta.total` is the number of entries the filters match
 * (for the page header). A page past the end answers the last page.
 */
export async function listAudit(
  viewer: SessionUser,
  filters: AuditFilterInput = {},
  page: { page?: number; pageSize?: number } = {},
): Promise<AuditPage> {
  const parsed = parseFilters(filters);
  await connectToDatabase();

  const filter = buildFilter(viewer, parsed);
  const pageSize = Math.min(Math.max(Math.floor(page.pageSize ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const wanted = Math.max(Math.floor(page.page ?? 1) || 1, 1);

  const total = await AuditLog.countDocuments(filter);
  const meta = pageMeta(wanted, pageSize, total);
  const rows =
    total === 0
      ? []
      : await AuditLog.find(filter)
          // `_id` second: entries written in the same millisecond keep a fixed order across pages.
          .sort({ at: -1, _id: -1 })
          .skip((meta.page - 1) * meta.pageSize)
          .limit(meta.pageSize)
          .lean();

  const includeIpHash = auditScopeOf(viewer) === 'all';
  return { entries: rows.map((r) => toAuditEntryDTO(r, includeIpHash)), meta, scope: auditScopeOf(viewer) };
}

export interface AuditFilterOptions {
  /** Record types that appear in the viewer's part of the log, sorted. */
  entityTypes: string[];
  /** Actions that appear in the viewer's part of the log, sorted. */
  actions: string[];
}

const OPTION_LIMIT = 200;

/** The choices for the filter dropdowns: only what actually exists in the viewer's scope. */
export async function getAuditFilterOptions(viewer: SessionUser): Promise<AuditFilterOptions> {
  await connectToDatabase();
  const scope = scopeFilter(viewer);
  const [entityTypes, actions] = await Promise.all([AuditLog.distinct('entity.type', scope), AuditLog.distinct('action', scope)]);
  const clean = (values: unknown[]) =>
    values
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, OPTION_LIMIT);
  return { entityTypes: clean(entityTypes), actions: clean(actions) };
}

export interface AuditFilterLabel {
  id: string;
  label: string;
  ref?: string;
}

export interface AuditFilterLabels {
  actor?: AuditFilterLabel;
  client?: AuditFilterLabel;
  project?: AuditFilterLabel;
}

/**
 * The names behind the ids in the URL, so the pickers can show who and what is selected.
 * A person is named only for viewers of everything (nobody else may pick one), and a client or
 * project only for viewers who may open clients or projects.
 */
export async function resolveAuditFilterLabels(
  viewer: SessionUser,
  filters: Pick<AuditFilterInput, 'actorId' | 'clientId' | 'projectId'>,
): Promise<AuditFilterLabels> {
  const asId = (v: string | undefined) => (v && /^[a-f\d]{24}$/i.test(v) ? new Types.ObjectId(v.toLowerCase()) : undefined);
  const actorId = auditScopeOf(viewer) === 'all' ? asId(filters.actorId) : undefined;
  const clientId = viewer.capabilities.has('client:view') ? asId(filters.clientId) : undefined;
  const projectId = viewer.capabilities.has('project:view') ? asId(filters.projectId) : undefined;
  if (!actorId && !clientId && !projectId) return {};

  await connectToDatabase();
  const [actor, client, project] = await Promise.all([
    actorId ? Admin.findById(actorId).select('name').lean() : null,
    clientId ? Client.findById(clientId).select('name ref').lean() : null,
    projectId ? Project.findById(projectId).select('name ref').lean() : null,
  ]);
  const out: AuditFilterLabels = {};
  // A well-formed id that matches nobody still shows as selected, so the filter is visible and can be cleared.
  if (actorId) out.actor = { id: String(actorId), label: actor?.name ?? 'Unknown person' };
  if (clientId) out.client = { id: String(clientId), label: client?.name ?? 'Unknown client', ref: client?.ref };
  if (projectId) out.project = { id: String(projectId), label: project?.name ?? 'Unknown project', ref: project?.ref };
  return out;
}

export interface DayGroup<T> {
  /** YYYY-MM-DD in the organisation's zone. */
  day: string;
  /** "Monday, 12 October 2026". */
  label: string;
  entries: T[];
}

/** Groups a newest-first page into calendar days of the organisation's zone, keeping the order. */
export function groupAuditByDay<T extends { at: string }>(entries: readonly T[], timeZone = DEFAULT_TIMEZONE): Array<DayGroup<T>> {
  const zone = resolveZone(timeZone);
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const label = new Intl.DateTimeFormat('en-IN', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const groups = new Map<string, DayGroup<T>>();
  for (const entry of entries) {
    const at = new Date(entry.at);
    const day = key.format(at);
    const group = groups.get(day) ?? { day, label: label.format(at), entries: [] };
    group.entries.push(entry);
    groups.set(day, group);
  }
  return [...groups.values()];
}
