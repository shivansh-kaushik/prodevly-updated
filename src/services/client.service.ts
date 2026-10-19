import { Types, type ClientSession } from 'mongoose';
import { mongoose, connectToDatabase, withTransaction } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { CLIENT_KINDS, CLIENT_SOURCES, CLIENT_STATUSES } from '@/config/statuses';
import { conflict, forbidden, hasLinkedRecords, notFound, validationFailed } from '@/lib/api/errors';
import { escapeRegex, pageMeta, type PageMeta } from '@/lib/admin/search-params';
import { normaliseContacts, type CreateClientInput, type UpdateClientInput } from '@/lib/validation/client';
import { parseObjectId } from '@/lib/validation/common';
import {
  Admin,
  Client,
  ClientPayment,
  Expense,
  Lead,
  Project,
  Task,
  TeamPayout,
  ThirdPartyPayout,
  WorkLog,
  WorkOrder,
  type ClientDoc,
} from '@/models';
import type { SessionUser } from '@/types/session';
import type { ServiceMeta } from './admin.service';
import { audit, diffFields, type AuditActor } from './audit.service';
import { nextRef } from './refs';
import { getSettings, loadSettings } from './settings.service';

/**
 * Clients (plan sections 2, 3 and 8).
 *
 * - view: client:view. Create and edit: client:edit. Archive and restore: client:archive.
 *   Permanent delete: client:delete (superadmin only) and ONLY when nothing links to the client.
 * - The internal client ("ProDevly (internal)", made by the seed) holds our own projects. It can
 *   never be archived, deleted, renamed or re-statused, and its receipts are never revenue.
 * - Every write is one transaction with its audit entry on the same session, carrying
 *   context.clientId so a client's whole history can be filtered.
 * - A client's name is snapshotted on its projects (`Project.clientName`), so a rename updates them
 *   in the same transaction.
 */

const actorOf = (v: SessionUser): AuditActor => ({ id: v.id, name: v.name, role: v.role });
const snapshot = (v: SessionUser) => ({ id: new Types.ObjectId(v.id), name: v.name });
const iso = (d?: Date | null) => (d ? d.toISOString() : null);
const clean = (v: string | undefined) => (v === undefined ? undefined : v.trim());
/** An empty string from a form means "clear this field". */
const orUnset = (v: string | undefined) => (v === undefined ? undefined : v === '' ? null : v);

/* ------------------------------- DTOs ------------------------------- */

export interface ClientContactDTO {
  name: string;
  email: string | null;
  phone: string | null;
  designation: string | null;
  isPrimary: boolean;
}

