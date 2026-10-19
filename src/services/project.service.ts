import { Types, type ClientSession } from 'mongoose';
import { mongoose, connectToDatabase, withTransaction } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import type { Capability } from '@/config/capabilities';
import {
  PROJECT_HEALTH,
  PROJECT_STATUSES,
  PROJECT_TYPES,
  type ProjectStatus,
} from '@/config/statuses';
import { conflict, forbidden, hasLinkedRecords, linkMismatch, notFound, validationFailed } from '@/lib/api/errors';
import { escapeRegex, pageMeta, type PageMeta } from '@/lib/admin/search-params';
import { formatDateOnly, parseDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { humanize } from '@/lib/admin/format';
import { isAllowedMove, moveNeedsNote, moveNeedsSuperadmin, MAX_MILESTONES, WORKING_STATUSES } from '@/lib/validation/project';
import type {
  CreateMilestoneInput,
  CreateProjectInput,
  StatusChangeInput,
  UpdateMilestoneInput,
  UpdateProjectInput,
} from '@/lib/validation/project';
import { parseObjectId } from '@/lib/validation/common';
import {
  Admin,
  Client,
  ClientPayment,
  Expense,
  Project,
  Task,
  TeamPayout,
  ThirdPartyPayout,
  WorkLog,
  WorkOrder,
  type ProjectDoc,
} from '@/models';
import type { SessionUser } from '@/types/session';
import type { ServiceMeta } from './admin.service';
import { audit, diffFields, type AuditActor } from './audit.service';
import { nextRef } from './refs';
import { getSettings } from './settings.service';

/**
 * Projects (plan sections 2, 3 and 8).
 *
 * Who may do what, all enforced here and again in the route layer:
 * - view: project:view. Contract, milestones, the agreed price and the cost budget are money, so they
 *   only appear in a DTO (`money`) for viewers with payment:view.
 * - create, edit, change status, manage the team: project:edit. Editing contract, milestones or the
 *   cost budget also needs payment:record.
 * - archive and restore: project:archive.
 * - reopening a closed or cancelled project: project:reopen (superadmins only).
 *
 * Every mutation is one transaction with its audit entry on the same session. The client and its name
 * are derived from the client record, never trusted from the request, and a project cannot move to
 * another client once work or money is recorded against it.
 */

/**
 * Plan section 1: closed and cancelled projects are reopened by a superadmin only. That is the
 * non-grantable `project:reopen` capability, so code never branches on a role name.
 */
const REOPEN_CAPABILITY: Capability = 'project:reopen';

/** Whether this viewer may reopen a closed or cancelled project. The status dialog uses it to decide what to offer. */
export const canReopenProjects = (v: Pick<SessionUser, 'capabilities'>) => v.capabilities.has(REOPEN_CAPABILITY);

const actorOf = (v: SessionUser): AuditActor => ({ id: v.id, name: v.name, role: v.role });
const snapshot = (v: SessionUser) => ({ id: new Types.ObjectId(v.id), name: v.name });
const iso = (d?: Date | null) => (d ? d.toISOString() : null);
const day = (d?: Date | null) => (d ? formatDateOnly(d) : null);

/* ------------------------------- DTOs ------------------------------- */

export interface MilestoneDTO {
  id: string;
  title: string;
  /** In the contract currency. */
  amountMinor: number;
  dueOn: string | null;
  status: 'pending' | 'invoiced' | 'paid';
  invoiceRef: string | null;
}

export interface ProjectMoneyDTO {
  contract: {
    pricingModel: ProjectDoc['contract']['pricingModel'];
    amountMinor: number;
    currency: string;
    hourlyRateMinor: number | null;
    retainerMonthlyMinor: number | null;
  };
  milestones: MilestoneDTO[];
  costBudgetInrMinor: number | null;
  /** The price as first agreed. The scope and deadline half of the snapshot is on `agreed`. */
  agreedAmount: { amountMinor: number; currency: string } | null;
}

export interface ProjectDTO {
  id: string;
  ref: string;
  clientId: string;
  clientName: string;
  name: string;
  type: ProjectDoc['type'];
  status: ProjectStatus;
  health: ProjectDoc['health'];
  priority: ProjectDoc['priority'];
  lead: { id: string | null; name: string } | null;
  memberIds: string[];
  startOn: string | null;
  deadlineOn: string | null;
  deliveredOn: string | null;
  /** Set once, when the project first became active. Never edited. */
  agreed: { scope: string | null; deadlineOn: string | null; capturedAt: string; capturedBy: string } | null;
  scopeSummary: string | null;
  links: { repo: string | null; staging: string | null; live: string | null; design: string | null };
  tags: string[];
  statusHistory: Array<{ from: string | null; to: string; at: string; by: string; note: string | null }>;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present only for viewers with payment:view. */
  money: ProjectMoneyDTO | null;
}

const canSeeMoney = (v: Pick<SessionUser, 'capabilities'>) => v.capabilities.has('payment:view');

export function toMilestoneDTO(m: ProjectDoc['milestones'][number]): MilestoneDTO {
  return {
    id: String(m._id),
    title: m.title,
    amountMinor: m.amountMinor,
    dueOn: day(m.dueOn),
    status: m.status,
    invoiceRef: m.invoiceRef ?? null,
  };
}

export function toProjectDTO(p: ProjectDoc, viewer: Pick<SessionUser, 'capabilities'>): ProjectDTO {
  return {
    id: String(p._id),
    ref: p.ref,
    clientId: String(p.clientId),
    clientName: p.clientName,
    name: p.name,
    type: p.type,
    status: p.status,
    health: p.health,
    priority: p.priority,
    lead: p.lead ? { id: p.lead.id ? String(p.lead.id) : null, name: p.lead.name } : null,
    memberIds: (p.memberIds ?? []).map(String),
    startOn: day(p.startOn),
    deadlineOn: day(p.deadlineOn),
    deliveredOn: day(p.deliveredOn),
    agreed: p.agreed
      ? { scope: p.agreed.scope ?? null, deadlineOn: day(p.agreed.deadlineOn), capturedAt: p.agreed.capturedAt.toISOString(), capturedBy: p.agreed.capturedBy.name }
      : null,
    scopeSummary: p.scopeSummary ?? null,
    links: { repo: p.links?.repo ?? null, staging: p.links?.staging ?? null, live: p.links?.live ?? null, design: p.links?.design ?? null },
    tags: p.tags ?? [],
    statusHistory: (p.statusHistory ?? []).map((h) => ({ from: h.from, to: h.to, at: h.at.toISOString(), by: h.by.name, note: h.note ?? null })),
    archivedAt: iso(p.archivedAt),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    money: canSeeMoney(viewer)
      ? {
          contract: {
            pricingModel: p.contract.pricingModel,
            amountMinor: p.contract.amountMinor,
            currency: p.contract.currency,
            hourlyRateMinor: p.contract.hourlyRateMinor ?? null,
            retainerMonthlyMinor: p.contract.retainerMonthlyMinor ?? null,
          },
          milestones: (p.milestones ?? []).map(toMilestoneDTO),
          costBudgetInrMinor: p.costBudgetInrMinor ?? null,
          agreedAmount: p.agreed ? { amountMinor: p.agreed.amountMinor, currency: p.agreed.currency } : null,
        }
      : null,
  };
}

/* ------------------------------ helpers ------------------------------ */

async function loadProject(id: string, session: ClientSession): Promise<ProjectDoc> {
  const doc = await Project.findById(id).session(session).lean();
  if (!doc) throw notFound('We could not find that project');
  return doc;
}

function assertNotArchived(p: ProjectDoc) {
  if (p.archivedAt) throw conflict('Restore this project before changing it');
}

async function assertCurrencyEnabled(code: string) {
  const settings = await getSettings();
  if (!settings.enabledCurrencies.includes(code)) {
    throw validationFailed({ 'contract.currency': 'That currency is not enabled. A superadmin can enable it in Settings.' });
  }
}

/** The client a project is for: must exist and not be archived. Read inside the transaction so a client created a moment ago is visible. */
async function resolveClient(clientId: string, session: ClientSession) {
  const client = await Client.findById(parseObjectId(clientId)).session(session).select('name archivedAt').lean();
  if (!client || client.archivedAt) throw validationFailed({ clientId: 'Pick a client that exists and is not archived' });
  return client;
}

/** Active admins among `ids`, as id to name. */
async function activeAdminNames(ids: string[], session: ClientSession): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await Admin.find({ _id: mongoose.trusted({ $in: ids.map((i) => new Types.ObjectId(i)) }), status: 'active' })
    .select('name')
    .session(session)
    .lean();
  return new Map(rows.map((r) => [String(r._id), r.name]));
}

