import { connectToDatabase, withTransaction } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { revalidateContent } from '@/lib/content/revalidate';
import type { SiteInfoDTO } from '@/lib/content/types';
import type { SiteInfoInput } from '@/lib/validation/content';
import { SiteInfo, SITE_INFO_ID, type SiteInfoDoc } from '@/models';
import { SITE } from '@/content/site';
import type { SessionUser } from '@/types/session';
import { audit } from './audit.service';
import type { ServiceMeta } from './admin.service';
import { auditActorOf, contentChanges, put } from './content/helpers';
import type { ContentDocLike, FieldPatch } from './content/types';

/**
 * Company details for the footer and the contact fallback: one record, `_id: 'site'`.
 *
 * It has no draft state, so a saved change is live at once. That makes saving it a PUBLISH-level
 * act (`content:publish`), while anyone who can edit content (`content:edit`) can read it.
 * Empty fields are simply absent, and the public reads leave them out.
 */
const FIELDS = [
  'legalName', 'displayName', 'email', 'phone', 'whatsapp', 'address',
  'social.linkedin', 'social.github', 'social.x', 'social.instagram', 'social.dribbble', 'social.behance',
  'footerNote',
] as const;

export function toSiteInfoDTO(doc: SiteInfoDoc | null): SiteInfoDTO {
  return {
    legalName: doc?.legalName ?? null,
    // The only fallback is the brand name from the static site facts: nothing is invented.
    displayName: doc?.displayName ?? SITE.name,
    email: doc?.email ?? null,
    phone: doc?.phone ?? null,
    whatsapp: doc?.whatsapp ?? null,
    address: doc?.address ?? null,
    social: {
      linkedin: doc?.social?.linkedin ?? null,
      github: doc?.social?.github ?? null,
      x: doc?.social?.x ?? null,
      instagram: doc?.social?.instagram ?? null,
      dribbble: doc?.social?.dribbble ?? null,
      behance: doc?.social?.behance ?? null,
    },
    footerNote: doc?.footerNote ?? null,
    updatedAt: doc?.updatedAt ? doc.updatedAt.toISOString() : null,
  };
}

export async function getSiteInfo(viewer: SessionUser): Promise<SiteInfoDTO> {
  assertCapability(viewer, 'content:edit');
  await connectToDatabase();
  return toSiteInfoDTO(await SiteInfo.findById(SITE_INFO_ID).lean());
}

/** Replaces the company details. Whatever the request leaves out is cleared. */
export async function updateSiteInfo(viewer: SessionUser, input: SiteInfoInput, meta: ServiceMeta = {}): Promise<SiteInfoDTO> {
  assertCapability(viewer, 'content:publish');

  const patch: FieldPatch = { set: {}, unset: [] };
  put(patch, 'displayName', input.displayName);
  for (const key of ['legalName', 'email', 'phone', 'whatsapp', 'address', 'footerNote'] as const) put(patch, key, input[key] ?? null);
  for (const key of ['linkedin', 'github', 'x', 'instagram', 'dribbble', 'behance'] as const) put(patch, `social.${key}`, input.social?.[key] ?? null);

  const after = await withTransaction(async (session) => {
    const before = await SiteInfo.findById(SITE_INFO_ID).session(session).lean();
    const update: Record<string, unknown> = { $set: patch.set };
    if (patch.unset.length) update.$unset = Object.fromEntries(patch.unset.map((path) => [path, 1]));
    const saved = await SiteInfo.findOneAndUpdate({ _id: SITE_INFO_ID }, update, {
      upsert: true,
      returnDocument: 'after',
      setDefaultsOnInsert: true,
      session,
      runValidators: true,
    }).lean();
    if (!saved) throw new Error('The company info was not saved');

    const changes = contentChanges(before as unknown as ContentDocLike | null, saved as unknown as ContentDocLike, FIELDS);
    if (changes.length > 0) {
      await audit(
        { actor: auditActorOf(viewer), action: 'site_info.update', entity: { type: 'site_info', label: 'Company info' }, changes, meta },
        session,
      );
    }
    return saved;
  });

  // Company details are small and sometimes sensitive to leave up (a wrong number): expire at once.
  revalidateContent('site', { immediate: true });
  return toSiteInfoDTO(after);
}
