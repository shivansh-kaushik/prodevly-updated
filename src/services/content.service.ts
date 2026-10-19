import type { ClientSession } from 'mongoose';
import { connectToDatabase, mongoose, withTransaction } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { conflict, notFound, validationFailed } from '@/lib/api/errors';
import { revalidateContent } from '@/lib/content/revalidate';
import { pickFreeSlug, slugify } from '@/lib/content/slug';
import type { ContentDTOMap, ContentType } from '@/lib/content/types';
import { escapeRegex } from '@/lib/admin/search-params';
import { parseObjectId } from '@/lib/validation/common';
import type { ContentInputMap } from '@/lib/validation/content';
import type { ContentStatus } from '@/config/statuses';
import type { SessionUser } from '@/types/session';
import { audit } from './audit.service';
import type { ServiceMeta } from './admin.service';
import { actorSnapshot, applyPatch, auditActorOf, contentChanges, duplicateOn } from './content/helpers';
import { KINDS, parseContentType } from './content/registry';
import type { ContentDocLike, ContentKind, KindContext } from './content/types';

export { parseContentType };

/**
 * Website content: showcase projects, partners, services, pricing plans and developer profiles.
 * One engine serves all five; each type's own fields, links and publish rules live in
 * `content/<type>.ts` (a `ContentKind`).
 *
 * The rules, all enforced HERE and not only in the forms:
 *
 * - Viewing and editing DRAFTS need `content:edit`. Anything that changes what the PUBLIC sees
 *   needs `content:publish`: publishing, unpublishing, archiving, restoring, editing a record
 *   that is already published, and reordering published items.
 * - A record is published only when its gate passes: the client / partner / person has agreed
 *   (a tick), a price exists unless the plan is a quote, a bio is at most 280 characters, and at
 *   most one published plan is highlighted. A published record is held to the SAME gate when
 *   edited, so a live record can never be edited into a state that could not have been published.
 * - Archive instead of delete. Archived records are read-only until restored to a draft.
 * - Every write is audited in the same transaction. After it commits, the type's cache tag is
 *   revalidated so the home page picks the change up.
 */

const SLUG_ATTEMPTS = 3;
const LIST_LIMIT = 300;

const kindOf = (type: ContentType): ContentKind => KINDS[type];

async function nextOrder(kind: ContentKind, session: ClientSession): Promise<number> {
  const top = await kind.model.findOne().sort({ order: -1 }).select('order').session(session).lean();
  return (top?.order ?? -1) + 1;
}

/** A slug nobody uses yet, built from the title. `exceptId` lets a record keep its own slug while renaming. */
async function freeSlug(kind: ContentKind, title: string, session: ClientSession, exceptId?: ContentDocLike['_id']): Promise<string> {
  const base = slugify(title);
  const rows = await kind.model
    .find({
      slug: new RegExp(`^${escapeRegex(base)}(-\\d+)?$`),
      ...(exceptId ? { _id: mongoose.trusted({ $ne: exceptId }) } : {}),
    })
    .select('slug')
    .session(session)
    .lean();
  return pickFreeSlug(base, new Set(rows.map((r) => String((r as { slug?: unknown }).slug))));
}

/** Plain-language problems from a failed gate, as the 422 the form already knows how to show. */
function refusePublish(problems: Record<string, string>): never {
  throw validationFailed(problems, `This cannot be published yet: ${Object.values(problems).join('. ')}.`);
}

async function runGates(kind: ContentKind, doc: ContentDocLike, ctx: KindContext): Promise<void> {
  const problems = { ...kind.gate(doc), ...(await kind.extraPublishChecks?.(doc, ctx)) };
  if (Object.keys(problems).length > 0) refusePublish(problems);
}

/** The partial unique index on highlighted plans fired: two editors raced. Say so plainly. */
function translateRace(error: unknown): never {
  if (duplicateOn(error, 'highlighted')) throw conflict('Another plan was highlighted at the same moment. Refresh and try again.', { highlighted: 'Only one published plan can be highlighted' });
  if (duplicateOn(error, 'adminId')) throw validationFailed({ adminId: 'That team member already has a developer profile.' });
  throw error;
}

/* ------------------------------------------------------------------- reads */

export interface ContentSearch {
  /** Which statuses to show. Omit for all. */
  statuses?: readonly ContentStatus[];
  q?: string;
}