export interface ClientDTO {
  id: string;
  ref: string;
  name: string;
  kind: ClientDoc['kind'];
  status: ClientDoc['status'];
  isInternal: boolean;
  industry: string | null;
  country: string | null;
  billingCurrency: string | null;
  gstin: string | null;
  taxId: string | null;
  website: string | null;
  address: { line1: string | null; line2: string | null; city: string | null; state: string | null; postalCode: string | null; country: string | null };
  contacts: ClientContactDTO[];
  accountOwner: { id: string | null; name: string } | null;
  source: ClientDoc['source'] | null;
  leadId: string | null;
  notes: string | null;
  tags: string[];
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toClientDTO(c: ClientDoc): ClientDTO {
  return {
    id: String(c._id),
    ref: c.ref,
    name: c.name,
    kind: c.kind,
    status: c.status,
    isInternal: c.isInternal,
    industry: c.industry ?? null,
    country: c.country ?? null,
    billingCurrency: c.billingCurrency ?? null,
    gstin: c.gstin ?? null,
    taxId: c.taxId ?? null,
    website: c.website ?? null,
    address: {
      line1: c.address?.line1 ?? null,
      line2: c.address?.line2 ?? null,
      city: c.address?.city ?? null,
      state: c.address?.state ?? null,
      postalCode: c.address?.postalCode ?? null,
      country: c.address?.country ?? null,
    },
    contacts: (c.contacts ?? []).map((k) => ({ name: k.name, email: k.email ?? null, phone: k.phone ?? null, designation: k.designation ?? null, isPrimary: k.isPrimary })),
    accountOwner: c.accountOwner ? { id: c.accountOwner.id ? String(c.accountOwner.id) : null, name: c.accountOwner.name } : null,
    source: c.source ?? null,
    leadId: c.leadId ? String(c.leadId) : null,
    notes: c.notes ?? null,
    tags: c.tags ?? [],
    archivedAt: iso(c.archivedAt),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/* -------------------------------- reads -------------------------------- */

export const CLIENT_SORTS = ['updatedAt', 'createdAt', 'name', 'ref', 'status'] as const;

export interface ClientQuery {
  q?: string;
  status?: ClientDoc['status'];
  kind?: ClientDoc['kind'];
  /** ISO 3166-1 alpha-2. */
  country?: string;
  ownerId?: string;
  /** Archived clients are hidden unless asked for. */
  archived?: 'only' | 'include';
  sort?: (typeof CLIENT_SORTS)[number];
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface ClientListItem {
  id: string;
  ref: string;
  name: string;
  kind: ClientDoc['kind'];
  status: ClientDoc['status'];
  isInternal: boolean;
  country: string | null;
  billingCurrency: string | null;
  primaryContact: { name: string; email: string | null } | null;
  accountOwner: string | null;
  /** Projects that are not archived. */
  projectCount: number;
  archived: boolean;
  updatedAt: string;
}

export async function listClients(viewer: SessionUser, query: ClientQuery = {}): Promise<{ items: ClientListItem[]; meta: PageMeta }> {
  assertCapability(viewer, 'client:view');
  await connectToDatabase();

  const filter: Record<string, unknown> = {};
  if (query.archived === 'only') filter.archivedAt = mongoose.trusted({ $ne: null });
  else if (query.archived !== 'include') filter.archivedAt = null;
  if (query.status && CLIENT_STATUSES.includes(query.status)) filter.status = query.status;
  if (query.kind && CLIENT_KINDS.includes(query.kind)) filter.kind = query.kind;
  if (query.country && /^[A-Za-z]{2}$/.test(query.country)) filter.country = query.country.toUpperCase();
  if (query.ownerId) filter['accountOwner.id'] = parseObjectId(query.ownerId);
  if (query.q) {
    const text = query.q.slice(0, 80);
    const lower = new RegExp(escapeRegex(text.toLowerCase()));
    const any = new RegExp(escapeRegex(text), 'i');
    filter.$or = [{ nameLower: lower }, { ref: any }, { 'contacts.email': any }, { 'contacts.name': any }];
  }

  const sort = query.sort && CLIENT_SORTS.includes(query.sort) ? query.sort : 'updatedAt';
  const sortField = sort === 'name' ? 'nameLower' : sort;
  const dir = (query.dir ?? (sort === 'name' || sort === 'ref' ? 'asc' : 'desc')) === 'asc' ? 1 : -1;
  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), 100);

  const total = await Client.countDocuments(filter);
  const meta = pageMeta(Math.max(query.page ?? 1, 1), pageSize, total);
  const rows = await Client.find(filter)
    .sort({ [sortField]: dir, _id: 1 })
    .skip((meta.page - 1) * pageSize)
    .limit(pageSize)
    .lean();

  const counts = new Map<string, number>();
  if (rows.length > 0) {
    const grouped = await Project.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { clientId: { $in: rows.map((r) => r._id) }, archivedAt: null } },
      { $group: { _id: '$clientId', n: { $sum: 1 } } },
    ]);
    for (const g of grouped) counts.set(String(g._id), g.n);
  }

  return {
    meta,
    items: rows.map((c) => {
      const primary = (c.contacts ?? []).find((k) => k.isPrimary) ?? c.contacts?.[0];
      return {
        id: String(c._id),
        ref: c.ref,
        name: c.name,
        kind: c.kind,
        status: c.status,
        isInternal: c.isInternal,
        country: c.country ?? null,
        billingCurrency: c.billingCurrency ?? null,
        primaryContact: primary ? { name: primary.name, email: primary.email ?? null } : null,
        accountOwner: c.accountOwner?.name ?? null,
        projectCount: counts.get(String(c._id)) ?? 0,
        archived: Boolean(c.archivedAt),
        updatedAt: c.updatedAt.toISOString(),
      };
    }),
  };
}

export async function getClientById(viewer: SessionUser, id: string): Promise<ClientDTO> {
  assertCapability(viewer, 'client:view');
  await connectToDatabase();
  const doc = await Client.findById(parseObjectId(id)).lean();
  if (!doc) throw notFound('We could not find that client');
  return toClientDTO(doc);
}

