import type { ContentStatus } from '@/config/statuses';
import type { PARTNER_KINDS, PRICE_MODELS } from '@/config/statuses';

/**
 * Shared vocabulary for website content: the type names, cache tags, home sections and the
 * DTO shapes. Pure (no database, no server code), so the admin editors and the server both
 * import it. Anything the PUBLIC site receives is a `Public*` shape; the admin shapes carry
 * workflow fields (status, blockers, who edited) that must never reach a visitor.
 */

export const CONTENT_TYPES = ['showcase', 'partners', 'services', 'pricing', 'developers'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export function isContentType(value: string): value is ContentType {
  return (CONTENT_TYPES as readonly string[]).includes(value);
}

export const CONTENT_LABELS: Record<ContentType, { plural: string; singular: string; section: string; blurb: string }> = {
  showcase: { plural: 'Showcase', singular: 'project', section: 'Our projects', blurb: 'Projects you are allowed to show.' },
  partners: { plural: 'Partners', singular: 'partner', section: 'Partners', blurb: 'Companies and tools shown with their permission.' },
  services: { plural: 'Services', singular: 'service', section: 'Services', blurb: 'What the studio offers.' },
  pricing: { plural: 'Pricing plans', singular: 'plan', section: 'Pricing', blurb: 'Plans with a price someone typed in, or a quote.' },
  developers: { plural: 'Developers', singular: 'developer profile', section: 'Our developers', blurb: 'People who agreed to be shown.' },
};

/** The cache tag a content type is read under (`revalidateTag` and `unstable_cache` use the same string). */
export type ContentTag = ContentType | 'site';
export const contentTag = (type: ContentTag) => `content:${type}` as const;

/**
 * The home page sections that depend on content, in page order. A section renders only when
 * its type has at least one PUBLISHED record (docs/CONTRACT.md section 1); its nav link and 3D
 * station go with it. Hero, contact and footer do not depend on a content type.
 */
export const HOME_SECTIONS = [
  { key: 'partners', type: 'partners', label: 'Partners' },
  { key: 'projects', type: 'showcase', label: 'Our projects' },
  { key: 'services', type: 'services', label: 'Services' },
  { key: 'pricing', type: 'pricing', label: 'Pricing' },
  { key: 'developers', type: 'developers', label: 'Our developers' },
] as const satisfies ReadonlyArray<{ key: string; type: ContentType; label: string }>;

export type HomeSectionKey = (typeof HOME_SECTIONS)[number]['key'];

/** Longest developer bio: the card on the public site is built for it. */
export const MAX_BIO_LENGTH = 280;

/* ----------------------------------------------------------------------------------------- */
/* Admin shapes                                                                              */
/* ----------------------------------------------------------------------------------------- */

export interface MediaRefDTO {
  id: string;
  url: string;
  filename: string;
  mime: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

export interface ContentBaseDTO {
  id: string;
  type: ContentType;
  status: ContentStatus;
  order: number;
  /** The record's own name: title, name or display name, depending on the type. */
  title: string;
  slug: string | null;
  /** When it was last published. A draft keeps this after being unpublished. */
  publishedAt: string | null;
  publishedBy: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  /** Plain sentences naming what stops this being published yet. Empty when it can be. */
  blockers: string[];
}

export interface ShowcaseDTO extends ContentBaseDTO {
  type: 'showcase';
  clientDisplayName: string | null;
  /** The internal project link. `projectLabel` is null when the viewer may not see projects. */
  projectId: string | null;
  projectLabel: string | null;
  summary: string;
  body: { brief: string | null; built: string | null; result: string | null };
  serviceIds: string[];
  services: Array<{ id: string; title: string }>;
  stack: string[];
  coverMedia: MediaRefDTO | null;
  galleryMedia: MediaRefDTO[];
  liveUrl: string | null;
  /** YYYY-MM-DD. */
  completedOn: string | null;
  clientApproved: boolean;
}

export interface PartnerDTO extends ContentBaseDTO {
  type: 'partners';
  kind: (typeof PARTNER_KINDS)[number];
  logoMedia: MediaRefDTO | null;
  url: string | null;
  permissionConfirmed: boolean;
}

export interface ServiceDTO extends ContentBaseDTO {
  type: 'services';
  summary: string;
  deliverables: string[];
  stack: string[];
  totemKey: string | null;
}

export interface PricingPlanDTO extends ContentBaseDTO {
  type: 'pricing';
  summary: string | null;
  priceModel: (typeof PRICE_MODELS)[number];
  amountMinor: number | null;
  currency: string | null;
  priceNote: string | null;
  features: string[];
  highlighted: boolean;
  ctaLabel: string | null;
}

export interface DeveloperDTO extends ContentBaseDTO {
  type: 'developers';
  adminId: string | null;
  /** The linked team member's name, for the editor only. */
  adminName: string | null;
  /** Their job title ("Frontend developer"). `title` on the base is the person's display name. */
  jobTitle: string | null;
  photoMedia: MediaRefDTO | null;
  bio: string | null;
  skills: string[];
  links: { github: string | null; linkedin: string | null; website: string | null };
  consentConfirmed: boolean;
}

export interface ContentDTOMap {
  showcase: ShowcaseDTO;
  partners: PartnerDTO;
  services: ServiceDTO;
  pricing: PricingPlanDTO;
  developers: DeveloperDTO;
}
export type AnyContentDTO = ContentDTOMap[ContentType];

export interface SiteInfoDTO {
  legalName: string | null;
  displayName: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  social: { linkedin: string | null; github: string | null; x: string | null; instagram: string | null; dribbble: string | null; behance: string | null };
  footerNote: string | null;
  /** Null until someone has saved the company info. */
  updatedAt: string | null;
}

/* ----------------------------------------------------------------------------------------- */
/* Public shapes: what the website receives. Published records only, no internal fields.      */
/* ----------------------------------------------------------------------------------------- */

export interface PublicImage {
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

export interface PublicShowcaseItem {
  slug: string;
  title: string;
  clientDisplayName: string | null;
  summary: string;
  body: { brief: string | null; built: string | null; result: string | null };
  /** Published services only. */
  services: Array<{ slug: string; title: string }>;
  stack: string[];
  cover: PublicImage | null;
  gallery: PublicImage[];
  liveUrl: string | null;
  /** YYYY-MM-DD, present only when someone entered it. */
  completedOn: string | null;
  publishedAt: string | null;
}

export interface PublicPartner {
  key: string;
  name: string;
  kind: (typeof PARTNER_KINDS)[number];
  logo: PublicImage | null;
  url: string | null;
}

export interface PublicService {
  slug: string;
  title: string;
  summary: string;
  deliverables: string[];
  stack: string[];
  totemKey: string | null;
}

export interface PublicPricingPlan {
  key: string;
  name: string;
  summary: string | null;
  priceModel: (typeof PRICE_MODELS)[number];
  /** Null for a quote plan: it renders with no number at all. */
  price: { amountMinor: number; currency: string } | null;
  priceNote: string | null;
  features: string[];
  highlighted: boolean;
  ctaLabel: string | null;
}

export interface PublicDeveloper {
  key: string;
  displayName: string;
  title: string | null;
  photo: PublicImage | null;
  bio: string | null;
  skills: string[];
  links: { github: string | null; linkedin: string | null; website: string | null };
}

/** Company details with empty fields left out, so the footer renders only what exists. */
export interface PublicSiteInfo {
  displayName: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  social: Partial<Record<keyof SiteInfoDTO['social'], string>>;
  footerNote: string | null;
}

export type VisibleSections = Record<HomeSectionKey, boolean>;
