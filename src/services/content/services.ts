import type { Model } from 'mongoose';
import { serviceGate } from '@/lib/content/gates';
import type { ServiceDTO } from '@/lib/content/types';
import type { CreateServiceInput, UpdateServiceInput } from '@/lib/validation/content';
import { Service } from '@/models';
import { baseDTO, compact, put } from './helpers';
import type { ContentDocLike, ContentKind, FieldPatch } from './types';

const doc = (d: ContentDocLike) => d as unknown as {
  title: string;
  slug: string;
  summary: string;
  deliverables?: string[];
  stack?: string[];
  totemKey?: string;
};

export const serviceKind: ContentKind = {
  type: 'services',
  entity: 'service',
  actionPrefix: 'service',
  noun: 'service',
  model: Service as unknown as Model<ContentDocLike>,
  hasSlug: true,
  searchPaths: ['title', 'summary'],
  auditFields: ['title', 'slug', 'summary', 'deliverables', 'stack', 'totemKey'],
  titleOf: (d) => doc(d).title,

  async buildNew(input) {
    const v = input as CreateServiceInput;
    return {
      ...compact({ title: v.title, summary: v.summary, totemKey: v.totemKey }),
      deliverables: v.deliverables ?? [],
      stack: v.stack ?? [],
    };
  },

  async buildPatch(_existing, input): Promise<FieldPatch> {
    const v = input as UpdateServiceInput;
    const patch: FieldPatch = { set: {}, unset: [] };
    put(patch, 'title', v.title);
    put(patch, 'summary', v.summary);
    put(patch, 'deliverables', v.deliverables);
    put(patch, 'stack', v.stack);
    put(patch, 'totemKey', v.totemKey);
    return patch;
  },

  gate: () => serviceGate(),

  async toDTOs(docs): Promise<ServiceDTO[]> {
    return docs.map((raw) => {
      const d = doc(raw);
      return {
        ...baseDTO('services', raw, { title: d.title, slug: d.slug, blockers: [] }),
        type: 'services' as const,
        summary: d.summary,
        deliverables: d.deliverables ?? [],
        stack: d.stack ?? [],
        totemKey: d.totemKey ?? null,
      };
    });
  },
};