/** Distinct countries in use, for the list filter. */
export async function listClientCountries(viewer: SessionUser): Promise<string[]> {
  assertCapability(viewer, 'client:view');
  await connectToDatabase();
  const rows = await Client.distinct('country', { archivedAt: null });
  return (rows as Array<string | null>).filter((c): c is string => Boolean(c)).sort();
}

/* ------------------------------- writes -------------------------------- */

async function resolveOwner(accountOwnerId: string | undefined, session: ClientSession): Promise<{ id: Types.ObjectId; name: string } | null | undefined> {
  if (accountOwnerId === undefined) return undefined;
  if (accountOwnerId === '') return null;
  const owner = await Admin.findById(parseObjectId(accountOwnerId)).select('name status').session(session).lean();
  if (!owner || owner.status !== 'active') throw validationFailed({ accountOwnerId: 'Pick an active team member' });
  return { id: owner._id, name: owner.name };
}

async function assertBillingCurrency(currency: string | undefined, session: ClientSession): Promise<void> {
  if (!currency) return;
  const settings = await loadSettings(session);
  if (!settings.enabledCurrencies.includes(currency)) {
    throw validationFailed({ billingCurrency: 'That currency is not switched on in Settings' });
  }
}

async function assertNameFree(name: string, exceptId: Types.ObjectId | null, session: ClientSession): Promise<void> {
  const lower = name.trim().toLowerCase();
  const filter: Record<string, unknown> = { nameLower: lower, archivedAt: null };
  if (exceptId) filter._id = mongoose.trusted({ $ne: exceptId });
  const taken = await Client.exists(filter).session(session);
  if (taken) throw conflict('A client with this name already exists', { name: 'A client with this name already exists' });
  const internal = await Client.findOne({ isInternal: true }).select('nameLower').session(session).lean();
  if (internal && internal.nameLower === lower && !exceptId) throw conflict('That name is reserved for our own projects', { name: 'That name is reserved' });
}

function contactsFrom(input: CreateClientInput['contacts']) {
  const { contacts, error } = normaliseContacts(input);
  if (error) throw validationFailed({ contacts: error });
  return contacts.map((c) => ({
    name: c.name.trim(),
    email: c.email ? c.email.toLowerCase() : undefined,
    phone: clean(c.phone) || undefined,
    designation: clean(c.designation) || undefined,
    isPrimary: c.isPrimary,
  }));
}

export interface CreateClientExtras {
  /** The enquiry this client came from. Sets source to "enquiry". */
  leadId?: string;
}

/**
 * Creates a client inside a transaction the CALLER owns, so another operation (the enquiry
 * conversion) can create a client and a project atomically. Checks client:edit itself.
 */
export async function createClientInTx(
  viewer: SessionUser,
  input: CreateClientInput,
  session: ClientSession,
  meta: ServiceMeta = {},
  extras: CreateClientExtras = {},
): Promise<ClientDTO> {
  assertCapability(viewer, 'client:edit');
  await assertNameFree(input.name, null, session);
  await assertBillingCurrency(input.billingCurrency || undefined, session);
  const owner = await resolveOwner(input.accountOwnerId, session);

  const [created] = await Client.create(
    [
      {
        ref: await nextRef('client', session),
        name: input.name.trim(),
        kind: input.kind,
        status: input.status,
        isInternal: false,
        industry: clean(input.industry) || undefined,
        country: input.country || undefined,
        billingCurrency: input.billingCurrency || undefined,
        gstin: input.gstin || undefined,
        taxId: clean(input.taxId) || undefined,
        website: clean(input.website) || undefined,
        address: input.address ? Object.fromEntries(Object.entries(input.address).filter(([, v]) => v !== undefined && v !== '')) : undefined,
        contacts: contactsFrom(input.contacts),
        accountOwner: owner ?? undefined,
        source: extras.leadId ? 'enquiry' : input.source || undefined,
        leadId: extras.leadId ? new Types.ObjectId(parseObjectId(extras.leadId)) : undefined,
        notes: clean(input.notes) || undefined,
        tags: input.tags,
        createdBy: snapshot(viewer),
      },
    ],
    { session },
  );
  if (!created) throw new Error('Client was not created');
  await audit(
    {
      actor: actorOf(viewer),
      action: 'client.create',
      entity: { type: 'client', id: String(created._id), ref: created.ref, label: created.name },
      summary: extras.leadId ? 'Created from an enquiry' : undefined,
      context: { clientId: String(created._id) },
      meta,
    },
    session,
  );
  return toClientDTO(created.toObject());
}

