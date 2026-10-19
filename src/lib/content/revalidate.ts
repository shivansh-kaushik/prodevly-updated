import { revalidateTag } from 'next/cache';
import { contentTag, type ContentTag } from './types';

/**
 * What else a change makes stale. A showcase item shows its services' titles, so changing a
 * service must refresh the showcase reads too.
 */
const ALSO_STALE: Partial<Record<ContentTag, readonly ContentTag[]>> = { services: ['showcase'] };

/**
 * Tells the public site's cached reads that content changed. Call it AFTER the transaction
 * commits (a rolled-back write must not invalidate, and invalidating before the commit lets a
 * reader re-cache the old data).
 *
 * `max` is stale-while-revalidate: the next visitor may still see the old content while the new
 * is fetched. That is right for a publish or an edit. Something being TAKEN DOWN (unpublish,
 * archive) uses `immediate`, so nothing withdrawn is served even once more.
 *
 * A failure here never fails the request: the write has already committed, and every cached
 * read also expires on a timer (see public.ts), so the worst case is a short delay.
 */
export function revalidateContent(tags: ContentTag | readonly ContentTag[], options: { immediate?: boolean } = {}): void {
  const requested: readonly ContentTag[] = typeof tags === 'string' ? [tags] : tags;
  const all = new Set<ContentTag>(requested);
  for (const tag of requested) for (const extra of ALSO_STALE[tag] ?? []) all.add(extra);
  for (const tag of all) {
    try {
      revalidateTag(contentTag(tag), options.immediate ? { expire: 0 } : 'max');
    } catch (error) {
      console.error('[content] cache revalidation failed', { tag, error });
    }
  }
}