export async function listContent<T extends ContentType>(viewer: SessionUser, type: T, search: ContentSearch = {}): Promise<ContentDTOMap[T][]> {
  assertCapability(viewer, 'content:edit');
  const kind = kindOf(type);
  await connectToDatabase();
  const filter: Record<string, unknown> = {};
  if (search.statuses?.length) filter.status = mongoose.trusted({ $in: [...search.statuses] });
  const q = search.q?.trim().slice(0, 80);
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    filter.$or = kind.searchPaths.map((path) => ({ [path]: re }));
  }
  const docs = await kind.model.find(filter).sort({ order: 1, createdAt: 1, _id: 1 }).limit(LIST_LIMIT).lean();
  return (await kind.toDTOs(docs, viewer)) as ContentDTOMap[T][];
}

export async function getContent<T extends ContentType>(viewer: SessionUser, type: T, id: string): Promise<ContentDTOMap[T]> {
  assertCapability(viewer, 'content:edit');
  const kind = kindOf(type);
  await connectToDatabase();
  const doc = await kind.model.findById(parseObjectId(id)).lean();
  if (!doc) throw notFound(`We could not find that ${kind.noun}`);
  return (await kind.toDTOs([doc], viewer))[0] as ContentDTOMap[T];
}

/* ------------------------------------------------------------------ create */

export async function createContent<T extends ContentType>(
  viewer: SessionUser,
  type: T,
  input: ContentInputMap[T]['create'],
  meta: ServiceMeta = {},
): Promise<ContentDTOMap[T]> {
  assertCapability(viewer, 'content:edit');
  const kind = kindOf(type);

  for (let attempt = 1; ; attempt++) {
    try {
      const created = await withTransaction(async (session) => {
        const ctx: KindContext = { viewer, session };
        const fields = await kind.buildNew(input, ctx);
        const slug = kind.hasSlug ? await freeSlug(kind, kind.titleOf(fields as ContentDocLike), session) : undefined;
        const order = await nextOrder(kind, session);
        const actor = actorSnapshot(viewer);
        const [doc] = await kind.model.create(
          [{ ...fields, ...(slug ? { slug } : {}), status: 'draft', order, createdBy: actor, updatedBy: actor } as unknown as ContentDocLike],
          { session },
        );
        if (!doc) throw new Error('The record was not created');
        const saved = doc.toObject() as ContentDocLike;
        await audit(
          {
            actor: auditActorOf(viewer),
            action: `${kind.actionPrefix}.create`,
            entity: { type: kind.entity, id: String(saved._id), label: kind.titleOf(saved) },
            summary: `Created a draft ${kind.noun}`,
            changes: contentChanges(null, saved, kind.auditFields),
            meta,
          },
          session,
        );
        return saved;
      });
      return (await kind.toDTOs([created], viewer))[0] as ContentDTOMap[T];
    } catch (error) {
      // Two people creating the same title at once: the unique slug index refuses the second.
      // Try again, and the slug search now sees the first one.
      if (duplicateOn(error, 'slug') && attempt < SLUG_ATTEMPTS) continue;
      return translateRace(error);
    }
  }
}

/* ------------------------------------------------------------------ update */

export async function updateContent<T extends ContentType>(
  viewer: SessionUser,
  type: T,
  id: string,
  patch: ContentInputMap[T]['update'],
  meta: ServiceMeta = {},
): Promise<ContentDTOMap[T]> {
  assertCapability(viewer, 'content:edit');
  const kind = kindOf(type);
  const docId = parseObjectId(id);

  for (let attempt = 1; ; attempt++) {
    try {
      const result = await withTransaction(async (session) => {
        const ctx: KindContext = { viewer, session };
        const existing = (await kind.model.findById(docId).session(session).lean()) as ContentDocLike | null;
        if (!existing) throw notFound(`We could not find that ${kind.noun}`);
        if (existing.status === 'archived') throw conflict(`Restore this ${kind.noun} to a draft before changing it`);
        // Editing something that is LIVE changes what the public sees: that is publish authority.
        if (existing.status === 'published') assertCapability(viewer, 'content:publish');

        const fieldPatch = await kind.buildPatch(existing, patch, ctx);

        // A draft's slug follows its title until it has ever been published; after that the URL is frozen.
        if (kind.hasSlug && !existing.publishedAt && typeof fieldPatch.set.title === 'string' && fieldPatch.set.title !== kind.titleOf(existing)) {
          fieldPatch.set.slug = await freeSlug(kind, fieldPatch.set.title, session, existing._id);
        }

        const merged = applyPatch(existing, fieldPatch);
        if (existing.status === 'published') await runGates(kind, merged, ctx);

        // Nothing would change (the form saved what was already there): no write, no audit entry.
        if (contentChanges(existing, merged, kind.auditFields).length === 0) return { doc: existing, changed: false, live: false };

        const update: Record<string, unknown> = { $set: { ...fieldPatch.set, updatedBy: actorSnapshot(viewer) } };
        if (fieldPatch.unset.length) update.$unset = Object.fromEntries(fieldPatch.unset.map((path) => [path, 1]));
        const after = (await kind.model
          .findOneAndUpdate({ _id: existing._id, status: existing.status }, update, { returnDocument: 'after', session, runValidators: true })
          .lean()) as ContentDocLike | null;
        if (!after) throw conflict(`That ${kind.noun} was changed by someone else. Refresh and try again.`);

        const changes = contentChanges(existing, after, kind.auditFields);
        if (changes.length > 0) {
          await audit(
            {
              actor: auditActorOf(viewer),
              action: `${kind.actionPrefix}.update`,
              entity: { type: kind.entity, id: String(after._id), label: kind.titleOf(after) },
              changes,
              meta,
            },
            session,
          );
        }
        return { doc: after, changed: changes.length > 0, live: existing.status === 'published' };
      });
      if (result.changed && result.live) revalidateContent(type);
      return (await kind.toDTOs([result.doc], viewer))[0] as ContentDTOMap[T];
    } catch (error) {
      if (duplicateOn(error, 'slug') && attempt < SLUG_ATTEMPTS) continue;
      return translateRace(error);
    }
  }
}

