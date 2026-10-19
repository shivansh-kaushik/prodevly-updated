import { Types, type ClientSession } from 'mongoose';
import { mongoose, connectToDatabase, withTransaction } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { conflict, notFound, validationFailed } from '@/lib/api/errors';
import { escapeRegex, pageMeta, type PageMeta } from '@/lib/admin/search-params';
import { parseObjectId, fieldErrors } from '@/lib/validation/common';
import {
  THIRD_PARTY_SORTS,
  createThirdPartySchema,
  updateThirdPartySchema,
  type CreateThirdPartyInput,
  type ThirdPartyFilter,
  type ThirdPartySort,
  type UpdateThirdPartyInput,
} from '@/lib/validation/third-party';
import { ThirdParty, ThirdPartyPayout, WorkOrder, type ThirdPartyDoc } from '@/models';
import type { SessionUser } from '@/types/session';
import type { ServiceMeta } from './admin.service';
import { audit, diffFields, type AuditActor } from './audit.service';
import { nextRef } from './refs';
import { loadSettings } from './settings.service';

/**
 * The third-party directory: freelancers, agencies and vendors we pay.
 *
 * Who may do what (docs/plan section 1): everyone who can sign in as an admin reads the directory
 * (`thirdParty:view`); `thirdParty:edit` creates, edits, archives and restores. The PAYMENT NOTE (bank,
 * UPI, PayPal or Wise details) is `select: false` on the model, is read or written ONLY with
 * `thirdParty:payDetails` (superadmins), never appears in a list, and is redacted from the audit log.
 * The money summary on a row (paid, due, open work orders) is shown only to `payout:view` holders.
 */
export type { ServiceMeta };

const oid = (id: string) => new Types.ObjectId(id);
const snapshot = (v: SessionUser) => ({ id: oid(v.id), name: v.name });
const actorOf = (v: SessionUser): AuditActor => ({ id: v.id, name: v.name, role: v.role });
const canPay = (v: Pick<SessionUser, 'capabilities'>) => v.capabilities.has('thirdParty:payDetails');
const canSeeMoney = (v: Pick<SessionUser, 'capabilities'>) => v.capabilities.has('payout:view');

// ---------------------------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------------------------

export interface ThirdPartyMoneyDTO {
  /** INR paid, all time. Void payouts are left out. */
  paidInr: number;
  paidCount: number;
  /** INR due now (recorded, not yet paid). */
  dueInr: number;
  dueCount: number;
  /** Work orders still open or delivered. */
  openWorkOrders: number;
}

export interface ThirdPartyListItemDTO {
  id: string;
  ref: string;
  name: string;
  type: string;
  skills: string[];
  contactName: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  defaultCurrency: string | null;
  status: ThirdPartyDoc['status'];
  archived: boolean;
  updatedAt: string;
  /** Only for viewers with `payout:view`. */
  money: ThirdPartyMoneyDTO | null;
}

export interface ThirdPartyDTO extends ThirdPartyListItemDTO {
  gstin: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  archivedAt: string | null;
  archivedBy: string | null;
  /**
   * Bank, UPI, PayPal or Wise details. `null` means THIS VIEWER may not see them (not "there are none");
   * `{ note: null }` means they may, and none is stored.
   */
  payDetails: { note: string | null } | null;
}

const emptyMoney = (): ThirdPartyMoneyDTO => ({ paidInr: 0, paidCount: 0, dueInr: 0, dueCount: 0, openWorkOrders: 0 });

function toListItem(t: ThirdPartyDoc, money: ThirdPartyMoneyDTO | null): ThirdPartyListItemDTO {
  return {
    id: String(t._id),
    ref: t.ref,
    name: t.name,
    type: t.type,
    skills: t.skills ?? [],
    contactName: t.contactName ?? null,
    email: t.email ?? null,
    phone: t.phone ?? null,
    country: t.country ?? null,
    defaultCurrency: t.defaultCurrency ?? null,
    status: t.status,
    archived: Boolean(t.archivedAt),
    updatedAt: t.updatedAt.toISOString(),
    money,
  };
}

function toDTO(t: ThirdPartyDoc, viewer: Pick<SessionUser, 'capabilities'>, money: ThirdPartyMoneyDTO | null): ThirdPartyDTO {
  return {
    ...toListItem(t, money),
    gstin: t.gstin ?? null,
    notes: t.notes ?? null,
    createdBy: t.createdBy?.name ?? null,
    createdAt: t.createdAt.toISOString(),
    archivedAt: t.archivedAt ? t.archivedAt.toISOString() : null,
    archivedBy: t.archivedBy?.name ?? null,
    payDetails: canPay(viewer) ? { note: t.paymentNote ?? null } : null,
  };
}