function parseDate(value: string, field: string): Date {
  const parsed = parseDateOnly(value);
  if (!parsed) throw validationFailed({ [field]: 'Enter a valid date' });
  return parsed;
}

function assertDeadlineAfterStart(startOn?: Date, deadlineOn?: Date) {
  if (startOn && deadlineOn && deadlineOn < startOn) throw validationFailed({ deadlineOn: 'The deadline cannot be before the start date' });
}

const tidyTags = (tags: string[]) => [...new Set(tags.map((t) => t.trim()).filter(Boolean))];

/** Fixed and milestone projects cannot have milestones adding up to more than the contract. */
function assertWithinContract(contract: Pick<ProjectDoc['contract'], 'pricingModel' | 'amountMinor'>, milestoneAmounts: number[], field: string) {
  if (contract.pricingModel !== 'fixed' && contract.pricingModel !== 'milestone') return;
  const total = milestoneAmounts.reduce((a, b) => a + b, 0);
  if (total > contract.amountMinor) {
    throw validationFailed({
      [field]: contract.amountMinor === 0 ? 'Set the contract amount first: milestones cannot add up to more than it' : 'The milestones would add up to more than the contract amount',
    });
  }
}

/** True when work or money already references the project, so it cannot move to another client. */
async function hasWorkOrMoney(projectId: Types.ObjectId, session: ClientSession): Promise<boolean> {
  // Sequential on purpose: operations in one transaction share a session and must not overlap.
  if (await WorkLog.exists({ projectId }).session(session)) return true;
  if (await ClientPayment.exists({ projectId }).session(session)) return true;
  if (await ThirdPartyPayout.exists({ projectId }).session(session)) return true;
  if (await Expense.exists({ projectId }).session(session)) return true;
  if (await TeamPayout.exists({ 'allocations.projectId': projectId }).session(session)) return true;
  if (await WorkOrder.exists({ projectId }).session(session)) return true;
  return false;
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), source);
}