export async function createClient(viewer: SessionUser, input: CreateClientInput, meta: ServiceMeta = {}): Promise<ClientDTO> {
  assertCapability(viewer, 'client:edit');
  return withTransaction((session) => createClientInTx(viewer, input, session, meta));
}

const DIFF_FIELDS = ['name', 'kind', 'status', 'industry', 'country', 'billingCurrency', 'gstin', 'taxId', 'website', 'source', 'notes', 'tags', 'accountOwner.name', 'contacts'] as const;

export async function updateClient(viewer: SessionUser, id: string, patch: UpdateClientInput, meta: ServiceMeta = {}): Promise<ClientDTO> {
  assertCapability(viewer, 'client:edit');
  const clientId = new Types.ObjectId(parseObjectId(id));

  return withTransaction(async (session) => {
    const before = await Client.findById(clientId).session(session).lean();
    if (!before) throw notFound('We could not find that client');
    if (before.isInternal && (patch.name !== undefined || patch.status !== undefined || patch.kind !== undefined)) {
      throw conflict('The internal client keeps its name, kind and status', { name: 'The internal client cannot be renamed' });
    }
    if (patch.name !== undefined && patch.name.trim().toLowerCase() !== before.nameLower) await assertNameFree(patch.name, clientId, session);
    if (patch.billingCurrency && patch.billingCurrency !== before.billingCurrency) await assertBillingCurrency(patch.billingCurrency, session);
    const owner = await resolveOwner(patch.accountOwnerId, session);

    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    const put = (key: string, value: unknown) => {
      if (value === undefined) return;
      if (value === null) unset[key] = 1;
      else set[key] = value;
    };
    if (patch.name !== undefined) {
      set.name = patch.name.trim();
      set.nameLower = patch.name.trim().toLowerCase(); // findOneAndUpdate skips the validate hook that normally sets it
    }
    if (patch.kind !== undefined) set.kind = patch.kind;
    if (patch.status !== undefined) set.status = patch.status;
    put('industry', orUnset(clean(patch.industry)));
    put('country', orUnset(patch.country));
    put('billingCurrency', orUnset(patch.billingCurrency));
    put('gstin', orUnset(patch.gstin));
    put('taxId', orUnset(clean(patch.taxId)));
    put('website', orUnset(clean(patch.website)));
    put('notes', orUnset(clean(patch.notes)));
    put('source', orUnset(patch.source));
    if (patch.tags !== undefined) set.tags = patch.tags;
    if (patch.contacts !== undefined) set.contacts = contactsFrom(patch.contacts);
    if (patch.address !== undefined) set.address = Object.fromEntries(Object.entries(patch.address).filter(([, v]) => v !== undefined && v !== ''));
    if (owner === null) unset.accountOwner = 1;
    else if (owner) set.accountOwner = owner;
    set.updatedBy = snapshot(viewer);

    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length > 0) update.$unset = unset;
    const after = await Client.findOneAndUpdate({ _id: clientId }, update, { returnDocument: 'after', session, runValidators: true }).lean();
    if (!after) throw notFound('We could not find that client');

    // Projects keep a snapshot of the name so lists render without a join.
    if (after.name !== before.name) await Project.updateMany({ clientId }, { $set: { clientName: after.name } }, { session });

    await audit(
      {
        actor: actorOf(viewer),
        action: 'client.update',
        entity: { type: 'client', id: String(clientId), ref: after.ref, label: after.name },
        changes: diffFields(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, DIFF_FIELDS),
        context: { clientId: String(clientId) },
        meta,
      },
      session,
    );
    return toClientDTO(after);
  });
}

