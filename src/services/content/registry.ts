import { notFound } from '@/lib/api/errors';
import { isContentType, type ContentType } from '@/lib/content/types';
import { developerKind } from './developers';
import { partnerKind } from './partners';
import { pricingKind } from './pricing';
import { serviceKind } from './services';
import { showcaseKind } from './showcase';
import type { ContentKind } from './types';

export const KINDS: Record<ContentType, ContentKind> = {
  showcase: showcaseKind,
  partners: partnerKind,
  services: serviceKind,
  pricing: pricingKind,
  developers: developerKind,
};

/** A route or page segment to a content type. Anything else is "not found", never a 500. */
export function parseContentType(value: string): ContentType {
  if (!isContentType(value)) throw notFound();
  return value;
}