/** What each third party has been paid, is owed and has open, for a set of ids. Two aggregations, whatever the page size. */
async function moneyFor(ids: Types.ObjectId[]): Promise<Map<string, ThirdPartyMoneyDTO>> {
  const out = new Map<string, ThirdPartyMoneyDTO>(ids.map((id) => [String(id), emptyMoney()]));
  if (ids.length === 0) return out;
  const [payouts, orders] = await Promise.all([
    ThirdPartyPayout.aggregate<{ _id: { tp: Types.ObjectId; status: 'paid' | 'due' }; inr: number; n: number }>([
      { $match: { thirdPartyId: { $in: ids }, status: { $in: ['paid', 'due'] } } },
      { $group: { _id: { tp: '$thirdPartyId', status: '$status' }, inr: { $sum: '$amount.inrMinor' }, n: { $sum: 1 } } },
    ]),
    WorkOrder.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { thirdPartyId: { $in: ids }, status: { $in: ['open', 'delivered'] } } },
      { $group: { _id: '$thirdPartyId', n: { $sum: 1 } } },
    ]),
  ]);
  for (const row of payouts) {
    const m = out.get(String(row._id.tp));
    if (!m) continue;
    if (row._id.status === 'paid') Object.assign(m, { paidInr: row.inr, paidCount: row.n });
    else Object.assign(m, { dueInr: row.inr, dueCount: row.n });
  }
  for (const row of orders) {
    const m = out.get(String(row._id));
    if (m) m.openWorkOrders = row.n;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

export interface ThirdPartySearch extends ThirdPartyFilter {
  sort?: ThirdPartySort;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

const SORT_FIELD: Record<ThirdPartySort, string> = { name: 'nameLower', ref: 'ref', type: 'type', updatedAt: 'updatedAt', createdAt: 'createdAt' };

/** The directory list. Needs `thirdParty:view`; the money summary on each row needs `payout:view`. */
export async function searchThirdParties(viewer: SessionUser, params: ThirdPartySearch = {}): Promise<{ items: ThirdPartyListItemDTO[]; meta: PageMeta }> {
  assertCapability(viewer, 'thirdParty:view');
  await connectToDatabase();

  const filter: Record<string, unknown> = {};
  if (params.archived === 'only') filter.archivedAt = mongoose.trusted({ $ne: null });
  else if (params.archived !== 'include') filter.archivedAt = null;
  if (params.status) filter.status = params.status;
  if (params.type) filter.type = params.type;
  const q = params.q?.trim().slice(0, 80);
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: re }, { ref: re }, { email: re }, { contactName: re }];
  }

  const sort = params.sort && THIRD_PARTY_SORTS.includes(params.sort) ? params.sort : 'name';
  const dir = (params.dir ?? (sort === 'name' || sort === 'ref' || sort === 'type' ? 'asc' : 'desc')) === 'asc' ? 1 : -1;
  const pageSize = Math.min(Math.max(params.pageSize ?? 25, 1), 100);
  const total = await ThirdParty.countDocuments(filter);
  const meta = pageMeta(Math.max(params.page ?? 1, 1), pageSize, total);
  const field = SORT_FIELD[sort];
  const docs = await ThirdParty.find(filter)
    .sort(field === 'nameLower' ? { nameLower: dir, _id: 1 } : { [field]: dir, nameLower: 1, _id: 1 })
    .skip((meta.page - 1) * pageSize)
    .limit(pageSize)
    .lean();

  const money = canSeeMoney(viewer) ? await moneyFor(docs.map((d) => d._id)) : null;
  return { items: docs.map((d) => toListItem(d, money ? (money.get(String(d._id)) ?? emptyMoney()) : null)), meta };
}

/** One third party with its details. The payment note is included ONLY for `thirdParty:payDetails`. */
export async function getThirdParty(viewer: SessionUser, id: string): Promise<ThirdPartyDTO> {
  assertCapability(viewer, 'thirdParty:view');
  await connectToDatabase();
  const tid = parseObjectId(id);
  const query = ThirdParty.findById(tid);
  if (canPay(viewer)) query.select('+paymentNote');
  const doc = await query.lean();
  if (!doc) throw notFound('We could not find that third party');
  const money = canSeeMoney(viewer) ? ((await moneyFor([doc._id])).get(String(doc._id)) ?? emptyMoney()) : null;
  return toDTO(doc, viewer, money);
}

