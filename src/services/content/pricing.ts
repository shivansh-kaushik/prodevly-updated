import type { Model } from 'mongoose';
import { mongoose } from '@/lib/db/mongoose';
import { validationFailed } from '@/lib/api/errors';
import { pricingGate, type GateProblems } from '@/lib/content/gates';
import type { PricingPlanDTO } from '@/lib/content/types';
import type { CreatePricingInput, UpdatePricingInput } from '@/lib/validation/content';
import { PricingPlan } from '@/models';
import { getSettings } from '@/services/settings.service';
import { baseDTO, blockersIfNotLive, compact, put } from './helpers';
import type { ContentDocLike, ContentKind, FieldPatch, KindContext } from './types';

const doc = (d: ContentDocLike) => d as unknown as {
  name: string;
  summary?: string;
  priceModel: PricingPlanDTO['priceModel'];
  amountMinor?: number;
  currency?: string;
  priceNote?: string;
  features?: string[];
  highlighted?: boolean;
  ctaLabel?: string;
};

/** A plan can be priced only in a currency the organisation has enabled in Settings. */
async function assertCurrencyEnabled(currency: string | null | undefined): Promise<void> {
  if (!currency) return;
  const { enabledCurrencies } = await getSettings();
  if (!enabledCurrencies.includes(currency)) {
    throw validationFailed({ currency: 'That currency is not enabled. A superadmin can enable it in Settings.' });
  }
}

export const pricingKind: ContentKind = {
  type: 'pricing',
  entity: 'pricing_plan',
  actionPrefix: 'pricing',
  noun: 'plan',
  model: PricingPlan as unknown as Model<ContentDocLike>,
  hasSlug: false,
  searchPaths: ['name', 'summary'],
  auditFields: ['name', 'summary', 'priceModel', 'amountMinor', 'currency', 'priceNote', 'features', 'highlighted', 'ctaLabel'],
  titleOf: (d) => doc(d).name,

  async buildNew(input) {
    const v = input as CreatePricingInput;
    const quote = v.priceModel === 'quote';
    if (!quote) await assertCurrencyEnabled(v.currency);
    return {
      ...compact({ name: v.name, summary: v.summary, priceModel: v.priceModel, priceNote: v.priceNote, ctaLabel: v.ctaLabel }),
      // A quote plan renders with no number, so a stray amount is dropped rather than stored.
      ...(quote ? {} : compact({ amountMinor: v.amountMinor, currency: v.currency })),
      features: v.features ?? [],
      highlighted: v.highlighted ?? false,
    };
  },

  async buildPatch(existing, input): Promise<FieldPatch> {
    const v = input as UpdatePricingInput;
    const before = doc(existing);
    const patch: FieldPatch = { set: {}, unset: [] };
    put(patch, 'name', v.name);
    put(patch, 'summary', v.summary);
    put(patch, 'priceModel', v.priceModel);
    put(patch, 'priceNote', v.priceNote);
    put(patch, 'features', v.features);
    put(patch, 'highlighted', v.highlighted);
    put(patch, 'ctaLabel', v.ctaLabel);

    const model = v.priceModel ?? before.priceModel;
    if (model === 'quote') {
      // Whatever amount was there goes: a quote plan carries no number at all.
      if (before.amountMinor !== undefined) patch.unset.push('amountMinor');
      if (before.currency !== undefined) patch.unset.push('currency');
    } else {
      await assertCurrencyEnabled(v.currency);
      put(patch, 'amountMinor', v.amountMinor);
      put(patch, 'currency', v.currency);
    }
    return patch;
  },

  gate: (d) => pricingGate(doc(d)),

  /** At most one PUBLISHED plan may be highlighted. */
  async extraPublishChecks(d, { session }: KindContext): Promise<GateProblems> {
    if (!doc(d).highlighted) return {};
    const other = await PricingPlan.findOne({
      status: 'published',
      highlighted: true,
      _id: mongoose.trusted({ $ne: d._id }),
    })
      .select('name')
      .session(session)
      .lean();
    return other ? { highlighted: `"${other.name}" is already the highlighted plan. Remove its highlight first.` } : {};
  },

  async toDTOs(docs): Promise<PricingPlanDTO[]> {
    return docs.map((raw) => {
      const d = doc(raw);
      return {
        ...baseDTO('pricing', raw, { title: d.name, blockers: blockersIfNotLive(raw, pricingKind.gate(raw)) }),
        type: 'pricing' as const,
        summary: d.summary ?? null,
        priceModel: d.priceModel,
        amountMinor: d.amountMinor ?? null,
        currency: d.currency ?? null,
        priceNote: d.priceNote ?? null,
        features: d.features ?? [],
        highlighted: Boolean(d.highlighted),
        ctaLabel: d.ctaLabel ?? null,
      };
    });
  },
};