const UPDATE_AUDIT_FIELDS = [
  'name', 'type', 'health', 'priority', 'clientId', 'clientName', 'lead.name', 'memberIds', 'startOn', 'deadlineOn',
  'contract.pricingModel', 'contract.amountMinor', 'contract.currency', 'contract.hourlyRateMinor', 'contract.retainerMonthlyMinor',
  'costBudgetInrMinor', 'scopeSummary', 'links.repo', 'links.staging', 'links.live', 'links.design', 'tags',
] as const;

/* ------------------------------- reads ------------------------------- */

export const PROJECT_SORTS = ['updatedAt', 'createdAt', 'name', 'ref', 'deadlineOn', 'status'] as const;

export interface ProjectQuery {
  q?: string;
  status?: ProjectStatus;
  health?: ProjectDoc['health'];
  type?: ProjectDoc['type'];
  clientId?: string;
  leadId?: string;
  memberId?: string;
  /** Archived projects are hidden unless asked for. */
  archived?: 'only' | 'include';
  sort?: (typeof PROJECT_SORTS)[number];
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  now?: Date;
}

export interface ProjectListItem {
  id: string;
  ref: string;
  name: string;
  clientId: string;
  clientName: string;
  type: ProjectDoc['type'];
  status: ProjectStatus;
  health: ProjectDoc['health'];
  priority: ProjectDoc['priority'];
  lead: string | null;
  memberCount: number;
  startOn: string | null;
  deadlineOn: string | null;
  deliveredOn: string | null;
  /** Deadline passed and the work is not delivered. */
  overdue: boolean;
  archived: boolean;
  updatedAt: string;
  /** Contract price: only for viewers with payment:view. */
  contract: { pricingModel: string; amountMinor: number; currency: string } | null;
}

export async function listProjects(viewer: SessionUser, query: ProjectQuery = {}): Promise<{ items: ProjectListItem[]; meta: PageMeta }> {
  assertCapability(viewer, 'project:view');
  await connectToDatabase();

  const filter: Record<string, unknown> = {};
  if (query.archived === 'only') filter.archivedAt = mongoose.trusted({ $ne: null });
  else if (query.archived !== 'include') filter.archivedAt = null;
  if (query.status && PROJECT_STATUSES.includes(query.status)) filter.status = query.status;
  if (query.health && PROJECT_HEALTH.includes(query.health)) filter.health = query.health;
  if (query.type && PROJECT_TYPES.includes(query.type)) filter.type = query.type;
  if (query.clientId) filter.clientId = parseObjectId(query.clientId);
  if (query.leadId) filter['lead.id'] = parseObjectId(query.leadId);
  if (query.memberId) filter.memberIds = parseObjectId(query.memberId);
  if (query.q) {
    const re = new RegExp(escapeRegex(query.q.slice(0, 80)), 'i');
    filter.$or = [{ name: re }, { ref: re }, { clientName: re }];
  }

  const sort = query.sort && PROJECT_SORTS.includes(query.sort) ? query.sort : 'updatedAt';
  const dir = (query.dir ?? (sort === 'name' || sort === 'ref' || sort === 'deadlineOn' ? 'asc' : 'desc')) === 'asc' ? 1 : -1;
  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), 100);

  const total = await Project.countDocuments(filter);
  const meta = pageMeta(Math.max(query.page ?? 1, 1), pageSize, total);
  const rows = await Project.find(filter)
    .sort({ [sort]: dir, _id: 1 })
    .skip((meta.page - 1) * pageSize)
    .limit(pageSize)
    .lean();

  const { timezone } = await getSettings();
  const today = todayDateOnly(query.now ?? new Date(), timezone);
  const money = canSeeMoney(viewer);
  return {
    meta,
    items: rows.map((p) => ({
      id: String(p._id),
      ref: p.ref,
      name: p.name,
      clientId: String(p.clientId),
      clientName: p.clientName,
      type: p.type,
      status: p.status,
      health: p.health,
      priority: p.priority,
      lead: p.lead?.name ?? null,
      memberCount: p.memberIds?.length ?? 0,
      startOn: day(p.startOn),
      deadlineOn: day(p.deadlineOn),
      deliveredOn: day(p.deliveredOn),
      overdue: Boolean(p.deadlineOn && p.deadlineOn < today && WORKING_STATUSES.includes(p.status)),
      archived: Boolean(p.archivedAt),
      updatedAt: p.updatedAt.toISOString(),
      contract: money ? { pricingModel: p.contract.pricingModel, amountMinor: p.contract.amountMinor, currency: p.contract.currency } : null,
    })),
  };
}

