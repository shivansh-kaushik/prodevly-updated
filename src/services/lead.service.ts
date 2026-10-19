import { createHash } from 'node:crypto';
import { Types, type ClientSession } from 'mongoose';
import { mongoose, connectToDatabase, withTransaction } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import type { LeadStatus } from '@/config/statuses';
import { badRequest, conflict, hasLinkedRecords, notFound, validationFailed } from '@/lib/api/errors';
import { checkFormToken } from '@/lib/api/form-token';
import { assessSpam, describeSpam } from '@/lib/api/spam';
import { escapeRegex, pageMeta, type PageMeta } from '@/lib/admin/search-params';
import { formatDateOnly, parseDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { fieldErrors, parseObjectId } from '@/lib/validation/common';
import {
  leadIntakeSchema,
  OPEN_LEAD_STATUSES,
  type LeadIntake,
  type UpdateLeadInput,
} from '@/lib/validation/lead';
import { Admin, Client, Lead, RateLimit, Service, Settings, SETTINGS_ID, type AuditChange, type LeadDoc } from '@/models';
import type { SessionUser } from '@/types/session';
import type { ServiceMeta } from './admin.service';
import { audit, type AuditActor } from './audit.service';
import { nextRef } from './refs';
import { getSettings } from './settings.service';

/**
 * Enquiries: contact-form submissions (the `leads` collection) and what staff do with them.
 *
 * Two halves with different trust:
 *
 * - `createLeadFromPublic` is the PUBLIC intake. Nobody is signed in, every byte is untrusted, and
 *   every rule that decides "store it or not" lives here (honeypot, form token, validation, spam,
 *   duplicate window). The route in front of it only does the HTTP parts (origin, size, rate limit).
 * - Everything else is for signed-in staff and checks the viewer's capability itself:
 *   `lead:view` to read, `lead:edit` to change, `lead:delete` (superadmins only) to delete for good.
 *   There are no own-record rules: any admin with the capability may work any enquiry.
 *
 * Every change is audited in the same transaction. Enquiries have no money, so there is nothing
 * here that depends on FX or INR.
 */

const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_NOTES = 500;
const MIN_FOLLOW_UP_YEAR = 2020;
const MAX_FOLLOW_UP_YEAR = 2100;

/** Who the audit trail and the status history name for something the visitor's own submission did. */
const VISITOR: AuditActor = { id: null, name: 'Website visitor' };

const actorOf = (admin: SessionUser): AuditActor => ({ id: admin.id, name: admin.name, role: admin.role });
const snapshot = (admin: SessionUser) => ({ id: new Types.ObjectId(admin.id), name: admin.name });
const OBJECT_ID = /^[a-f\d]{24}$/i;
const iso = (d: Date) => d.toISOString();

// ---------------------------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------------------------

export interface LeadListItem {
  id: string;
  ref: string;
  name: string;
  email: string;
  company: string | null;
  /** The start of the message as plain text, whitespace collapsed. */
  excerpt: string;
  services: string[];
  status: LeadStatus;
  assignedTo: { id: string; name: string } | null;
  /** YYYY-MM-DD */
  followUpOn: string | null;
  createdAt: string;
  firstResponseAt: string | null;
}

export interface LeadDetail {
  id: string;
  ref: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  country: string | null;
  services: Array<{ id: string; title: string }>;
  budgetRange: string | null;
  /** Untrusted visitor text. Render as text only, never as HTML. */
  message: string;
  sourcePath: string | null;
  utm: { source: string | null; medium: string | null; campaign: string | null };
  status: LeadStatus;
  statusHistory: Array<{ from: LeadStatus | null; to: LeadStatus; at: string; by: string; note: string | null }>;
  assignedTo: { id: string; name: string } | null;
  followUpOn: string | null;
  notes: Array<{ at: string; by: string; text: string }>;
  firstResponseAt: string | null;
  converted: { clientId: string; projectId: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

// The visitor's IP hash, user agent and message hash are deliberately absent from both shapes.

const excerptOf = (message: string) => {
  const flat = message.replace(/\s+/g, ' ').trim();
  return flat.length > 140 ? `${flat.slice(0, 137)}...` : flat;
};

async function serviceTitles(ids: Types.ObjectId[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  // Titles are looked up whatever the service's status is now: an enquiry keeps naming the
  // service the visitor chose even after it is archived.
  const rows = await Service.find({ _id: mongoose.trusted({ $in: ids }) }).select('title').lean();
  return new Map(rows.map((s) => [String(s._id), s.title]));
}

const assignee = (a: LeadDoc['assignedTo']) => (a?.id ? { id: String(a.id), name: a.name } : null);

function toListItem(doc: LeadDoc, titles: Map<string, string>): LeadListItem {
  return {
    id: String(doc._id),
    ref: doc.ref,
    name: doc.name,
    email: doc.email,
    company: doc.company ?? null,
    excerpt: excerptOf(doc.message),
    services: (doc.serviceIds ?? []).map((id) => titles.get(String(id)) ?? 'Removed service'),
    status: doc.status,
    assignedTo: assignee(doc.assignedTo),
    followUpOn: doc.followUpOn ? formatDateOnly(doc.followUpOn) : null,
    createdAt: iso(doc.createdAt),
    firstResponseAt: doc.firstResponseAt ? iso(doc.firstResponseAt) : null,
  };
}

async function toDetail(doc: LeadDoc): Promise<LeadDetail> {
  const titles = await serviceTitles(doc.serviceIds ?? []);
  return {
    id: String(doc._id),
    ref: doc.ref,
    name: doc.name,
    email: doc.email,
    phone: doc.phone ?? null,
    company: doc.company ?? null,
    country: doc.country ?? null,
    services: (doc.serviceIds ?? []).map((id) => ({ id: String(id), title: titles.get(String(id)) ?? 'Removed service' })),
    budgetRange: doc.budgetRange ?? null,
    message: doc.message,
    sourcePath: doc.sourcePath ?? null,
    utm: { source: doc.utm?.source ?? null, medium: doc.utm?.medium ?? null, campaign: doc.utm?.campaign ?? null },
    status: doc.status,
    statusHistory: (doc.statusHistory ?? []).map((h) => ({ from: h.from ?? null, to: h.to, at: iso(h.at), by: h.by.name, note: h.note ?? null })),
    assignedTo: assignee(doc.assignedTo),
    followUpOn: doc.followUpOn ? formatDateOnly(doc.followUpOn) : null,
    notes: (doc.notes ?? []).map((n) => ({ at: iso(n.at), by: n.by.name, text: n.text })),
    firstResponseAt: doc.firstResponseAt ? iso(doc.firstResponseAt) : null,
    converted: doc.convertedClientId
      ? { clientId: String(doc.convertedClientId), projectId: doc.convertedProjectId ? String(doc.convertedProjectId) : null }
      : null,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

// ---------------------------------------------------------------------------------------------
// Public intake
// ---------------------------------------------------------------------------------------------

/**
 * What happened to a submission. The route answers every one of these with the same success body,
 * so a bot cannot tell a stored enquiry from a decoy; the outcome is for tests and logs only.
 *
 * - `created`: stored as a new enquiry.
 * - `held_as_spam`: stored with status "spam" (not thrown away, so a false positive can be rescued).
 * - `duplicate`: the same email and message arrived in the last 10 minutes; nothing new stored.
 * - `honeypot`: the hidden field was filled; nothing stored.
 * - `too_fast`: submitted within 3 seconds of the form loading; nothing stored.
 */
export type IntakeOutcome = 'created' | 'held_as_spam' | 'duplicate' | 'honeypot' | 'too_fast';

/** SHA-256 of the normalised email and message: the same words in another case or spacing are the same message. */
export function messageHashOf(email: string, message: string): string {
  const normalised = message.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(`${email.trim().toLowerCase()}\n${normalised}`).digest('hex');
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A filled honeypot is anything but "absent or blank": a real browser form only ever sends an empty string. */
const isFilled = (v: unknown) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');

/** Published services among the ones the visitor ticked. Unknown or unpublished ids are ignored, never an error. */
async function publishedServiceIds(ids: string[]): Promise<Types.ObjectId[]> {
  if (ids.length === 0) return [];
  const rows = await Service.find({
    _id: mongoose.trusted({ $in: ids.map((id) => new Types.ObjectId(id)) }),
    status: 'published',
  })
    .select('_id')
    .lean();
  const found = new Set(rows.map((r) => String(r._id)));
  return ids.filter((id) => found.has(id)).map((id) => new Types.ObjectId(id));
}

/** The configured assignee for new enquiries (Settings), when that admin is still active. */
async function defaultAssignee(): Promise<{ id: Types.ObjectId; name: string } | undefined> {
  const settings = await Settings.findById(SETTINGS_ID).select('leadDefaultAssignee').lean();
  const wanted = settings?.leadDefaultAssignee?.id;
  if (!wanted) return undefined;
  const admin = await Admin.findOne({ _id: wanted, status: 'active' }).select('name').lean();
  return admin ? { id: admin._id, name: admin.name } : undefined;
}

export async function createLeadFromPublic(raw: unknown, meta: ServiceMeta = {}, now: Date = new Date()): Promise<IntakeOutcome> {
  if (!isPlainObject(raw)) throw badRequest('That request was not valid');

  // 1. Honeypot: a decoy success, nothing stored. Before anything that could give a bot a different answer.
  if (isFilled(raw.companyWebsite)) return 'honeypot';

  // 2. Form token. Too fast is a silent discard; anything else wrong asks the visitor to reload.
  const token = checkFormToken(raw.formToken, now);
  if (token === 'too_fast') return 'too_fast';
  if (token === 'expired') throw badRequest('This form has been open for a while. Please refresh the page and send it again.');
  if (token === 'invalid') throw badRequest('We could not verify this form. Please refresh the page and try again.');

  // 3. Validation, with messages a visitor can act on.
  const parsed = leadIntakeSchema.safeParse(raw);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const input: LeadIntake = parsed.data;

  // 4. Spam heuristics. A hit is stored as spam (see IntakeOutcome), not rejected: no feedback for the sender.
  const verdict = assessSpam({ name: input.name, company: input.company, message: input.message });

  await connectToDatabase();
  const [serviceIds, settings, assignedTo] = await Promise.all([
    publishedServiceIds(input.serviceIds),
    getSettings(),
    verdict.spam ? Promise.resolve(undefined) : defaultAssignee(),
  ]);
  // Only a range the team configured counts: a visitor-typed value would invent buckets in the dashboard.
  const budgetRange = input.budgetRange
    ? settings.budgetRanges.find((r) => r.toLowerCase() === input.budgetRange?.toLowerCase())
    : undefined;

  const status: LeadStatus = verdict.spam ? 'spam' : 'new';
  const hash = messageHashOf(input.email, input.message);

  return withTransaction<IntakeOutcome>(async (session) => {
    // 5. The 10-minute duplicate window. Two identical submissions at the same instant would both pass a plain
    // check, so both first write this one document: they conflict, one retries, and the retry sees the other's row.
    await RateLimit.updateOne(
      { _id: `lead-dup:${hash}` },
      { $set: { expiresAt: new Date(now.getTime() + DUPLICATE_WINDOW_MS) }, $inc: { count: 1 } },
      { upsert: true, session },
    );
    const duplicate = await Lead.exists({
      messageHash: hash,
      createdAt: mongoose.trusted({ $gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS) }),
    }).session(session);
    if (duplicate) return 'duplicate';

    // 6. Save, with its audit entry in the same transaction.
    const ref = await nextRef('lead', session);
    const note = verdict.spam ? `Held by the spam checks: ${describeSpam(verdict)}`.slice(0, 500) : undefined;
    const [created] = await Lead.create(
      [
        {
          ref,
          name: input.name,
          email: input.email,
          phone: input.phone,
          company: input.company,
          country: input.country,
          serviceIds,
          budgetRange,
          message: input.message,
          sourcePath: input.sourcePath,
          utm: input.utm,
          ipHash: meta.ipHash,
          userAgent: meta.userAgent,
          status,
          statusHistory: [{ from: null, to: status, at: now, by: VISITOR, ...(note ? { note } : {}) }],
          assignedTo,
          messageHash: hash,
          createdAt: now,
        },
      ],
      { session },
    );
    if (!created) throw new Error('Enquiry was not created');
    await audit(
      {
        actor: VISITOR,
        action: 'lead.create',
        entity: { type: 'lead', id: String(created._id), ref: created.ref, label: created.name },
        summary: verdict.spam ? `Held as spam: ${describeSpam(verdict)}` : undefined,
        meta,
      },
      session,
    );
    return verdict.spam ? 'held_as_spam' : 'created';
  });
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

export const LEAD_SORT_KEYS = ['createdAt', 'name'] as const;

export interface LeadSearch {
  /** Matched literally against name, email, company and ref. */
  q?: string;
  /** One status, or `open` for everything still being worked. */
  status?: LeadStatus | 'open';
  /** `me`, `unassigned` or an admin id. */
  assignee?: string;
  /** `due`: open enquiries whose follow-up date is today or earlier. Ignores the period: it is a work queue. */
  followUp?: 'due';
  source?: { kind: 'utm' | 'page'; value: string };
  period?: { fromInstant: Date; toInstant: Date };
  sort?: (typeof LEAD_SORT_KEYS)[number];
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  now?: Date;
}

export async function searchLeads(viewer: SessionUser, params: LeadSearch = {}): Promise<{ items: LeadListItem[]; meta: PageMeta }> {
  assertCapability(viewer, 'lead:view');
  await connectToDatabase();

  const and: Record<string, unknown>[] = [];
  const q = params.q?.trim().slice(0, 80);

  if (params.status === 'open') and.push({ status: mongoose.trusted({ $in: [...OPEN_LEAD_STATUSES] }) });
  else if (params.status) and.push({ status: params.status });
  // Spam stays out of the everyday list. Filtering by status "spam", or searching, brings it back.
  else if (!q) and.push({ status: mongoose.trusted({ $ne: 'spam' }) });

  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    and.push({ $or: [{ name: re }, { email: re }, { company: re }, { ref: re }] });
  }

  if (params.assignee === 'me') and.push({ 'assignedTo.id': new Types.ObjectId(viewer.id) });
  else if (params.assignee === 'unassigned') and.push({ 'assignedTo.id': null });
  else if (params.assignee && OBJECT_ID.test(params.assignee)) and.push({ 'assignedTo.id': new Types.ObjectId(params.assignee) });

  if (params.followUp === 'due') {
    const tz = (await getSettings()).timezone;
    and.push({ status: mongoose.trusted({ $in: [...OPEN_LEAD_STATUSES] }) });
    and.push({ followUpOn: mongoose.trusted({ $lte: todayDateOnly(params.now ?? new Date(), tz) }) });
  } else if (params.period) {
    and.push({ createdAt: mongoose.trusted({ $gte: params.period.fromInstant, $lt: params.period.toInstant }) });
  }

  if (params.source?.kind === 'utm') and.push({ 'utm.source': params.source.value });
  else if (params.source?.kind === 'page') and.push({ sourcePath: params.source.value });

  const filter = and.length ? { $and: and } : {};
  const pageSize = Math.min(Math.max(params.pageSize ?? 25, 1), 100);
  const total = await Lead.countDocuments(filter);
  const meta = pageMeta(Math.max(params.page ?? 1, 1), pageSize, total);

  const dir = (params.dir ?? 'desc') === 'asc' ? 1 : -1;
  const sort: Record<string, 1 | -1> =
    params.followUp === 'due' ? { followUpOn: 1, createdAt: -1 } : params.sort === 'name' ? { name: dir, createdAt: -1 } : { createdAt: dir };
  const docs = await Lead.find(filter)
    .sort({ ...sort, _id: -1 })
    .skip((meta.page - 1) * pageSize)
    .limit(pageSize)
    .lean();

  const titles = await serviceTitles([...new Set(docs.flatMap((d) => (d.serviceIds ?? []).map(String)))].map((id) => new Types.ObjectId(id)));
  return { items: docs.map((d) => toListItem(d, titles)), meta };
}

export async function getLead(viewer: SessionUser, id: string): Promise<LeadDetail> {
  assertCapability(viewer, 'lead:view');
  await connectToDatabase();
  const doc = await Lead.findById(parseObjectId(id)).lean();
  if (!doc) throw notFound('We could not find that enquiry');
  return toDetail(doc);
}

/** Active admins an enquiry can be assigned to, for filters and pickers. */
export async function listAssignableAdmins(viewer: SessionUser): Promise<Array<{ id: string; name: string }>> {
  assertCapability(viewer, 'lead:view');
  await connectToDatabase();
  const rows = await Admin.find({ status: 'active' }).select('name').sort({ name: 1 }).lean();
  return rows.map((a) => ({ id: String(a._id), name: a.name }));
}

/** The pages and UTM sources enquiries actually came from, most frequent first, for the list filter. Spam is left out. */
export async function listLeadSources(viewer: SessionUser, limit = 20): Promise<{ pages: string[]; utmSources: string[] }> {
  assertCapability(viewer, 'lead:view');
  await connectToDatabase();
  const top = async (field: 'sourcePath' | 'utm.source') => {
    const rows = await Lead.aggregate<{ _id: string }>([
      { $match: { status: { $ne: 'spam' }, [field]: { $type: 'string' } } },
      { $group: { _id: `$${field}`, n: { $sum: 1 } } },
      { $sort: { n: -1, _id: 1 } },
      { $limit: limit },
    ]);
    return rows.map((r) => r._id);
  };
  const [pages, utmSources] = await Promise.all([top('sourcePath'), top('utm.source')]);
  return { pages, utmSources };
}

// ---------------------------------------------------------------------------------------------
// Changing
// ---------------------------------------------------------------------------------------------

interface UpdateOptions {
  /** When nothing would change, fail with this message instead of quietly succeeding. */
  requireChange?: string;
}

/**
 * Status, assignee and follow-up date, in one audited write.
 *
 * - A status change appends to the history; `firstResponseAt` is set once, the first time the
 *   enquiry reaches a status other than "new" or "spam" (moving junk to spam is not a reply, and
 *   would otherwise drag the median first-reply time).
 * - The assignee must be an ACTIVE admin. Null unassigns.
 * - A follow-up date is a calendar date (midnight UTC). Null clears it.
 * - Setting what is already set changes nothing and writes no audit entry.
 */
async function runLeadUpdate(
  actor: SessionUser,
  rawId: string,
  patch: UpdateLeadInput,
  meta: ServiceMeta,
  options: UpdateOptions = {},
): Promise<LeadDetail> {
  assertCapability(actor, 'lead:edit');
  const id = parseObjectId(rawId);

  let followUp: Date | null = null;
  if (typeof patch.followUpOn === 'string') {
    followUp = parseDateOnly(patch.followUpOn);
    const year = followUp?.getUTCFullYear() ?? 0;
    if (!followUp || year < MIN_FOLLOW_UP_YEAR || year > MAX_FOLLOW_UP_YEAR) {
      throw validationFailed({ followUpOn: `Pick a date between ${MIN_FOLLOW_UP_YEAR} and ${MAX_FOLLOW_UP_YEAR}` });
    }
  }
  let assigneeId: string | null = null;
  if (typeof patch.assignedTo === 'string') {
    if (!OBJECT_ID.test(patch.assignedTo)) throw validationFailed({ assignedTo: 'Pick an active team member' });
    assigneeId = patch.assignedTo.toLowerCase();
  }

  const after = await withTransaction(async (session) => {
    const before = await Lead.findById(id).session(session).lean();
    if (!before) throw notFound('We could not find that enquiry');

    const now = new Date();
    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    const push: Record<string, unknown> = {};
    const changes: AuditChange[] = [];
    let action = 'lead.update';
    let summary: string | undefined;

    if (patch.status !== undefined && patch.status !== before.status) {
      // A converted enquiry is linked to a real client: calling it spam would leave junk pointing at that client.
      if (patch.status === 'spam' && before.convertedClientId) {
        throw conflict('That enquiry was converted into a client, so it cannot be marked as spam');
      }
      set.status = patch.status;
      push.statusHistory = {
        from: before.status,
        to: patch.status,
        at: now,
        by: snapshot(actor),
        ...(patch.statusNote ? { note: patch.statusNote } : {}),
      };
      if (!before.firstResponseAt && patch.status !== 'new' && patch.status !== 'spam') set.firstResponseAt = now;
      changes.push({ path: 'status', before: before.status, after: patch.status });
      action = patch.status === 'spam' ? 'lead.mark_spam' : 'lead.status';
      summary = patch.statusNote;
    }

    if (patch.assignedTo !== undefined) {
      const current = before.assignedTo?.id ? String(before.assignedTo.id) : null;
      if (patch.assignedTo === null) {
        if (current) {
          unset.assignedTo = 1;
          changes.push({ path: 'assignedTo', before: before.assignedTo?.name ?? null, after: null });
          if (action === 'lead.update') action = 'lead.unassign';
        }
      } else if (current !== assigneeId) {
        const admin = await Admin.findOne({ _id: assigneeId, status: 'active' }).select('name').session(session).lean();
        if (!admin) throw validationFailed({ assignedTo: 'Pick an active team member' });
        set.assignedTo = { id: admin._id, name: admin.name };
        changes.push({ path: 'assignedTo', before: before.assignedTo?.name ?? null, after: admin.name });
        if (action === 'lead.update') action = 'lead.assign';
      }
    }

    if (patch.followUpOn !== undefined) {
      const current = before.followUpOn ?? null;
      if (patch.followUpOn === null) {
        if (current) {
          unset.followUpOn = 1;
          changes.push({ path: 'followUpOn', before: formatDateOnly(current), after: null });
        }
      } else if (followUp && (!current || current.getTime() !== followUp.getTime())) {
        set.followUpOn = followUp;
        changes.push({ path: 'followUpOn', before: current ? formatDateOnly(current) : null, after: formatDateOnly(followUp) });
      }
    }

    if (changes.length === 0) {
      if (options.requireChange) throw conflict(options.requireChange);
      return before;
    }

    const update: Record<string, unknown> = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    if (Object.keys(push).length) update.$push = push;
    const updated = await Lead.findOneAndUpdate({ _id: before._id }, update, { returnDocument: 'after', session, runValidators: true }).lean();
    if (!updated) throw notFound('We could not find that enquiry');

    await audit(
      { actor: actorOf(actor), action, entity: { type: 'lead', id, ref: updated.ref, label: updated.name }, summary, changes, meta },
      session,
    );
    return updated;
  });
  return toDetail(after);
}

export function updateLead(actor: SessionUser, id: string, patch: UpdateLeadInput, meta: ServiceMeta = {}): Promise<LeadDetail> {
  return runLeadUpdate(actor, id, patch, meta);
}

/** Moves an enquiry to spam. It stays in the database (filter by status "spam") and can be moved back by changing its status. */
export function markLeadSpam(actor: SessionUser, id: string, note: string | undefined, meta: ServiceMeta = {}): Promise<LeadDetail> {
  return runLeadUpdate(actor, id, { status: 'spam', ...(note ? { statusNote: note } : {}) }, meta, {
    requireChange: 'That enquiry is already marked as spam',
  });
}

/** Notes are append-only: there is no edit and no delete, so the record of what was said to whom cannot be rewritten. */
export async function addLeadNote(actor: SessionUser, rawId: string, text: string, meta: ServiceMeta = {}): Promise<LeadDetail> {
  assertCapability(actor, 'lead:edit');
  const id = parseObjectId(rawId);
  const note = text.trim();
  if (!note) throw validationFailed({ text: 'Write a note' });
  if (note.length > 2000) throw validationFailed({ text: 'Keep the note under 2,000 characters' });

  const after = await withTransaction(async (session) => {
    const updated = await Lead.findOneAndUpdate(
      { _id: id, [`notes.${MAX_NOTES - 1}`]: mongoose.trusted({ $exists: false }) },
      { $push: { notes: { at: new Date(), by: snapshot(actor), text: note } } },
      { returnDocument: 'after', session, runValidators: true },
    ).lean();
    if (!updated) {
      const exists = await Lead.exists({ _id: id }).session(session);
      if (!exists) throw notFound('We could not find that enquiry');
      throw conflict('This enquiry has too many notes. Summarise them in a new one elsewhere.');
    }
    await audit(
      {
        actor: actorOf(actor),
        action: 'lead.note',
        entity: { type: 'lead', id, ref: updated.ref, label: updated.name },
        summary: 'Added a note',
        meta,
      },
      session,
    );
    return updated;
  });
  return toDetail(after);
}

/**
 * Permanent delete. Superadmins only (`lead:delete` is never grantable). The record is gone, but the
 * audit entry stays: it names the reference, the person and the reason. An enquiry that was converted
 * into a client or project is linked to real records and cannot be deleted.
 */
export async function deleteLead(actor: SessionUser, rawId: string, reason: string, meta: ServiceMeta = {}): Promise<void> {
  assertCapability(actor, 'lead:delete');
  const id = parseObjectId(rawId);
  await withTransaction(async (session) => {
    const lead = await Lead.findById(id).session(session).lean();
    if (!lead) throw notFound('We could not find that enquiry');
    // The enquiry's own links, and the other direction: a client that names it as its source (`Client.leadId`)
    // would be left pointing at nothing.
    const linked = Boolean(lead.convertedClientId || lead.convertedProjectId) || Boolean(await Client.exists({ leadId: lead._id }).session(session));
    if (linked) throw hasLinkedRecords('That enquiry was converted into a client, so it cannot be deleted.');
    await Lead.deleteOne({ _id: lead._id }, { session });
    await audit(
      {
        actor: actorOf(actor),
        action: 'lead.delete',
        entity: { type: 'lead', id, ref: lead.ref, label: lead.name },
        summary: reason,
        changes: [{ path: 'status', before: lead.status, after: null }],
        meta,
      },
      session,
    );
  });
}

// ---------------------------------------------------------------------------------------------
// Converting an enquiry into a client and a draft project (lead-conversion.service.ts).
//
// That service creates or picks the records, then calls this with the SAME session, so the enquiry
// moves to "won" and links to them atomically (or none of it happens). The detail page shows the
// link once `converted` is set, and `deleteLead` refuses a converted one.
// ---------------------------------------------------------------------------------------------
export async function applyLeadConversion(
  actor: SessionUser,
  rawId: string,
  /** `summary` is what the one `lead.convert` audit entry says: which records the conversion made or linked. */
  links: { clientId: string; projectId?: string; summary?: string },
  session: ClientSession,
  meta: ServiceMeta = {},
): Promise<void> {
  assertCapability(actor, 'lead:edit');
  const id = parseObjectId(rawId);
  const clientId = parseObjectId(links.clientId);
  const projectId = links.projectId ? parseObjectId(links.projectId) : undefined;

  const lead = await Lead.findById(id).session(session).lean();
  if (!lead) throw notFound('We could not find that enquiry');
  if (lead.convertedClientId) throw conflict('That enquiry has already been converted');
  if (lead.status === 'spam') throw conflict('Spam cannot be converted. Restore it first.');

  const now = new Date();
  const update: Record<string, unknown> = {
    $set: {
      status: 'won',
      convertedClientId: new Types.ObjectId(clientId),
      ...(projectId ? { convertedProjectId: new Types.ObjectId(projectId) } : {}),
      ...(lead.firstResponseAt ? {} : { firstResponseAt: now }),
    },
  };
  if (lead.status !== 'won') {
    update.$push = { statusHistory: { from: lead.status, to: 'won', at: now, by: snapshot(actor), note: 'Converted to a client' } };
  }
  await Lead.updateOne({ _id: lead._id }, update, { session, runValidators: true });
  await audit(
    {
      actor: actorOf(actor),
      action: 'lead.convert',
      entity: { type: 'lead', id, ref: lead.ref, label: lead.name },
      summary: links.summary,
      changes: [
        { path: 'status', before: lead.status, after: 'won' },
        { path: 'convertedClientId', before: null, after: clientId },
        ...(projectId ? [{ path: 'convertedProjectId', before: null, after: projectId }] : []),
      ],
      context: { clientId, projectId },
      meta,
    },
    session,
  );
}
