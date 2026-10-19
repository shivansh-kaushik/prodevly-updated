import { Types, type ClientSession } from 'mongoose';
import { mongoose } from '@/lib/db/mongoose';
import { validationFailed } from '@/lib/api/errors';
import { blockersOf, type GateProblems } from '@/lib/content/gates';
import type { ContentBaseDTO, ContentType, MediaRefDTO } from '@/lib/content/types';
import { mediaPath } from '@/lib/media/url';
import { Admin, Media, Project, Service, type ActorDoc } from '@/models';
import type { SessionUser } from '@/types/session';
import { diffFields, type AuditActor } from '@/services/audit.service';
import type { AuditChange } from '@/models';
import type { ContentDocLike, FieldPatch } from './types';

export const oid = (id: string) => new Types.ObjectId(id);

export const actorSnapshot = (viewer: SessionUser): ActorDoc => ({ id: oid(viewer.id), name: viewer.name });
export const auditActorOf = (viewer: SessionUser): AuditActor => ({ id: viewer.id, name: viewer.name, role: viewer.role });

export const iso = (d: Date | undefined | null): string | null => (d ? d.toISOString() : null);
/** A date-only value (UTC midnight) as YYYY-MM-DD. */
export const dayOf = (d: Date | undefined | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

export function isDuplicateKey(error: unknown): error is { code: 11000; keyPattern?: Record<string, number> } {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;
}
export const duplicateOn = (error: unknown, field: string): boolean =>
  isDuplicateKey(error) && Object.keys(error.keyPattern ?? {}).includes(field);

/** Sets a value, or clears the field when the caller sent null. `undefined` means "leave it". */
export function put(patch: FieldPatch, path: string, value: unknown): void {
  if (value === undefined) return;
  if (value === null) patch.unset.push(path);
  else patch.set[path] = value;
}

/** Drops undefined and null entries, for building a new document from optional input. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;
}

/** Copy-on-write: sets or removes `path` (dotted) in `root`, cloning each object it walks through. */
function writePath(root: Record<string, unknown>, parts: string[], value: unknown): void {
  const [head, ...rest] = parts;
  if (head === undefined) return;
  if (rest.length === 0) {
    if (value === undefined) delete root[head];
    else root[head] = value;
    return;
  }
  const child: Record<string, unknown> = { ...(root[head] as Record<string, unknown> | undefined) };
  root[head] = child;
  writePath(child, rest, value);
}

/** The record as it would look after a patch, so the publish gate can judge the RESULT, not the input. */
export function applyPatch(existing: ContentDocLike, patch: FieldPatch): ContentDocLike {
  const out: Record<string, unknown> = { ...existing };
  for (const [path, value] of Object.entries(patch.set)) writePath(out, path.split('.'), value);
  for (const path of patch.unset) writePath(out, path.split('.'), undefined);
  return out as ContentDocLike;
}

/** Mongo documents as plain JSON (ids to strings, dates to ISO), so audit entries compare and read cleanly. */
export const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const AUDIT_TEXT_LIMIT = 300;
const clip = (value: unknown, depth = 0): unknown => {
  if (typeof value === 'string') return value.length > AUDIT_TEXT_LIMIT ? `${value.slice(0, AUDIT_TEXT_LIMIT)}... (${value.length} characters)` : value;
  if (depth > 3 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => clip(v, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clip(v, depth + 1)]));
};

/** Audit changes for the named fields, with long text clipped so a 4,000-character story does not fill the log. */
export function contentChanges(before: ContentDocLike | null, after: ContentDocLike, fields: readonly string[]): AuditChange[] {
  return diffFields((before ? plain(before) : {}) as Record<string, unknown>, plain(after) as Record<string, unknown>, fields).map((c) => ({
    path: c.path,
    before: clip(c.before),
    after: clip(c.after),
  }));
}

export const blockersFor = (problems: GateProblems): string[] => blockersOf(problems);

export function baseDTO<T extends ContentType>(
  type: T,
  doc: ContentDocLike,
  extra: { title: string; slug?: string | null; blockers: string[] },
): ContentBaseDTO & { type: T } {
  return {
    id: String(doc._id),
    type,
    status: doc.status,
    order: doc.order,
    title: extra.title,
    slug: extra.slug ?? null,
    publishedAt: iso(doc.publishedAt),
    publishedBy: doc.publishedBy?.name ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    updatedBy: doc.updatedBy?.name ?? null,
    blockers: extra.blockers,
  };
}

/** Publish blockers matter only for a DRAFT: a live record already passed, and an archived one is out of the running. */
export const blockersIfNotLive = (doc: ContentDocLike, problems: GateProblems): string[] =>
  doc.status === 'draft' ? blockersFor(problems) : [];

/* ------------------------------------------------------------------ links */

/**
 * Every id must be a PUBLIC image. A private receipt must never become a website cover, and a
 * deleted file must not be linked, so both are refused here rather than discovered on the page.
 */
export async function assertPublicImages(ids: readonly string[], field: string, session: ClientSession): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const found = await Media.find({ _id: mongoose.trusted({ $in: unique.map(oid) }) })
    .select('visibility mime')
    .session(session)
    .lean();
  if (found.length !== unique.length) throw validationFailed({ [field]: 'One of those images no longer exists. Choose again.' });
  if (found.some((m) => m.visibility !== 'public' || !m.mime.startsWith('image/'))) {
    throw validationFailed({ [field]: 'Choose an image from the website library.' });
  }
}

export async function assertServicesExist(ids: readonly string[], field: string, session: ClientSession): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const count = await Service.countDocuments({ _id: mongoose.trusted({ $in: unique.map(oid) }) }).session(session);
  if (count !== unique.length) throw validationFailed({ [field]: 'One of those services no longer exists.' });
}

export async function assertProjectExists(id: string, field: string, session: ClientSession): Promise<void> {
  if (!(await Project.exists({ _id: oid(id) }).session(session))) throw validationFailed({ [field]: 'That project does not exist.' });
}

export async function assertAdminExists(id: string, field: string, session: ClientSession): Promise<void> {
  if (!(await Admin.exists({ _id: oid(id) }).session(session))) throw validationFailed({ [field]: 'That team member does not exist.' });
}

/* ------------------------------------------------------------------- refs */

type MediaLike = { _id: Types.ObjectId; filename: string; mime: string; alt?: string; width?: number; height?: number };

export const toMediaRef = (m: MediaLike): MediaRefDTO => ({
  id: String(m._id),
  url: mediaPath(String(m._id), m.filename),
  filename: m.filename,
  mime: m.mime,
  alt: m.alt ?? null,
  width: m.width ?? null,
  height: m.height ?? null,
});

/** Media records for a set of ids, keyed by id. Missing files are simply absent. */
export async function loadMediaRefs(ids: ReadonlyArray<Types.ObjectId | undefined>): Promise<Map<string, MediaRefDTO>> {
  const unique = [...new Set(ids.filter((x): x is Types.ObjectId => Boolean(x)).map(String))];
  if (unique.length === 0) return new Map();
  const rows = await Media.find({ _id: mongoose.trusted({ $in: unique.map(oid) }) })
    .select('filename mime alt width height')
    .lean();
  return new Map(rows.map((m) => [String(m._id), toMediaRef(m)]));
}