export async function getProject(viewer: SessionUser, id: string): Promise<ProjectDTO> {
  assertCapability(viewer, 'project:view');
  await connectToDatabase();
  const doc = await Project.findById(parseObjectId(id)).lean();
  if (!doc) throw notFound('We could not find that project');
  return toProjectDTO(doc, viewer);
}

/** A client as a picker value, for pre-filling "new project for this client". Needs client:view like the picker itself. */
export async function getClientOption(viewer: SessionUser, clientId: string): Promise<{ id: string; label: string; ref?: string } | null> {
  assertCapability(viewer, 'client:view');
  await connectToDatabase();
  if (!/^[a-f\d]{24}$/i.test(clientId)) return null;
  const client = await Client.findOne({ _id: parseObjectId(clientId), archivedAt: null }).select('name ref').lean();
  return client ? { id: String(client._id), label: client.name, ref: client.ref } : null;
}

/* ------------------------------ create ------------------------------ */

export interface CreateProjectExtras {
  /** Why this project exists, for the audit entry ("Converted from enquiry ENQ-0007"). */
  summary?: string;
}

/**
 * Creates a project inside a transaction the CALLER owns, so an enquiry conversion can create the
 * client and the project (and its own audit entry) atomically. The caller passes the same `session`
 * everywhere; nothing here opens or commits one.
 */
export async function createProjectInTx(
  viewer: SessionUser,
  input: CreateProjectInput,
  session: ClientSession,
  meta: ServiceMeta = {},
  extras: CreateProjectExtras = {},
): Promise<ProjectDTO> {
  assertCapability(viewer, 'project:edit');
  if (input.contract !== undefined || input.costBudgetInrMinor !== undefined) assertCapability(viewer, 'payment:record');

  const client = await resolveClient(input.clientId, session);
  if (input.contract) await assertCurrencyEnabled(input.contract.currency);
  const startOn = input.startOn ? parseDate(input.startOn, 'startOn') : undefined;
  const deadlineOn = input.deadlineOn ? parseDate(input.deadlineOn, 'deadlineOn') : undefined;
  assertDeadlineAfterStart(startOn, deadlineOn);

  // The lead is always a member, so "my projects" (which reads memberIds) finds it.
  const requested = new Set((input.memberIds ?? []).map((i) => parseObjectId(i)));
  const leadId = input.leadId ? parseObjectId(input.leadId) : undefined;
  if (leadId) requested.add(leadId);
  const names = await activeAdminNames([...requested], session);
  if (leadId && !names.has(leadId)) throw validationFailed({ leadId: 'The lead must be an active admin' });
  if ([...requested].some((i) => !names.has(i))) throw validationFailed({ memberIds: 'Every member must be an active admin' });

  const status = input.status ?? 'proposal';
  const now = new Date();
  const by = snapshot(viewer);
  const contract = input.contract ?? { pricingModel: 'fixed' as const, amountMinor: 0, currency: 'INR' };
  const links = Object.fromEntries(Object.entries(input.links ?? {}).filter(([, v]) => v)) as Record<string, string>;

  const [created] = await Project.create(
    [
      {
        ref: await nextRef('project', session),
        clientId: client._id,
        clientName: client.name,
        name: input.name,
        type: input.type,
        status,
        health: input.health ?? 'on_track',
        priority: input.priority ?? 'medium',
        lead: leadId ? { id: new Types.ObjectId(leadId), name: names.get(leadId) } : undefined,
        memberIds: [...requested].map((i) => new Types.ObjectId(i)),
        startOn,
        deadlineOn,
        contract: {
          pricingModel: contract.pricingModel,
          amountMinor: contract.amountMinor,
          currency: contract.currency,
          ...(contract.hourlyRateMinor != null ? { hourlyRateMinor: contract.hourlyRateMinor } : {}),
          ...(contract.retainerMonthlyMinor != null ? { retainerMonthlyMinor: contract.retainerMonthlyMinor } : {}),
        },
        costBudgetInrMinor: input.costBudgetInrMinor,
        scopeSummary: input.scopeSummary || undefined,
        links,
        tags: tidyTags(input.tags ?? []),
        statusHistory: [{ from: null, to: status, at: now, by }],
        // The snapshot of scope, price and deadline as first agreed: written now only if the project starts active.
        agreed:
          status === 'active'
            ? { scope: input.scopeSummary || undefined, amountMinor: contract.amountMinor, currency: contract.currency, deadlineOn, capturedAt: now, capturedBy: by }
            : undefined,
        createdBy: by,
        updatedBy: by,
      },
    ],
    { session },
  );
  if (!created) throw new Error('Project was not created');

  await audit(
    {
      actor: actorOf(viewer),
      action: 'project.create',
      entity: { type: 'project', id: String(created._id), ref: created.ref, label: created.name },
      summary: extras.summary ?? `Created for ${client.name}`,
      changes: [
        { path: 'status', after: status },
        { path: 'clientName', after: client.name },
      ],
      context: { clientId: String(client._id), projectId: String(created._id) },
      meta,
    },
    session,
  );
  return toProjectDTO(created.toObject(), viewer);
}

