import 'server-only';
import { EMPTY_HOME, type HomeContent } from '@/lib/home-content';
import {
  getPublicSiteInfo,
  getPublishedDevelopers,
  getPublishedPartners,
  getPublishedPricingPlans,
  getPublishedShowcase,
  getPublishedShowcaseItem,
} from '@/lib/content/public';
import type { PublicShowcaseItem, PublicSiteInfo } from '@/lib/content/types';

/**
 * The home page's records: everything published in the admin panel (cached reads,
 * refreshed when content changes; see `src/lib/content/public.ts`). A list with
 * nothing published hides its section, nav key and 3D station.
 *
 * - No database configured (no MONGODB_URI): the page renders its static sections
 *   only, so the site runs before a database exists.
 * - A database that cannot be reached while BUILDING: the page is built without
 *   records and a warning is printed; it fills in on its next revalidation.
 * - A database that cannot be reached while SERVING: the error is thrown, so Next keeps
 *   serving the last good page instead of an empty one.
 */
let warned = false;

export async function loadHomeContent(): Promise<HomeContent> {
  if (!process.env.MONGODB_URI) {
    if (!warned) {
      warned = true;
      console.warn('[home] MONGODB_URI is not set: the home page shows its static sections only.');
    }
    return EMPTY_HOME;
  }
  try {
    const [partners, projects, plans, people, site] = await Promise.all([
      getPublishedPartners(),
      getPublishedShowcase(),
      getPublishedPricingPlans(),
      getPublishedDevelopers(),
      getPublicSiteInfo(),
    ]);
    return { partners, projects, plans, people, site };
  } catch (error) {
    if (process.env.NEXT_PHASE === 'phase-production-build') {
      console.warn('[home] Built without records: the database could not be reached.', error);
      return EMPTY_HOME;
    }
    throw error;
  }
}

export interface CaseStudyContent {
  item: PublicShowcaseItem;
  /** The next published project (wrapping around), or null when this is the only one. */
  next: { slug: string; title: string } | null;
  site: PublicSiteInfo | null;
}

/** One published project for `/work/[slug]`, or null (unknown, unpublished, or no database). */
export async function loadCaseStudy(slug: string): Promise<CaseStudyContent | null> {
  if (!process.env.MONGODB_URI) return null;
  const [item, all, site] = await Promise.all([getPublishedShowcaseItem(slug), getPublishedShowcase(), getPublicSiteInfo()]);
  if (!item) return null;
  const at = all.findIndex((p) => p.slug === slug);
  const after = all.length > 1 && at >= 0 ? all[(at + 1) % all.length]! : null;
  return { item, next: after ? { slug: after.slug, title: after.title } : null, site };
}

/** Slugs to prerender at build time. None without a database, or when it cannot be reached while building. */
export async function loadCaseStudySlugs(): Promise<string[]> {
  if (!process.env.MONGODB_URI) return [];
  try {
    return (await getPublishedShowcase()).map((p) => p.slug);
  } catch (error) {
    if (process.env.NEXT_PHASE === 'phase-production-build') {
      console.warn('[work] Case studies not prerendered: the database could not be reached.', error);
      return [];
    }
    throw error;
  }
}

/** Company details for pages other than the home page; null without a database. */
export async function loadSiteInfo(): Promise<PublicSiteInfo | null> {
  if (!process.env.MONGODB_URI) return null;
  try {
    return await getPublicSiteInfo();
  } catch (error) {
    if (process.env.NEXT_PHASE === 'phase-production-build') return null;
    throw error;
  }
}
