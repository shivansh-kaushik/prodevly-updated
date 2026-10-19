import type { Types } from 'mongoose';
import { connectToDatabase, mongoose } from '@/lib/db/mongoose';
import { SITE } from '@/content/site';
import { CURRENCY_CODES } from '@/config/currencies';
import { mediaPath } from '@/lib/media/url';
import { DeveloperProfile, Media, Partner, PricingPlan, Service, ShowcaseItem, SiteInfo, SITE_INFO_ID } from '@/models';
import {
  HOME_SECTIONS,
  type ContentType,
  type PublicDeveloper,
  type PublicImage,
  type PublicPartner,
  type PublicPricingPlan,
  type PublicService,
  type PublicShowcaseItem,
  type PublicSiteInfo,
  type VisibleSections,
} from './types';

/**
 * The public site's reads, UNCACHED. `public.ts` wraps each in `unstable_cache`; they are kept
 * apart so tests can call the real queries without the Next cache.
 *
 * Three promises, and each is tested:
 * 1. Only PUBLISHED records are ever read.
 * 2. Results are plain DTOs with an explicit field list. Nothing is spread from a document, so a
 *    field added to a model later cannot reach a visitor by accident (the internal project link,
 *    who created or published a record, the permission ticks, a team member's account id).
 * 3. Images are included only when they are PUBLIC files; a link to anything else is dropped.
 */
const BY_ORDER = { order: 1, createdAt: 1, _id: 1 } as const;

/**
 * What "live" means for each type: PUBLISHED, and its permission still ticked, and a priced plan still
 * priced. The service already refuses to publish (or edit a live record) into any other state, so these
 * extra conditions never remove anything in normal use. They are the second lock: a row written some other
 * way (an import, a hand edit) still cannot put an unapproved client, partner or person on the site.
 * Built per call because the operators must be wrapped for Mongoose's filter sanitiser.
 */
export const liveFilter = (type: ContentType): Record<string, unknown> => {
  switch (type) {
    case 'showcase': return { status: 'published', clientApproved: true };
    case 'partners': return { status: 'published', permissionConfirmed: true };
    case 'developers': return { status: 'published', consentConfirmed: true };
    case 'pricing':
      return {
        status: 'published',
        $or: [{ priceModel: 'quote' }, { amountMinor: mongoose.trusted({ $gt: 0 }), currency: mongoose.trusted({ $in: [...CURRENCY_CODES] }) }],
      };
    case 'services': return { status: 'published' };
  }
};

type MediaRow = { _id: Types.ObjectId; filename: string; alt?: string; width?: number; height?: number };

async function publicImages(ids: ReadonlyArray<Types.ObjectId | undefined>): Promise<Map<string, MediaRow>> {
  const unique = [...new Set(ids.filter((i): i is Types.ObjectId => Boolean(i)).map(String))];
  if (unique.length === 0) return new Map();
  const rows = await Media.find({ _id: mongoose.trusted({ $in: unique }), visibility: 'public' })
    .select('filename alt width height')
    .lean();
  return new Map(rows.map((m) => [String(m._id), m]));
}

/** `fallbackAlt` is the owner's own name ("Acme Corp logo"): a description exists even when nobody typed one. */
function toImage(m: MediaRow | undefined, fallbackAlt: string): PublicImage | null {
  if (!m) return null;
  return { url: mediaPath(String(m._id), m.filename), alt: m.alt || fallbackAlt, width: m.width ?? null, height: m.height ?? null };
}

const day = (d?: Date) => (d ? d.toISOString().slice(0, 10) : null);

type ShowcaseRow = Awaited<ReturnType<typeof loadShowcase>>[number];

const loadShowcase = (filter: Record<string, unknown>) => ShowcaseItem.find({ ...liveFilter('showcase'), ...filter }).sort(BY_ORDER).lean();

async function toPublicShowcase(rows: ShowcaseRow[]): Promise<PublicShowcaseItem[]> {
  const images = await publicImages(rows.flatMap((r) => [r.coverMediaId, ...(r.galleryMediaIds ?? [])]));
  const serviceIds = [...new Set(rows.flatMap((r) => (r.serviceIds ?? []).map(String)))];
  // Only PUBLISHED services are shown as tags: a draft or archived service must not leak through a project.
  const services = serviceIds.length ? await Service.find({ ...liveFilter('services'), _id: mongoose.trusted({ $in: serviceIds }) }).select('title slug').lean() : [];
  const byId = new Map(services.map((s) => [String(s._id), { slug: s.slug, title: s.title }]));

  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    clientDisplayName: r.clientDisplayName ?? null,
    summary: r.summary,
    body: { brief: r.body?.brief ?? null, built: r.body?.built ?? null, result: r.body?.result ?? null },
    services: (r.serviceIds ?? []).flatMap((id) => {
      const s = byId.get(String(id));
      return s ? [s] : [];
    }),
    stack: r.stack ?? [],
    cover: r.coverMediaId ? toImage(images.get(String(r.coverMediaId)), r.title) : null,
    gallery: (r.galleryMediaIds ?? []).flatMap((id) => {
      const img = toImage(images.get(String(id)), r.title);
      return img ? [img] : [];
    }),
    liveUrl: r.liveUrl ?? null,
    completedOn: day(r.completedOn),
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
  }));
}