export async function createProject(viewer: SessionUser, input: CreateProjectInput, meta: ServiceMeta = {}): Promise<ProjectDTO> {
  // Fail fast, before a transaction opens, for the capability checks that need no data.
  assertCapability(viewer, 'project:edit');
  return withTransaction((session) => createProjectInTx(viewer, input, session, meta));
}

/* ------------------------------ update ------------------------------ */

export async function updateProject(viewer: SessionUser, id: string, patch: UpdateProjectInput, meta: ServiceMeta = {}): Promise<ProjectDTO> {
  assertCapability(viewer, 'project:edit');
  // Contract, milestones and the cost budget are money: editing them is a payment:record job.
  if (patch.contract !== undefined || patch.costBudgetInrMinor !== undefined) assertCapability(viewer, 'payment:record');
  const projectId = parseObjectId(id);

  return withTransaction(async (session) => {
    const target = await loadProject(projectId, session);
    assertNotArchived(target);

    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    const put = (path: string, value: unknown) => (value === null || value === undefined ? (unset[path] = 1) : (set[path] = value));

    if (patch.name !== undefined) set.name = patch.name;
    if (patch.type !== undefined) set.type = patch.type;
    if (patch.health !== undefined) set.health = patch.health;
    if (patch.priority !== undefined) set.priority = patch.priority;
    if (patch.scopeSummary !== undefined) put('scopeSummary', patch.scopeSummary || null);
    if (patch.tags !== undefined) set.tags = tidyTags(patch.tags);
    for (const [key, value] of Object.entries(patch.links ?? {})) put(`links.${key}`, value || null);

    const startOn = patch.startOn === undefined ? target.startOn : patch.startOn === null ? undefined : parseDate(patch.startOn, 'startOn');
    const deadlineOn = patch.deadlineOn === undefined ? target.deadlineOn : patch.deadlineOn === null ? undefined : parseDate(patch.deadlineOn, 'deadlineOn');
    assertDeadlineAfterStart(startOn, deadlineOn);
    if (patch.startOn !== undefined) put('startOn', startOn);
    if (patch.deadlineOn !== undefined) put('deadlineOn', deadlineOn);

    // Lead and members. The lead is always a member. Only NEW people must be active: someone already on
    // the team who was deactivated since does not block an unrelated edit.
    if (patch.leadId !== undefined || patch.memberIds !== undefined) {
      const currentLead = target.lead?.id ? String(target.lead.id) : undefined;
      const leadId = patch.leadId === undefined ? currentLead : (patch.leadId ? parseObjectId(patch.leadId) : undefined);
      const members = new Set((patch.memberIds ?? target.memberIds.map(String)).map((i) => parseObjectId(i)));
      if (leadId) members.add(leadId);
      const known = new Set(target.memberIds.map(String));
      const fresh = [...members].filter((i) => !known.has(i));
      const names = await activeAdminNames(fresh, session);
      if (fresh.some((i) => !names.has(i))) throw validationFailed({ [leadId && fresh.includes(leadId) && !names.has(leadId) ? 'leadId' : 'memberIds']: 'Everyone added must be an active admin' });
      if (patch.leadId !== undefined) {
        if (!leadId) unset.lead = 1;
        else if (leadId !== currentLead) {
          const name = names.get(leadId) ?? (await activeAdminNames([leadId], session)).get(leadId);
          if (!name) throw validationFailed({ leadId: 'The lead must be an active admin' });
          set.lead = { id: new Types.ObjectId(leadId), name };
        }
      }
      set.memberIds = [...members].map((i) => new Types.ObjectId(i));
    }

    // Contract and cost budget.
    if (patch.contract) {
      const c = patch.contract;
      const next = {
        pricingModel: c.pricingModel ?? target.contract.pricingModel,
        amountMinor: c.amountMinor ?? target.contract.amountMinor,
        currency: c.currency ?? target.contract.currency,
      };
      if (next.currency !== target.contract.currency) {
        await assertCurrencyEnabled(next.currency);
        // Milestone amounts and every payment's contract equivalent are in the contract currency.
        if (target.milestones.length > 0 || (await ClientPayment.exists({ projectId: target._id }).session(session))) {
          throw conflict('The contract currency is fixed once milestones or payments exist', { 'contract.currency': 'Milestones or payments already use this currency' });
        }
      }
      assertWithinContract(next, target.milestones.map((m) => m.amountMinor), 'contract.amountMinor');
      if (c.pricingModel !== undefined) set['contract.pricingModel'] = c.pricingModel;
      if (c.amountMinor !== undefined) set['contract.amountMinor'] = c.amountMinor;
      if (c.currency !== undefined) set['contract.currency'] = c.currency;
      if (c.hourlyRateMinor !== undefined) put('contract.hourlyRateMinor', c.hourlyRateMinor);
      if (c.retainerMonthlyMinor !== undefined) put('contract.retainerMonthlyMinor', c.retainerMonthlyMinor);
    }
    if (patch.costBudgetInrMinor !== undefined) put('costBudgetInrMinor', patch.costBudgetInrMinor);

    // Moving to another client: only while nothing refers to the project, and the tasks follow it.
    let movedTo: { _id: Types.ObjectId; name: string } | undefined;
    if (patch.clientId !== undefined && parseObjectId(patch.clientId) !== String(target.clientId)) {
      if (await hasWorkOrMoney(target._id, session)) {
        // Their entries carry the old client's id: moving the project would make the two disagree.
        const message = 'This project already has work logs, money or work orders recorded against it, so it cannot move to another client';
        throw linkMismatch(message, { clientId: message });
      }
      movedTo = await resolveClient(patch.clientId, session);
      set.clientId = movedTo._id;
      set.clientName = movedTo.name;
    }

    // Drop what is already so: an edit that changes nothing must not write, bump updatedAt or add an audit entry.
    for (const [path, value] of Object.entries(set)) if (sameValue(readPath(target, path), value)) delete set[path];
    for (const path of Object.keys(unset)) if (readPath(target, path) == null) delete unset[path];
    if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) return toProjectDTO(target, viewer);
    set.updatedBy = snapshot(viewer);
    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length > 0) update.$unset = unset;
    const after = await Project.findOneAndUpdate({ _id: target._id }, update, { returnDocument: 'after', session, runValidators: true }).lean();
    if (!after) throw notFound('We could not find that project');
    if (movedTo) await Task.updateMany({ projectId: target._id }, { $set: { clientId: movedTo._id } }, { session });

    await audit(
      {
        actor: actorOf(viewer),
        action: 'project.update',
        entity: { type: 'project', id: String(after._id), ref: after.ref, label: after.name },
        changes: diffFields(target as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, UPDATE_AUDIT_FIELDS),
        context: { clientId: String(after.clientId), projectId: String(after._id) },
        meta,
      },
      session,
    );
    return toProjectDTO(after, viewer);
  });
}