/* ------------------------------------------------------------------ status */

type Verb = 'publish' | 'unpublish' | 'archive' | 'restore';

const MOVES: Record<Verb, { from: readonly ContentStatus[]; to: ContentStatus; refuse: (noun: string, from: ContentStatus) => string }> = {
  publish: {
    from: ['draft'],
    to: 'published',
    refuse: (noun, from) => (from === 'published' ? `That ${noun} is already published` : `Restore this ${noun} to a draft before publishing it`),
  },
  unpublish: { from: ['published'], to: 'draft', refuse: (noun) => `That ${noun} is not published` },
  archive: { from: ['draft', 'published'], to: 'archived', refuse: (noun) => `That ${noun} is already archived` },
  restore: { from: ['archived'], to: 'draft', refuse: (noun) => `That ${noun} is not archived` },
};

async function moveStatus<T extends ContentType>(viewer: SessionUser, type: T, id: string, verb: Verb, meta: ServiceMeta): Promise<ContentDTOMap[T]> {
  assertCapability(viewer, 'content:publish');
  const kind = kindOf(type);
  const docId = parseObjectId(id);
  const move = MOVES[verb];

  try {
    const { doc, wasPublished } = await withTransaction(async (session) => {
      const ctx: KindContext = { viewer, session };
      const existing = (await kind.model.findById(docId).session(session).lean()) as ContentDocLike | null;
      if (!existing) throw notFound(`We could not find that ${kind.noun}`);
      if (!move.from.includes(existing.status)) throw conflict(move.refuse(kind.noun, existing.status));
      if (verb === 'publish') await runGates(kind, existing, ctx);

      const actor = actorSnapshot(viewer);
      const $set: Record<string, unknown> = { status: move.to, updatedBy: actor };
      if (verb === 'publish') Object.assign($set, { publishedAt: new Date(), publishedBy: actor });
      const after = (await kind.model
        .findOneAndUpdate({ _id: existing._id, status: existing.status }, { $set }, { returnDocument: 'after', session })
        .lean()) as ContentDocLike | null;
      if (!after) throw conflict(`That ${kind.noun} was changed by someone else. Refresh and try again.`);

      await audit(
        {
          actor: auditActorOf(viewer),
          action: `${kind.actionPrefix}.${verb}`,
          entity: { type: kind.entity, id: String(after._id), label: kind.titleOf(after) },
          changes: [{ path: 'status', before: existing.status, after: move.to }],
          meta,
        },
        session,
      );
      return { doc: after, wasPublished: existing.status === 'published' };
    });

    // Going live is stale-while-revalidate; coming DOWN is immediate.
    if (verb === 'publish') revalidateContent(type);
    else if (wasPublished) revalidateContent(type, { immediate: true });
    return (await kind.toDTOs([doc], viewer))[0] as ContentDTOMap[T];
  } catch (error) {
    return translateRace(error);
  }
}

export const publishContent = <T extends ContentType>(viewer: SessionUser, type: T, id: string, meta: ServiceMeta = {}) => moveStatus(viewer, type, id, 'publish', meta);
export const unpublishContent = <T extends ContentType>(viewer: SessionUser, type: T, id: string, meta: ServiceMeta = {}) => moveStatus(viewer, type, id, 'unpublish', meta);
export const archiveContent = <T extends ContentType>(viewer: SessionUser, type: T, id: string, meta: ServiceMeta = {}) => moveStatus(viewer, type, id, 'archive', meta);
export const restoreContent = <T extends ContentType>(viewer: SessionUser, type: T, id: string, meta: ServiceMeta = {}) => moveStatus(viewer, type, id, 'restore', meta);

export { reorderContent } from './content/reorder';
