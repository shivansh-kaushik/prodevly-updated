import type { Model, Types } from 'mongoose';
import { partnerGate } from '@/lib/content/gates';
import type { PartnerDTO } from '@/lib/content/types';
import type { CreatePartnerInput, UpdatePartnerInput } from '@/lib/validation/content';
import { Partner } from '@/models';
import { assertPublicImages, baseDTO, blockersIfNotLive, compact, loadMediaRefs, oid, put } from './helpers';
import type { ContentDocLike, ContentKind, FieldPatch, KindContext } from './types';

const doc = (d: ContentDocLike) => d as unknown as {
  name: string;
  kind: PartnerDTO['kind'];
  logoMediaId?: Types.ObjectId;
  url?: string;
  permissionConfirmed?: boolean;
};

export const partnerKind: ContentKind = {
  type: 'partners',
  entity: 'partner',
  actionPrefix: 'partner',
  noun: 'partner',
  model: Partner as unknown as Model<ContentDocLike>,
  hasSlug: false,
  searchPaths: ['name'],
  auditFields: ['name', 'kind', 'logoMediaId', 'url', 'permissionConfirmed'],
  titleOf: (d) => doc(d).name,

  async buildNew(input, { session }: KindContext) {
    const v = input as CreatePartnerInput;
    if (v.logoMediaId) await assertPublicImages([v.logoMediaId], 'logoMediaId', session);
    return {
      ...compact({ name: v.name, kind: v.kind, logoMediaId: v.logoMediaId ? oid(v.logoMediaId) : undefined, url: v.url }),
      permissionConfirmed: v.permissionConfirmed ?? false,
    };
  },

  async buildPatch(_existing, input, { session }: KindContext): Promise<FieldPatch> {
    const v = input as UpdatePartnerInput;
    const patch: FieldPatch = { set: {}, unset: [] };
    put(patch, 'name', v.name);
    put(patch, 'kind', v.kind);
    put(patch, 'url', v.url);
    put(patch, 'permissionConfirmed', v.permissionConfirmed);
    if (v.logoMediaId !== undefined) {
      if (v.logoMediaId) await assertPublicImages([v.logoMediaId], 'logoMediaId', session);
      put(patch, 'logoMediaId', v.logoMediaId ? oid(v.logoMediaId) : null);
    }
    return patch;
  },

  gate: (d) => partnerGate({ permissionConfirmed: doc(d).permissionConfirmed }),

  async toDTOs(docs): Promise<PartnerDTO[]> {
    const media = await loadMediaRefs(docs.map((d) => doc(d).logoMediaId));
    return docs.map((raw) => {
      const d = doc(raw);
      return {
        ...baseDTO('partners', raw, { title: d.name, blockers: blockersIfNotLive(raw, partnerKind.gate(raw)) }),
        type: 'partners' as const,
        kind: d.kind,
        logoMedia: d.logoMediaId ? (media.get(String(d.logoMediaId)) ?? null) : null,
        url: d.url ?? null,
        permissionConfirmed: Boolean(d.permissionConfirmed),
      };
    });
  },
};
