import { z } from 'zod';
import { first, oneOf, type RawSearchParams } from '@/lib/admin/search-params';
import { currencySchema } from './fx';
import { emailSchema } from './common';

/**
 * Third-party directory input, shared by the forms and the routes. Whether `type` is one of the
 * types a superadmin has switched on in Settings needs the database, so the SERVICE checks that.
 * `paymentNote` (bank, UPI, PayPal or Wise details) is accepted here but only ever written by someone
 * holding `thirdParty:payDetails`; the service refuses it for anyone else.
 */
const text = (max: number) => z.string().trim().max(max, { error: `Keep this under ${max} characters` });

const name = z.string({ error: 'Enter a name' }).trim().min(2, { error: 'Enter a name' }).max(120, { error: 'That name is too long' });
const type = z.string({ error: 'Pick a type' }).trim().min(2, { error: 'Pick a type' }).max(40);
const skill = z.string().trim().min(1).max(40, { error: 'Keep each skill under 40 characters' });
const skills = z.array(skill).max(20, { error: 'At most 20 skills' });
const country = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, { error: 'Use the two-letter country code, for example IN' });
const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9A-Z]{15}$/, { error: 'GSTIN must be 15 characters' });

export const THIRD_PARTY_STATUSES = ['active', 'inactive'] as const;

export const createThirdPartySchema = z
  .object({
    name,
    type,
    skills: skills.default([]),
    contactName: text(100).optional(),
    email: emailSchema.optional(),
    phone: text(30).optional(),
    country: country.optional(),
    defaultCurrency: currencySchema.optional(),
    gstin: gstin.optional(),
    notes: text(4000).optional(),
    /** Needs `thirdParty:payDetails`. */
    paymentNote: text(1000).optional(),
  })
  .strict();

/** `null` clears an optional field. The reference is generated and never editable. */
export const updateThirdPartySchema = z
  .object({
    name: name.optional(),
    type: type.optional(),
    skills: skills.optional(),
    status: z.enum(THIRD_PARTY_STATUSES, { error: 'Pick active or inactive' }).optional(),
    contactName: text(100).nullable().optional(),
    email: emailSchema.nullable().optional(),
    phone: text(30).nullable().optional(),
    country: country.nullable().optional(),
    defaultCurrency: currencySchema.nullable().optional(),
    gstin: gstin.nullable().optional(),
    notes: text(4000).nullable().optional(),
    /** Needs `thirdParty:payDetails`. `null` or an empty string removes it. */
    paymentNote: text(1000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'Nothing to update' });

export type CreateThirdPartyBody = z.infer<typeof createThirdPartySchema>;
export type CreateThirdPartyInput = z.input<typeof createThirdPartySchema>;
export type UpdateThirdPartyInput = z.infer<typeof updateThirdPartySchema>;

export const THIRD_PARTY_SORTS = ['name', 'ref', 'type', 'updatedAt', 'createdAt'] as const;
export type ThirdPartySort = (typeof THIRD_PARTY_SORTS)[number];

export interface ThirdPartyFilter {
  q?: string;
  type?: string;
  status?: (typeof THIRD_PARTY_STATUSES)[number];
  /** Archived records are hidden unless asked for. */
  archived?: 'only' | 'include';
}

/** Reads the directory filters from URL params, defensively: a bad value is ignored, never an error page. */
export function parseThirdPartyFilter(sp: RawSearchParams): ThirdPartyFilter {
  const filter: ThirdPartyFilter = {};
  const q = first(sp, 'q');
  if (q) filter.q = q.slice(0, 100);
  const type = first(sp, 'type');
  if (type) filter.type = type.slice(0, 40);
  const status = oneOf(sp, 'status', THIRD_PARTY_STATUSES);
  if (status) filter.status = status;
  const archived = oneOf(sp, 'archived', ['only', 'include'] as const);
  if (archived) filter.archived = archived;
  return filter;
}