/* ------------------------------ status ------------------------------ */

export async function changeProjectStatus(viewer: SessionUser, id: string, input: StatusChangeInput, meta: ServiceMeta = {}): Promise<ProjectDTO> {
  assertCapability(viewer, 'project:edit');
  const projectId = parseObjectId(id);
  const { timezone } = await getSettings();
  const note = input.note?.trim() || undefined;

  return withTransaction(async (session) => {
    const target = await loadProject(projectId, session);
    assertNotArchived(target);
    const from = target.status;
    const to = input.to;

    if (from === to) throw conflict(`This project is already ${humanize(to).toLowerCase()}`, { to: 'Pick a different status' });
    if (!isAllowedMove(from, to)) {
      throw conflict(`A project cannot move from ${humanize(from).toLowerCase()} to ${humanize(to).toLowerCase()}`, { to: 'That move is not allowed from the current status' });
    }
    // Permission before the note, so a viewer who may not do this learns nothing about what it takes.
    if (moveNeedsSuperadmin(from, to) && !canReopenProjects(viewer)) {
      throw forbidden('Only a superadmin can reopen a closed or cancelled project');
    }
    if (moveNeedsNote(from, to) && !note) throw validationFailed({ note: 'Say why' });

    const now = new Date();
    const by = snapshot(viewer);
    const set: Record<string, unknown> = {
      status: to,
      updatedBy: by,
    };
    const unset: Record<string, 1> = {};
    if (to === 'delivered') set.deliveredOn = todayDateOnly(now, timezone);
    // Back in progress means it is not delivered any more.
    if (to === 'active') unset.deliveredOn = 1;

    // First time active: record scope, price and deadline as agreed. Written once, never edited.
    const writeAgreed = to === 'active' && !target.agreed;
    if (writeAgreed) {
      set.agreed = {
        scope: target.scopeSummary,
        amountMinor: target.contract.amountMinor,
        currency: target.contract.currency,
        deadlineOn: target.deadlineOn,
        capturedAt: now,
        capturedBy: by,
      };
    }

    const update: Record<string, unknown> = {
      $set: set,
      $push: { statusHistory: { from, to, at: now, by, ...(note ? { note } : {}) } },
    };
    if (Object.keys(unset).length > 0) update.$unset = unset;
    // The filter pins the status we read (a concurrent move loses) and, when writing the snapshot, its absence.
    const after = await Project.findOneAndUpdate(
      { _id: target._id, status: from, ...(writeAgreed ? { agreed: null } : {}) },
      update,
      { returnDocument: 'after', session, runValidators: true },
    ).lean();
    if (!after) throw conflict('Someone else changed this project. Reload and try again.');

    await audit(
      {
        actor: actorOf(viewer),
        action: 'project.status',
        entity: { type: 'project', id: String(after._id), ref: after.ref, label: after.name },
        summary: note,
        changes: [{ path: 'status', before: from, after: to }],
        context: { clientId: String(after.clientId), projectId: String(after._id) },
        meta,
      },
      session,
    );
    return toProjectDTO(after, viewer);
  });
}