async function setArchived(viewer: SessionUser, id: string, archived: boolean, meta: ServiceMeta): Promise<ClientDTO> {
  assertCapability(viewer, 'client:archive');
  const clientId = new Types.ObjectId(parseObjectId(id));
  return withTransaction(async (session) => {
    const before = await Client.findById(clientId).session(session).lean();
    if (!before) throw notFound('We could not find that client');
    if (before.isInternal) throw conflict('The internal client cannot be archived');
    if (archived === Boolean(before.archivedAt)) throw conflict(archived ? 'That client is already archived' : 'That client is not archived');

    const update = archived
      ? { $set: { archivedAt: new Date(), archivedBy: snapshot(viewer), updatedBy: snapshot(viewer) } }
      : { $unset: { archivedAt: 1, archivedBy: 1 }, $set: { updatedBy: snapshot(viewer) } };
    const after = await Client.findOneAndUpdate({ _id: clientId }, update, { returnDocument: 'after', session }).lean();
    if (!after) throw notFound('We could not find that client');
    await audit(
      {
        actor: actorOf(viewer),
        action: archived ? 'client.archive' : 'client.restore',
        entity: { type: 'client', id: String(clientId), ref: after.ref, label: after.name },
        context: { clientId: String(clientId) },
        meta,
      },
      session,
    );
    return toClientDTO(after);
  });
}

export const archiveClient = (viewer: SessionUser, id: string, meta: ServiceMeta = {}) => setArchived(viewer, id, true, meta);
export const restoreClient = (viewer: SessionUser, id: string, meta: ServiceMeta = {}) => setArchived(viewer, id, false, meta);

/** Everything that points at a client. Any of these makes a permanent delete impossible. */
export async function countClientLinks(clientId: Types.ObjectId, session?: ClientSession): Promise<Record<string, number>> {
  const [projects, tasks, workLogs, payments, payouts, workOrders, expenses, leads, teamPayouts] = await Promise.all([
    Project.countDocuments({ clientId }).session(session ?? null),
    Task.countDocuments({ clientId }).session(session ?? null),
    WorkLog.countDocuments({ clientId }).session(session ?? null),
    ClientPayment.countDocuments({ clientId }).session(session ?? null),
    ThirdPartyPayout.countDocuments({ clientId }).session(session ?? null),
    WorkOrder.countDocuments({ clientId }).session(session ?? null),
    Expense.countDocuments({ clientId }).session(session ?? null),
    Lead.countDocuments({ convertedClientId: clientId }).session(session ?? null),
    TeamPayout.countDocuments({ 'allocations.clientId': clientId }).session(session ?? null),
  ]);
  return { projects, tasks, workLogs, payments, payouts, workOrders, expenses, enquiries: leads, teamPayouts };
}

/**
 * Permanent delete: superadmin only, only when NOTHING links to the client, and only after the
 * person types the client's name. Anything else is archived instead.
 */
export async function deleteClient(viewer: SessionUser, id: string, confirmName: string, meta: ServiceMeta = {}): Promise<{ id: string }> {
  assertCapability(viewer, 'client:delete');
  const clientId = new Types.ObjectId(parseObjectId(id));

  return withTransaction(async (session) => {
    const doc = await Client.findById(clientId).session(session).lean();
    if (!doc) throw notFound('We could not find that client');
    if (doc.isInternal) throw forbidden('The internal client cannot be deleted');
    if (confirmName.trim() !== doc.name) throw validationFailed({ confirmName: 'That does not match the client name' });

    const links = await countClientLinks(clientId, session);
    const used = Object.entries(links).filter(([, n]) => n > 0);
    if (used.length > 0) {
      const what = used.map(([k, n]) => `${n} ${k.replace(/([A-Z])/g, ' $1').toLowerCase()}`).join(', ');
      throw hasLinkedRecords(`This client has linked records (${what}), so it cannot be deleted. Archive it instead.`);
    }

    await Client.deleteOne({ _id: clientId }, { session });
    await audit(
      {
        actor: actorOf(viewer),
        action: 'client.delete',
        entity: { type: 'client', id: String(clientId), ref: doc.ref, label: doc.name },
        summary: 'Permanently deleted',
        meta,
      },
      session,
    );
    return { id: String(clientId) };
  });
}

/** The settings a client form needs (currencies on, sources). */
export async function getClientFormOptions(): Promise<{ currencies: string[]; sources: readonly string[] }> {
  const settings = await getSettings();
  return { currencies: settings.enabledCurrencies, sources: CLIENT_SOURCES };
}
