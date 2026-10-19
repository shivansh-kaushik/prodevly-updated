import type { Model, Types } from 'mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { mongoose } from '@/lib/db/mongoose';
import { validationFailed } from '@/lib/api/errors';
import { developerGate } from '@/lib/content/gates';
import type { DeveloperDTO } from '@/lib/content/types';
import type { CreateDeveloperInput, UpdateDeveloperInput } from '@/lib/validation/content';
import { Admin, DeveloperProfile } from '@/models';
import { assertAdminExists, assertPublicImages, baseDTO, blockersIfNotLive, compact, loadMediaRefs, oid, put } from './helpers';
import type { ContentDocLike, ContentKind, FieldPatch, KindContext } from './types';

const doc = (d: ContentDocLike) => d as unknown as {
  _id: Types.ObjectId;
  adminId?: Types.ObjectId;
  displayName: string;
  title?: string;
  photoMediaId?: Types.ObjectId;
  bio?: string;
  skills?: string[];
  links?: { github?: string; linkedin?: string; website?: string };
  consentConfirmed?: boolean;
};

/** A profile may be linked to a team member only by someone who can see the team (the picker needs the same right). */
const assertMayLinkAdmin = (viewer: KindContext['viewer']) => assertCapability(viewer, 'team:view');

/** One profile per team member. The index backs this up; this gives a readable message first. */
async function assertAdminUnused(adminId: string, except: Types.ObjectId | null, session: KindContext['session']): Promise<void> {
  const taken = await DeveloperProfile.exists({
    adminId: oid(adminId),
    ...(except ? { _id: mongoose.trusted({ $ne: except }) } : {}),
  }).session(session);
  if (taken) throw validationFailed({ adminId: 'That team member already has a developer profile.' });
}

export const developerKind: ContentKind = {
  type: 'developers',
  entity: 'developer_profile',
  actionPrefix: 'developer',
  noun: 'developer profile',
  model: DeveloperProfile as unknown as Model<ContentDocLike>,
  hasSlug: false,
  searchPaths: ['displayName', 'title'],
  auditFields: ['adminId', 'displayName', 'title', 'photoMediaId', 'bio', 'skills', 'links', 'consentConfirmed'],
  titleOf: (d) => doc(d).displayName,

  async buildNew(input, { viewer, session }: KindContext) {
    const v = input as CreateDeveloperInput;
    if (v.adminId) {
      assertMayLinkAdmin(viewer);
      await assertAdminExists(v.adminId, 'adminId', session);
      await assertAdminUnused(v.adminId, null, session);
    }
    if (v.photoMediaId) await assertPublicImages([v.photoMediaId], 'photoMediaId', session);
    const links = compact({ github: v.links?.github, linkedin: v.links?.linkedin, website: v.links?.website });
    return {
      ...compact({
        adminId: v.adminId ? oid(v.adminId) : undefined,
        displayName: v.displayName,
        title: v.title,
        photoMediaId: v.photoMediaId ? oid(v.photoMediaId) : undefined,
        bio: v.bio,
      }),
      skills: v.skills ?? [],
      links,
      consentConfirmed: v.consentConfirmed ?? false,
    };
  },

  async buildPatch(existing, input, { viewer, session }: KindContext): Promise<FieldPatch> {
    const v = input as UpdateDeveloperInput;
    const before = doc(existing);
    const patch: FieldPatch = { set: {}, unset: [] };
    put(patch, 'displayName', v.displayName);
    put(patch, 'title', v.title);
    put(patch, 'bio', v.bio);
    put(patch, 'skills', v.skills);
    put(patch, 'consentConfirmed', v.consentConfirmed);
    if (v.adminId !== undefined) {
      if (v.adminId && v.adminId !== String(before.adminId ?? '')) {
        assertMayLinkAdmin(viewer);
        await assertAdminExists(v.adminId, 'adminId', session);
        await assertAdminUnused(v.adminId, before._id, session);
      }
      put(patch, 'adminId', v.adminId ? oid(v.adminId) : null);
    }
    if (v.photoMediaId !== undefined) {
      if (v.photoMediaId) await assertPublicImages([v.photoMediaId], 'photoMediaId', session);
      put(patch, 'photoMediaId', v.photoMediaId ? oid(v.photoMediaId) : null);
    }
    if (v.links) {
      put(patch, 'links.github', v.links.github);
      put(patch, 'links.linkedin', v.links.linkedin);
      put(patch, 'links.website', v.links.website);
    }
    return patch;
  },

  gate: (d) => developerGate({ consentConfirmed: doc(d).consentConfirmed, bio: doc(d).bio }),

  async toDTOs(docs, viewer): Promise<DeveloperDTO[]> {
    const rows = docs.map(doc);
    const media = await loadMediaRefs(rows.map((d) => d.photoMediaId));
    // The linked account's name is a team detail: shown only to people who may see the team.
    const adminIds = viewer.capabilities.has('team:view') ? [...new Set(rows.flatMap((d) => (d.adminId ? [String(d.adminId)] : [])))] : [];
    const admins = adminIds.length ? await Admin.find({ _id: mongoose.trusted({ $in: adminIds.map(oid) }) }).select('name').lean() : [];
    const adminName = new Map(admins.map((a) => [String(a._id), a.name]));

    return docs.map((raw, i) => {
      const d = rows[i] as ReturnType<typeof doc>;
      return {
        ...baseDTO('developers', raw, { title: d.displayName, blockers: blockersIfNotLive(raw, developerKind.gate(raw)) }),
        type: 'developers' as const,
        adminId: d.adminId ? String(d.adminId) : null,
        adminName: d.adminId ? (adminName.get(String(d.adminId)) ?? null) : null,
        jobTitle: d.title ?? null,
        photoMedia: d.photoMediaId ? (media.get(String(d.photoMediaId)) ?? null) : null,
        bio: d.bio ?? null,
        skills: d.skills ?? [],
        links: { github: d.links?.github ?? null, linkedin: d.links?.linkedin ?? null, website: d.links?.website ?? null },
        consentConfirmed: Boolean(d.consentConfirmed),
      };
    });
  },
};