/* ----------------------------- milestones ----------------------------- */

/** Milestones are billing: they need project:edit AND payment:record. */
function assertMilestoneAccess(viewer: SessionUser) {
  assertCapability(viewer, 'project:edit');
  assertCapability(viewer, 'payment:record');
}

async function saveMilestoneChange(
  viewer: SessionUser,
  target: ProjectDoc,
  update: Record<string, unknown>,
  filter: Record<string, unknown>,
  summary: string,
  change: { path: string; before?: unknown; after?: unknown },
  meta: ServiceMeta,
  session: ClientSession,
): Promise<ProjectDoc> {
  const after = await Project.findOneAndUpdate({ _id: target._id, ...filter }, update, { returnDocument: 'after', session, runValidators: true }).lean();
  if (!after) throw conflict('The milestones changed while you were working. Reload and try again.');
  await audit(
    {
      actor: actorOf(viewer),
      action: 'project.update',
      entity: { type: 'project', id: String(after._id), ref: after.ref, label: after.name },
      summary,
      changes: [change],
      context: { clientId: String(after.clientId), projectId: String(after._id) },
      meta,
    },
    session,
  );
  return after;
}

export async function addMilestone(viewer: SessionUser, id: string, input: CreateMilestoneInput, meta: ServiceMeta = {}): Promise<ProjectDTO> {
  assertMilestoneAccess(viewer);
  const projectId = parseObjectId(id);
  return withTransaction(async (session) => {
    const target = await loadProject(projectId, session);
    assertNotArchived(target);
    if (target.milestones.length >= MAX_MILESTONES) throw validationFailed({ title: `A project can have up to ${MAX_MILESTONES} milestones` });
    assertWithinContract(target.contract, [...target.milestones.map((m) => m.amountMinor), input.amountMinor], 'amountMinor');

    const milestone = {
      title: input.title,
      amountMinor: input.amountMinor,
      status: 'pending' as const,
      ...(input.dueOn ? { dueOn: parseDate(input.dueOn, 'dueOn') } : {}),
      ...(input.invoiceRef ? { invoiceRef: input.invoiceRef } : {}),
    };
    const after = await saveMilestoneChange(
      viewer, target,
      { $push: { milestones: milestone }, $set: { updatedBy: snapshot(viewer) } },
      { milestones: mongoose.trusted({ $size: target.milestones.length }) },
      `Added milestone "${input.title}"`,
      { path: 'milestones', after: { title: input.title, amountMinor: input.amountMinor, currency: target.contract.currency } },
      meta, session,
    );
    return toProjectDTO(after, viewer);
  });
}

