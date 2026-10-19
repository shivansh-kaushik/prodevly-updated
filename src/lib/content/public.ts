import { unstable_cache } from 'next/cache';
import {
  queryHasPublished,
  queryPublicSiteInfo,
  queryPublishedDevelopers,
  queryPublishedPartners,
  queryPublishedPricingPlans,
  queryPublishedServices,
  queryPublishedShowcase,
  queryPublishedShowcaseItem,
  queryVisibleSections,
} from './queries';
import { CONTENT_TYPES, contentTag, type ContentTag, type ContentType } from './types';

/**
 * What the public site calls. Each read is cached under the tag of the content it reads
 * (`content:showcase`, ...), so a content write that calls `revalidateContent` refreshes exactly
 * the right reads. Every entry also expires on a timer, as a backstop for a host where a tag
 * invalidation does not reach every instance.
 *
 * Only published records come back, as plain DTOs (see queries.ts). `hasPublished` and
 * `getVisibleSections` are how the home page decides which sections to render: a section with no
 * published record renders nothing, and its nav link and 3D station go with it (CONTRACT 1).
 * Read these from Server Components, never from the admin: they are cached across viewers.
 */
const EXPIRES_SECONDS = 3600;

const cached = <Args extends unknown[], R>(name: string, tags: readonly ContentTag[], fn: (...args: Args) => Promise<R>) =>
  unstable_cache(fn, ['public-content', name], { tags: tags.map(contentTag), revalidate: EXPIRES_SECONDS });

export const getPublishedShowcase = cached('showcase', ['showcase', 'services'], queryPublishedShowcase);
export const getPublishedShowcaseItem = cached('showcase-item', ['showcase', 'services'], queryPublishedShowcaseItem);
export const getPublishedPartners = cached('partners', ['partners'], queryPublishedPartners);
export const getPublishedServices = cached('services', ['services'], queryPublishedServices);
export const getPublishedPricingPlans = cached('pricing', ['pricing'], queryPublishedPricingPlans);
export const getPublishedDevelopers = cached('developers', ['developers'], queryPublishedDevelopers);
export const getPublicSiteInfo = cached('site', ['site'], queryPublicSiteInfo);

const hasPublishedCached = cached('has-published', CONTENT_TYPES, async (type: ContentType) => queryHasPublished(type));
/** True when at least one record of this type is published. */
export const hasPublished = (type: ContentType) => hasPublishedCached(type);

/** Which home sections have something to show. Hide the rest, with their nav links and stations. */
export const getVisibleSections = cached('visible-sections', CONTENT_TYPES, queryVisibleSections);
