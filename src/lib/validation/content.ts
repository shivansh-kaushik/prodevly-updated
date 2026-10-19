import { z } from 'zod';
import { CURRENCY_CODES } from '@/config/currencies';
import { PARTNER_KINDS, PRICE_MODELS } from '@/config/statuses';
import { parseDateOnly } from '@/lib/dates/date-only';
import { MAX_BIO_LENGTH, type ContentType } from '@/lib/content/types';
import { emailSchema, objectIdSchema } from './common';

/**
 * Schemas for website content, shared by the editors and the route handlers.
 *
 * Conventions that matter for PATCH:
 * - There are NO `.default()`s. In zod 4 a default inside `.partial()` still fires, which would
 *   silently overwrite a field the caller never sent. Defaults live in the service.
 * - For optional fields `undefined` means "leave it", and `null` or an empty string means "clear it".
 * - Every web address must be http or https, because these values end up in `href`s on the public
 *   site and `javascript:` must never get there.
 */

const nonEmpty = (v: Record<string, unknown>) => Object.keys(v).length > 0;

const reqText = (label: string, max: number, min = 2) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(min, { error: `${label} is required` })
    .max(max, { error: `${label} must be ${max} characters or fewer` });

/** Optional text: undefined = leave, ''/null = clear. */
const optText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `${label} must be ${max} characters or fewer` })
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null));

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password && url.hostname.includes('.');
  } catch {
    return false;
  }
}

const webAddress = (label: string, max = 300) =>
  optText(label, max).refine((v) => v === undefined || v === null || isHttpUrl(v), {
    error: `${label} must be a full web address starting with https://`,
  });

/** A lowercase 24-hex id. */
const id = objectIdSchema.transform((v) => v.toLowerCase());
const optId = z
  .union([objectIdSchema, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v ? v.toLowerCase() : null));

const dedupe = <T extends string>(list: T[]): T[] => {
  const seen = new Set<string>();
  return list.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** A list of short strings. Blank entries (an empty textarea line) are dropped, repeats are merged. */
const stringList = (label: string, maxItems: number, maxLength: number) =>
  z
    .array(z.string().trim().max(maxLength, { error: `${label}: each entry must be ${maxLength} characters or fewer` }))
    .max(maxItems, { error: `${label}: at most ${maxItems} entries` })
    .transform((list) => dedupe(list.filter(Boolean)));

const idList = (label: string, max: number) =>
  z
    .array(id)
    .max(max, { error: `${label}: at most ${max}` })
    .transform((list) => dedupe(list));

const calendarDate = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v === undefined ? undefined : v || null))
  .refine((v) => v === undefined || v === null || parseDateOnly(v) !== null, { error: 'Enter a real date' });

/* ---------------------------------------------------------------- showcase */

const showcaseShape = {
  title: reqText('Title', 140),
  clientDisplayName: optText('Client name', 120),
  projectId: optId,
  summary: reqText('Summary', 400, 3),
  body: z
    .object({
      brief: optText('The brief', 4000),
      built: optText('What we built', 4000),
      result: optText('The result', 4000),
    })
    .strict()
    .optional(),
  serviceIds: idList('Services', 12).optional(),
  stack: stringList('Stack', 20, 40).optional(),
  coverMediaId: optId,
  galleryMediaIds: idList('Gallery', 12).optional(),
  liveUrl: webAddress('Live link'),
  completedOn: calendarDate,
  clientApproved: z.boolean().optional(),
};
export const createShowcaseSchema = z.object(showcaseShape).strict();
export const updateShowcaseSchema = z.object(showcaseShape).partial().strict().refine(nonEmpty, { error: 'Nothing to update' });

/* ---------------------------------------------------------------- partners */

const partnerShape = {
  name: reqText('Name', 120),
  kind: z.enum(PARTNER_KINDS, { error: 'Pick a kind' }),
  logoMediaId: optId,
  url: webAddress('Website'),
  permissionConfirmed: z.boolean().optional(),
};
export const createPartnerSchema = z.object(partnerShape).strict();
export const updatePartnerSchema = z.object(partnerShape).partial().strict().refine(nonEmpty, { error: 'Nothing to update' });

/* ---------------------------------------------------------------- services */

/**
 * The key of the 3D totem for this service. The totem set belongs to the stage engine and does
 * not exist yet, so the shape is checked here (a short lowercase key) and the engine maps keys
 * it does not know to a default.
 */
const totemKey = z
  .string()
  .trim()
  .toLowerCase()
  .nullish()
  .transform((v) => (v === undefined ? undefined : v || null))
  .refine((v) => v === undefined || v === null || /^[a-z][a-z0-9_-]{1,39}$/.test(v), {
    error: 'Use a short lowercase key such as "web-app"',
  });

const serviceShape = {
  title: reqText('Title', 100),
  summary: reqText('Summary', 400, 3),
  deliverables: stringList('Deliverables', 12, 160).optional(),
  stack: stringList('Stack', 20, 40).optional(),
  totemKey,
};
export const createServiceSchema = z.object(serviceShape).strict();
export const updateServiceSchema = z.object(serviceShape).partial().strict().refine(nonEmpty, { error: 'Nothing to update' });

/* ----------------------------------------------------------------- pricing */