export async function updateMilestone(viewer: SessionUser, id: string, milestoneId: string, patch: UpdateMilestoneInput, meta: ServiceMeta = {}): Promise<ProjectDTO> {
  assertMilestoneAccess(viewer);
  const projectId = parseObjectId(id);
  const mid = parseObjectId(milestoneId);
  return withTransaction(async (session) => {
    const target = await loadProject(projectId, session);
    assertNotArchived(target);
    const current = target.milestones.find((m) => String(m._id) === mid);
    if (!current) throw notFound('We could not find that milestone');

    if (patch.amountMinor !== undefined) {
      const amounts = target.milestones.map((m) => (String(m._id) === mid ? patch.amountMinor! : m.amountMinor));
      assertWithinContract(target.contract, amounts, 'amountMinor');
    }
    const set: Record<string, unknown> = { updatedBy: snapshot(viewer) };
    const unset: Record<string, 1> = {};
    if (patch.title !== undefined) set['milestones.$.title'] = patch.title;
    if (patch.amountMinor !== undefined) set['milestones.$.amountMinor'] = patch.amountMinor;
    if (patch.status !== undefined) set['milestones.$.status'] = patch.status;
    if (patch.dueOn === null) unset['milestones.$.dueOn'] = 1;
    else if (patch.dueOn !== undefined) set['milestones.$.dueOn'] = parseDate(patch.dueOn, 'dueOn');
    if (patch.invoiceRef !== undefined) {
      if (patch.invoiceRef) set['milestones.$.invoiceRef'] = patch.invoiceRef;
      else unset['milestones.$.invoiceRef'] = 1;
    }

    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length > 0) update.$unset = unset;
    const before = toMilestoneDTO(current);
    const after = await saveMilestoneChange(
      viewer, target, update, { 'milestones._id': new Types.ObjectId(mid) },
      `Updated milestone "${current.title}"`,
      { path: `milestones.${mid}`, before, after: { ...before, ...patch } },
      meta, session,
    );
    return toProjectDTO(after, viewer);
  });
}

/** Only a pending milestone that no payment refers to can go: an invoiced or paid one is part of the billing record. */
export async function removeMilestone(viewer: SessionUser, id: string, milestoneId: string, meta: ServiceMeta = {}): Promise<ProjectDTO> {
  assertMilestoneAccess(viewer);
  const projectId = parseObjectId(id);
  const mid = parseObjectId(milestoneId);
  return withTransaction(async (session) => {
    const target = await loadProject(projectId, session);
    assertNotArchived(target);
    const current = target.milestones.find((m) => String(m._id) === mid);
    if (!current) throw notFound('We could not find that milestone');
    if (current.status !== 'pending') throw conflict('Only a pending milestone can be removed. An invoiced or paid one is part of the billing record.');
    if (await ClientPayment.exists({ projectId: target._id, milestoneId: current._id }).session(session)) {
      throw hasLinkedRecords('A payment is recorded against this milestone, so it cannot be removed');
    }
    const after = await saveMilestoneChange(
      viewer, target,
      { $pull: { milestones: { _id: current._id } }, $set: { updatedBy: snapshot(viewer) } },
      { 'milestones._id': current._id },
      `Removed milestone "${current.title}"`,
      { path: `milestones.${mid}`, before: toMilestoneDTO(current) },
      meta, session,
    );
    return toProjectDTO(after, viewer);
  });
}

/* ------------------------- archive and restore ------------------------- */

async function setArchived(viewer: SessionUser, id: string, archive: boolean, reason: string | undefined, meta: ServiceMeta): Promise<ProjectDTO> {
  assertCapability(viewer, 'project:archive');
  const projectId = parseObjectId(id);
  return withTransaction(async (session) => {
    const target = await loadProject(projectId, session);
    if (archive && target.archivedAt) throw conflict('This project is already archived');
    if (!archive && !target.archivedAt) throw conflict('This project is not archived');

    const update = archive
      ? { $set: { archivedAt: new Date(), archivedBy: snapshot(viewer), updatedBy: snapshot(viewer) } }
      : { $unset: { archivedAt: 1, archivedBy: 1 }, $set: { updatedBy: snapshot(viewer) } };
    const after = await Project.findOneAndUpdate({ _id: target._id }, update, { returnDocument: 'after', session }).lean();
    if (!after) throw notFound('We could not find that project');
    await audit(
      {
        actor: actorOf(viewer),
        action: archive ? 'project.archive' : 'project.restore',
        entity: { type: 'project', id: String(after._id), ref: after.ref, label: after.name },
        summary: reason || undefined,
        context: { clientId: String(after.clientId), projectId: String(after._id) },
        meta,
      },
      session,
    );
    return toProjectDTO(after, viewer);
  });
}

/** Archive instead of delete: the project, its tasks, work and money stay; it leaves default lists. */
export const archiveProject = (viewer: SessionUser, id: string, reason?: string, meta: ServiceMeta = {}) => setArchived(viewer, id, true, reason, meta);
export const restoreProject = (viewer: SessionUser, id: string, reason?: string, meta: ServiceMeta = {}) => setArchived(viewer, id, false, reason, meta);

