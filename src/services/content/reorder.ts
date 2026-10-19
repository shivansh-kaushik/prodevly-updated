import { mongoose, withTransaction } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { notFound, validationFailed } from '@/lib/api/errors';
import { revalidateContent } from '@/lib/content/revalidate';
import type { ContentType } from '@/lib/content/types';
import { parseObjectId } from '@/lib/validation/common';
import type { SessionUser } from '@/types/session';
import { audit } from '../audit.service';
import type { ServiceMeta } from '../admin.service';
import { actorSnapshot, auditActorOf, oid } from './helpers';
import { KINDS } from './registry';

/**
 * Sets the display order of the given records to the order of `ids`. The records trade the order
 * NUMBERS they already hold, so anything not in the list (archived items) keeps its place around
 * them. Moving published items changes the public page, so that part needs publish authority.
 */
export async function reorderContent(viewer: SessionUser, type: ContentType, ids: readonly string[], meta: ServiceMeta = {}): Promise<{ moved: number }> {
  assertCapability(viewer, 'content:edit');
  const kind = KINDS[type];
  const wanted = ids.map(parseObjectId);
  if (new Set(wanted).size !== wanted.length) throw validationFailed({ ids: 'Each item may appear once' });

  const { moved, publishedMoved } = await withTransaction(async (session) => {
    const rows = await kind.model
      .find({ _id: mongoose.trusted({ $in: wanted.map(oid) }) })
      .select('status order')
      .session(session)
      .lean();
    if (rows.length !== wanted.length) throw notFound(`One of those ${kind.noun}s no longer exists`);
    const byId = new Map(rows.map((r) => [String(r._id), r]));

    const slots = rows.map((r) => r.order).sort((a, b) => a - b);
    const distinct = new Set(slots).size === slots.length;
    const first = slots[0] ?? 0;
    const target = new Map(wanted.map((id, i) => [id, distinct ? (slots[i] as number) : first + i]));

    const changed = wanted.filter((id) => byId.get(id)?.order !== target.get(id));
    if (changed.length === 0) return { moved: 0, publishedMoved: false };
    const publishedMoved = changed.some((id) => byId.get(id)?.status === 'published');
    if (publishedMoved) assertCapability(viewer, 'content:publish');

    const actor = actorSnapshot(viewer);
    await kind.model.bulkWrite(
      changed.map((id) => ({ updateOne: { filter: { _id: oid(id) }, update: { $set: { order: target.get(id) as number, updatedBy: actor } } } })),
      { session },
    );
    const before = [...rows].sort((a, b) => a.order - b.order || String(a._id).localeCompare(String(b._id))).map((r) => String(r._id));
    await audit(
      {
        actor: auditActorOf(viewer),
        action: `${kind.actionPrefix}.reorder`,
        entity: { type: kind.entity, label: `${changed.length} ${kind.noun}${changed.length === 1 ? '' : 's'}` },
        summary: `Reordered ${wanted.length} ${kind.noun}${wanted.length === 1 ? '' : 's'}`,
        changes: [{ path: 'order', before, after: wanted }],
        meta,
      },
      session,
    );
    return { moved: changed.length, publishedMoved };
  });

  if (publishedMoved) revalidateContent(type);
  return { moved };
}