/** A third party's name for a picker or a filter note. Null when it does not exist. */
export async function getThirdPartyOption(viewer: SessionUser, id: string): Promise<{ id: string; label: string; ref: string } | null> {
  assertCapability(viewer, 'thirdParty:view');
  await connectToDatabase();
  const tid = /^[a-f\d]{24}$/i.test(id) ? id.toLowerCase() : null;
  if (!tid) return null;
  const doc = await ThirdParty.findById(tid).select('name ref').lean();
  return doc ? { id: String(doc._id), label: doc.name, ref: doc.ref } : null;
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

async function assertTypeEnabled(type: string, session: ClientSession): Promise<void> {
  const settings = await loadSettings(session);
  if (!settings.thirdPartyTypes.includes(type)) {
    throw validationFailed({ type: 'Pick one of the third-party types set up in Settings' });
  }
}

const TRACKED = ['name', 'type', 'skills', 'status', 'contactName', 'email', 'phone', 'country', 'defaultCurrency', 'gstin', 'notes', 'paymentNote'] as const;
const trackable = (t: ThirdPartyDoc): Record<string, unknown> => ({
  name: t.name,
  type: t.type,
  skills: t.skills ?? [],
  status: t.status,
  contactName: t.contactName ?? null,
  email: t.email ?? null,
  phone: t.phone ?? null,
  country: t.country ?? null,
  defaultCurrency: t.defaultCurrency ?? null,
  gstin: t.gstin ?? null,
  notes: t.notes ?? null,
  // Never logged as a value: `audit()` redacts any path named like a payment note.
  paymentNote: t.paymentNote ?? null,
});

export async function createThirdParty(viewer: SessionUser, input: CreateThirdPartyInput, meta: ServiceMeta = {}): Promise<ThirdPartyDTO> {
  assertCapability(viewer, 'thirdParty:edit');
  const parsed = createThirdPartySchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const body = parsed.data;
  const paymentNote = body.paymentNote || undefined;
  if (paymentNote) assertCapability(viewer, 'thirdParty:payDetails');

  return withTransaction(async (session) => {
    await assertTypeEnabled(body.type, session);
    const [created] = await ThirdParty.create(
      [
        {
          ref: await nextRef('thirdParty', session),
          name: body.name,
          type: body.type,
          skills: [...new Set(body.skills)],
          contactName: body.contactName || undefined,
          email: body.email || undefined,
          phone: body.phone || undefined,
          country: body.country || undefined,
          defaultCurrency: body.defaultCurrency || undefined,
          gstin: body.gstin || undefined,
          notes: body.notes || undefined,
          paymentNote,
          status: 'active',
          createdBy: snapshot(viewer),
        },
      ],
      { session },
    );
    if (!created) throw new Error('Third party was not created');
    await audit(
      {
        actor: actorOf(viewer),
        action: 'thirdParty.create',
        entity: { type: 'thirdParty', id: String(created._id), ref: created.ref, label: created.name },
        summary: `Added to the directory as ${body.type.replaceAll('_', ' ')}`,
        changes: [
          { path: 'type', after: body.type },
          ...(paymentNote ? [{ path: 'paymentNote', after: 'set' }] : []),
        ],
        meta,
      },
      session,
    );
    return toDTO(created.toObject(), viewer, canSeeMoney(viewer) ? emptyMoney() : null);
  });
}

async function loadForWrite(id: string, session: ClientSession): Promise<ThirdPartyDoc> {
  const doc = await ThirdParty.findById(id).select('+paymentNote').session(session).lean();
  if (!doc) throw notFound('We could not find that third party');
  return doc;
}

export async function updateThirdParty(viewer: SessionUser, id: string, patch: UpdateThirdPartyInput, meta: ServiceMeta = {}): Promise<ThirdPartyDTO> {
  assertCapability(viewer, 'thirdParty:edit');
  id = parseObjectId(id);
  const parsed = updateThirdPartySchema.safeParse(patch);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const body = parsed.data;
  // Reading OR clearing the note is the same privilege as writing it: any mention of it needs the capability.
  if (body.paymentNote !== undefined) assertCapability(viewer, 'thirdParty:payDetails');

  return withTransaction(async (session) => {
    const before = await loadForWrite(id, session);
    if (before.archivedAt) throw conflict('This third party is archived. Restore it before changing it.');

    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    const field = (key: 'contactName' | 'email' | 'phone' | 'country' | 'defaultCurrency' | 'gstin' | 'notes' | 'paymentNote') => {
      const value = body[key];
      if (value === undefined) return;
      if (value === null || value === '') unset[key] = 1;
      else set[key] = value;
    };

    if (body.name !== undefined) {
      set.name = body.name;
      set.nameLower = body.name.toLowerCase();
    }
    if (body.type !== undefined && body.type !== before.type) {
      await assertTypeEnabled(body.type, session);
      set.type = body.type;
    }
    if (body.skills !== undefined) set.skills = [...new Set(body.skills)];
    if (body.status !== undefined) set.status = body.status;
    for (const key of ['contactName', 'email', 'phone', 'country', 'defaultCurrency', 'gstin', 'notes', 'paymentNote'] as const) field(key);

    // Work out what would change BEFORE writing: a request that changes nothing writes nothing.
    const prospective = { ...before, ...set } as ThirdPartyDoc;
    for (const key of Object.keys(unset)) delete (prospective as unknown as Record<string, unknown>)[key];
    const changes = diffFields(trackable(before), trackable(prospective), TRACKED);
    if (changes.length === 0) return toDTO(before, viewer, canSeeMoney(viewer) ? ((await moneyFor([before._id])).get(String(before._id)) ?? emptyMoney()) : null);

    set.updatedBy = snapshot(viewer);
    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length) update.$unset = unset;
    const after = await ThirdParty.findOneAndUpdate({ _id: before._id }, update, { returnDocument: 'after', session, runValidators: true })
      .select('+paymentNote')
      .lean();
    if (!after) throw notFound('We could not find that third party');
    await audit(
      {
        actor: actorOf(viewer),
        action: 'thirdParty.update',
        entity: { type: 'thirdParty', id: String(after._id), ref: after.ref, label: after.name },
        changes,
        meta,
      },
      session,
    );
    return toDTO(after, viewer, canSeeMoney(viewer) ? ((await moneyFor([after._id])).get(String(after._id)) ?? emptyMoney()) : null);
  });
}