const pricingShape = {
  name: reqText('Name', 80),
  summary: optText('Summary', 300),
  priceModel: z.enum(PRICE_MODELS, { error: 'Pick how this plan is priced' }),
  /** Integer minor units (the editor converts what a person types). Ignored for a quote plan. */
  amountMinor: z
    .number({ error: 'Enter a price' })
    .int({ error: 'The price must be a whole number of the smallest unit' })
    .positive({ error: 'The price must be above zero' })
    .max(Number.MAX_SAFE_INTEGER)
    .nullish()
    .transform((v) => (v === undefined ? undefined : (v ?? null))),
  currency: z
    .enum(CURRENCY_CODES as [string, ...string[]], { error: 'Choose a currency' })
    .nullish()
    .transform((v) => (v === undefined ? undefined : (v ?? null))),
  priceNote: optText('Price note', 200),
  features: stringList('Features', 12, 160).optional(),
  highlighted: z.boolean().optional(),
  ctaLabel: optText('Button label', 40),
};
export const createPricingSchema = z.object(pricingShape).strict();
export const updatePricingSchema = z.object(pricingShape).partial().strict().refine(nonEmpty, { error: 'Nothing to update' });

/* -------------------------------------------------------------- developers */

const developerShape = {
  adminId: optId,
  displayName: reqText('Name', 80),
  title: optText('Title', 80),
  photoMediaId: optId,
  bio: optText('Bio', MAX_BIO_LENGTH),
  skills: stringList('Skills', 20, 40).optional(),
  links: z
    .object({ github: webAddress('GitHub link', 200), linkedin: webAddress('LinkedIn link', 200), website: webAddress('Website', 200) })
    .strict()
    .optional(),
  consentConfirmed: z.boolean().optional(),
};
export const createDeveloperSchema = z.object(developerShape).strict();
export const updateDeveloperSchema = z.object(developerShape).partial().strict().refine(nonEmpty, { error: 'Nothing to update' });

/* -------------------------------------------------------------- site info */

const optEmail = z
  .union([emailSchema, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v || null));

const optPhone = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v === undefined ? undefined : v || null))
  .refine((v) => v === undefined || v === null || /^[+()\d\s.-]{5,40}$/.test(v), { error: 'Use digits, spaces and + ( ) - only' });

/** PUT replaces the whole record: whatever is left out is cleared. */
export const siteInfoSchema = z
  .object({
    legalName: optText('Legal name', 160),
    displayName: reqText('Display name', 80),
    email: optEmail,
    phone: optPhone,
    whatsapp: optPhone,
    address: optText('Address', 400),
    social: z
      .object({
        linkedin: webAddress('LinkedIn link', 200),
        github: webAddress('GitHub link', 200),
        x: webAddress('X link', 200),
        instagram: webAddress('Instagram link', 200),
        dribbble: webAddress('Dribbble link', 200),
        behance: webAddress('Behance link', 200),
      })
      .strict()
      .optional(),
    footerNote: optText('Footer note', 300),
  })
  .strict();

/* --------------------------------------------------------------- reorder */

export const reorderSchema = z
  .object({ ids: z.array(id).min(1, { error: 'Nothing to reorder' }).max(200) })
  .strict()
  .refine((v) => new Set(v.ids).size === v.ids.length, { error: 'Each item may appear once' });

/* -------------------------------------------------------------- by type */

export const createSchemas = {
  showcase: createShowcaseSchema,
  partners: createPartnerSchema,
  services: createServiceSchema,
  pricing: createPricingSchema,
  developers: createDeveloperSchema,
} as const satisfies Record<ContentType, z.ZodType>;

export const updateSchemas = {
  showcase: updateShowcaseSchema,
  partners: updatePartnerSchema,
  services: updateServiceSchema,
  pricing: updatePricingSchema,
  developers: updateDeveloperSchema,
} as const satisfies Record<ContentType, z.ZodType>;

/**
 * zod's OUTPUT type keeps a key required (as `T | undefined`) once a field passes through a
 * transform, which would force every caller to write `projectId: undefined`. A key whose value may
 * be undefined is optional here, which is what the schemas actually accept.
 */
type LooseValue<V> = V extends readonly unknown[] ? V : V extends object ? Loose<V> : V;
type Loose<T> = { [K in keyof T as undefined extends T[K] ? K : never]?: LooseValue<T[K]> } & { [K in keyof T as undefined extends T[K] ? never : K]: LooseValue<T[K]> };

export type CreateShowcaseInput = Loose<z.infer<typeof createShowcaseSchema>>;
export type UpdateShowcaseInput = Loose<z.infer<typeof updateShowcaseSchema>>;
export type CreatePartnerInput = Loose<z.infer<typeof createPartnerSchema>>;
export type UpdatePartnerInput = Loose<z.infer<typeof updatePartnerSchema>>;
export type CreateServiceInput = Loose<z.infer<typeof createServiceSchema>>;
export type UpdateServiceInput = Loose<z.infer<typeof updateServiceSchema>>;
export type CreatePricingInput = Loose<z.infer<typeof createPricingSchema>>;
export type UpdatePricingInput = Loose<z.infer<typeof updatePricingSchema>>;
export type CreateDeveloperInput = Loose<z.infer<typeof createDeveloperSchema>>;
export type UpdateDeveloperInput = Loose<z.infer<typeof updateDeveloperSchema>>;
export type SiteInfoInput = Loose<z.infer<typeof siteInfoSchema>>;
export type ReorderInput = z.infer<typeof reorderSchema>;

export interface ContentInputMap {
  showcase: { create: CreateShowcaseInput; update: UpdateShowcaseInput };
  partners: { create: CreatePartnerInput; update: UpdatePartnerInput };
  services: { create: CreateServiceInput; update: UpdateServiceInput };
  pricing: { create: CreatePricingInput; update: UpdatePricingInput };
  developers: { create: CreateDeveloperInput; update: UpdateDeveloperInput };
}