export async function queryPublishedShowcase(): Promise<PublicShowcaseItem[]> {
  await connectToDatabase();
  return toPublicShowcase(await loadShowcase({}));
}

/** One published project by its slug, or null (a draft, an archived item and an unknown slug all look the same). */
export async function queryPublishedShowcaseItem(slug: string): Promise<PublicShowcaseItem | null> {
  if (typeof slug !== 'string' || !/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  await connectToDatabase();
  const [item] = await toPublicShowcase(await loadShowcase({ slug }));
  return item ?? null;
}

export async function queryPublishedPartners(): Promise<PublicPartner[]> {
  await connectToDatabase();
  const rows = await Partner.find(liveFilter('partners')).sort(BY_ORDER).lean();
  const images = await publicImages(rows.map((r) => r.logoMediaId));
  return rows.map((r) => ({
    key: String(r._id),
    name: r.name,
    kind: r.kind,
    logo: r.logoMediaId ? toImage(images.get(String(r.logoMediaId)), `${r.name} logo`) : null,
    url: r.url ?? null,
  }));
}

export async function queryPublishedServices(): Promise<PublicService[]> {
  await connectToDatabase();
  const rows = await Service.find(liveFilter('services')).sort(BY_ORDER).lean();
  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    deliverables: r.deliverables ?? [],
    stack: r.stack ?? [],
    totemKey: r.totemKey ?? null,
  }));
}

export async function queryPublishedPricingPlans(): Promise<PublicPricingPlan[]> {
  await connectToDatabase();
  const rows = await PricingPlan.find(liveFilter('pricing')).sort(BY_ORDER).lean();
  return rows.map((r) => ({
    key: String(r._id),
    name: r.name,
    summary: r.summary ?? null,
    priceModel: r.priceModel,
    // A quote plan has no number, whatever the record holds. (A priced plan without one is not live: see `live`.)
    price: r.priceModel !== 'quote' && r.amountMinor && r.currency ? { amountMinor: r.amountMinor, currency: r.currency } : null,
    priceNote: r.priceNote ?? null,
    features: r.features ?? [],
    highlighted: Boolean(r.highlighted),
    ctaLabel: r.ctaLabel ?? null,
  }));
}

export async function queryPublishedDevelopers(): Promise<PublicDeveloper[]> {
  await connectToDatabase();
  const rows = await DeveloperProfile.find(liveFilter('developers')).sort(BY_ORDER).lean();
  const images = await publicImages(rows.map((r) => r.photoMediaId));
  return rows.map((r) => ({
    key: String(r._id),
    displayName: r.displayName,
    title: r.title ?? null,
    photo: r.photoMediaId ? toImage(images.get(String(r.photoMediaId)), r.displayName) : null,
    bio: r.bio ?? null,
    skills: r.skills ?? [],
    links: { github: r.links?.github ?? null, linkedin: r.links?.linkedin ?? null, website: r.links?.website ?? null },
  }));
}

export async function queryPublicSiteInfo(): Promise<PublicSiteInfo> {
  await connectToDatabase();
  const doc = await SiteInfo.findById(SITE_INFO_ID).lean();
  const social: PublicSiteInfo['social'] = {};
  for (const [key, value] of Object.entries(doc?.social ?? {})) {
    if (value) social[key as keyof PublicSiteInfo['social']] = value;
  }
  return {
    displayName: doc?.displayName || SITE.name,
    legalName: doc?.legalName || null,
    email: doc?.email || null,
    phone: doc?.phone || null,
    whatsapp: doc?.whatsapp || null,
    address: doc?.address || null,
    social,
    footerNote: doc?.footerNote || null,
  };
}

const MODELS = {
  showcase: ShowcaseItem,
  partners: Partner,
  services: Service,
  pricing: PricingPlan,
  developers: DeveloperProfile,
} as const;

export async function queryHasPublished(type: ContentType): Promise<boolean> {
  await connectToDatabase();
  return Boolean(await (MODELS[type] as typeof Partner).exists(liveFilter(type)));
}

export async function queryVisibleSections(): Promise<VisibleSections> {
  const entries = await Promise.all(HOME_SECTIONS.map(async (s) => [s.key, await queryHasPublished(s.type)] as const));
  return Object.fromEntries(entries) as VisibleSections;
}
