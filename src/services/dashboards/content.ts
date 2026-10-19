import type { Model } from 'mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { connectToDatabase } from '@/lib/db/mongoose';
import { blockersOf } from '@/lib/content/gates';
import { liveFilter } from '@/lib/content/queries';
import { CONTENT_LABELS, CONTENT_TYPES, HOME_SECTIONS, type ContentType, type HomeSectionKey } from '@/lib/content/types';
import { DeveloperProfile, Partner, PricingPlan, Service, ShowcaseItem, SiteInfo, SITE_INFO_ID } from '@/models';
import type { SessionUser } from '@/types/session';
import { KINDS } from '@/services/content/registry';
import type { ContentDocLike } from '@/services/content/types';

/**
 * The website content dashboard (plan section 5, "Website content"). Everything here is counted
 * or read from records: nothing is estimated and nothing is shown that has no record behind it.
 * An empty database gives zeros, every home section hidden, and no "last published" rows.
 * There is no period: content is a state, not a flow, so the figures are as of now.
 */
export interface ContentTypeSummary {
  type: ContentType;
  label: string;
  published: number;
  /**
   * Published records the public site really shows: published AND still holding their permission tick or price.
   * Equal to `published` unless a row was changed outside the service, which is exactly when it is worth knowing.
   */
  showing: number;
  draft: number;
  archived: number;
  total: number;
  lastPublished: { id: string; title: string; publishedAt: string } | null;
}

export interface HiddenSection {
  key: HomeSectionKey;
  label: string;
  type: ContentType;
  /** Plain reason, so the page can say what to do. */
  reason: string;
}

export interface AttentionItem {
  type: ContentType;
  id: string;
  title: string;
  /** What is missing before this draft is ready: a permission tick, a price, an image. */
  problems: string[];
}

export interface ContentDashboard {
  totals: { published: number; draft: number; archived: number; items: number };
  types: ContentTypeSummary[];
  sections: Array<{ key: HomeSectionKey; label: string; type: ContentType; visible: boolean; published: number; showing: number }>;
  hiddenSections: HiddenSection[];
  attention: AttentionItem[];
  /** How many drafts need attention in all; `attention` shows the first few. */
  attentionTotal: number;
  siteInfo: { updatedAt: string | null; hasContactDetails: boolean };
}

const MODELS: Record<ContentType, Model<never>> = {
  showcase: ShowcaseItem as unknown as Model<never>,
  partners: Partner as unknown as Model<never>,
  services: Service as unknown as Model<never>,
  pricing: PricingPlan as unknown as Model<never>,
  developers: DeveloperProfile as unknown as Model<never>,
};

/** The image each type normally shows. A draft without it is flagged, but it does not block publishing. */
const MEDIA_FIELD: Partial<Record<ContentType, { field: string; problem: string }>> = {
  showcase: { field: 'coverMediaId', problem: 'No cover image' },
  partners: { field: 'logoMediaId', problem: 'No logo' },
  developers: { field: 'photoMediaId', problem: 'No photo' },
};

const ATTENTION_SHOWN = 12;

export async function getContentDashboard(viewer: SessionUser): Promise<ContentDashboard> {
  assertCapability(viewer, 'content:edit');
  await connectToDatabase();

  const perType = await Promise.all(
    CONTENT_TYPES.map(async (type) => {
      const model = MODELS[type];
      const kind = KINDS[type];
      const [counts, showing, last, drafts] = await Promise.all([
        model.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
        model.countDocuments(liveFilter(type) as never),
        model.findOne({ status: 'published' }).sort({ publishedAt: -1, _id: -1 }).lean() as unknown as Promise<ContentDocLike | null>,
        model.find({ status: 'draft' }).sort({ updatedAt: -1 }).limit(200).lean() as unknown as Promise<ContentDocLike[]>,
      ]);
      const n = (status: string) => counts.find((c) => c._id === status)?.n ?? 0;
      const media = MEDIA_FIELD[type];

      const attention: AttentionItem[] = [];
      for (const draft of drafts) {
        const problems = blockersOf(kind.gate(draft));
        if (media && !draft[media.field]) problems.push(media.problem);
        if (problems.length > 0) attention.push({ type, id: String(draft._id), title: kind.titleOf(draft), problems });
      }

      const summary: ContentTypeSummary = {
        type,
        label: CONTENT_LABELS[type].plural,
        published: n('published'),
        showing,
        draft: n('draft'),
        archived: n('archived'),
        total: n('published') + n('draft') + n('archived'),
        lastPublished: last && last.publishedAt ? { id: String(last._id), title: kind.titleOf(last), publishedAt: last.publishedAt.toISOString() } : null,
      };
      return { summary, attention };
    }),
  );

  const types = perType.map((t) => t.summary);
  const byType = new Map(types.map((t) => [t.type, t]));
  const sections = HOME_SECTIONS.map((s) => {
    const summary = byType.get(s.type);
    const showing = summary?.showing ?? 0;
    // A section is shown when the PUBLIC reads find something, the same test the home page uses.
    return { key: s.key, label: s.label, type: s.type, visible: showing > 0, published: summary?.published ?? 0, showing };
  });
  const attentionAll = perType.flatMap((t) => t.attention);
  const site = await SiteInfo.findById(SITE_INFO_ID).lean();

  return {
    totals: {
      published: types.reduce((sum, t) => sum + t.published, 0),
      draft: types.reduce((sum, t) => sum + t.draft, 0),
      archived: types.reduce((sum, t) => sum + t.archived, 0),
      items: types.reduce((sum, t) => sum + t.total, 0),
    },
    types,
    sections,
    hiddenSections: sections
      .filter((s) => !s.visible)
      .map((s) => ({
        key: s.key,
        label: s.label,
        type: s.type,
        reason: s.published > 0
          ? `${s.published} published, but none can be shown: a permission tick or price is missing`
          : `No published ${CONTENT_LABELS[s.type].plural.toLowerCase()}`,
      })),
    attention: attentionAll.slice(0, ATTENTION_SHOWN),
    attentionTotal: attentionAll.length,
    siteInfo: {
      updatedAt: site?.updatedAt ? site.updatedAt.toISOString() : null,
      hasContactDetails: Boolean(site && (site.email || site.phone || site.whatsapp || site.address)),
    },
  };
}