/**
 * Archive instead of delete: the third party, its work orders and its payouts stay, and it leaves the
 * pickers and default lists. Refused while open work orders or payouts that are still due refer to it:
 * settle or close those first, so nothing we owe is left under a name nobody can pick.
 */
export async function archiveThirdParty(viewer: SessionUser, id: string, meta: ServiceMeta = {}): Promise<ThirdPartyDTO> {
  assertCapability(viewer, 'thirdParty:edit');
  id = parseObjectId(id);
  return withTransaction(async (session) => {
    // The first write: a work order or payout being recorded for this third party at the same moment conflicts here.
    const touched = await ThirdParty.findOneAndUpdate({ _id: oid(id) }, { $currentDate: { updatedAt: true } }, { returnDocument: 'after', session, timestamps: false })
      .select('+paymentNote')
      .lean();
    if (!touched) throw notFound('We could not find that third party');
    if (touched.archivedAt) throw conflict('That third party is already archived');
    const open = await WorkOrder.countDocuments({ thirdPartyId: touched._id, status: mongoose.trusted({ $in: ['open', 'delivered'] }) }).session(session);
    const due = await ThirdPartyPayout.countDocuments({ thirdPartyId: touched._id, status: 'due' }).session(session);
    if (open > 0 || due > 0) {
      const parts = [open > 0 ? `${open} open ${open === 1 ? 'work order' : 'work orders'}` : null, due > 0 ? `${due} ${due === 1 ? 'payout' : 'payouts'} still due` : null].filter(Boolean);
      throw conflict(`This third party still has ${parts.join(' and ')}. Close, cancel or settle ${open + due === 1 ? 'it' : 'them'} first.`);
    }
    const after = await ThirdParty.findOneAndUpdate(
      { _id: touched._id },
      { $set: { archivedAt: new Date(), archivedBy: snapshot(viewer), updatedBy: snapshot(viewer) } },
      { returnDocument: 'after', session },
    )
      .select('+paymentNote')
      .lean();
    if (!after) throw notFound('We could not find that third party');
    await audit(
      {
        actor: actorOf(viewer),
        action: 'thirdParty.archive',
        entity: { type: 'thirdParty', id: String(after._id), ref: after.ref, label: after.name },
        changes: [{ path: 'archived', before: false, after: true }],
        meta,
      },
      session,
    );
    return toDTO(after, viewer, canSeeMoney(viewer) ? ((await moneyFor([after._id])).get(String(after._id)) ?? emptyMoney()) : null);
  });
}

export async function restoreThirdParty(viewer: SessionUser, id: string, meta: ServiceMeta = {}): Promise<ThirdPartyDTO> {
  assertCapability(viewer, 'thirdParty:edit');
  id = parseObjectId(id);
  return withTransaction(async (session) => {
    const doc = await loadForWrite(id, session);
    if (!doc.archivedAt) throw conflict('That third party is not archived');
    const after = await ThirdParty.findOneAndUpdate(
      { _id: doc._id },
      { $unset: { archivedAt: 1, archivedBy: 1 }, $set: { updatedBy: snapshot(viewer) } },
      { returnDocument: 'after', session },
    )
      .select('+paymentNote')
      .lean();
    if (!after) throw notFound('We could not find that third party');
    await audit(
      {
        actor: actorOf(viewer),
        action: 'thirdParty.restore',
        entity: { type: 'thirdParty', id: String(after._id), ref: after.ref, label: after.name },
        changes: [{ path: 'archived', before: true, after: false }],
        meta,
      },
      session,
    );
    return toDTO(after, viewer, canSeeMoney(viewer) ? ((await moneyFor([after._id])).get(String(after._id)) ?? emptyMoney()) : null);
  });
}
