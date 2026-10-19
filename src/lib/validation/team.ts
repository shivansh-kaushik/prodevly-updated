import { z } from 'zod';
import { CURRENCY_CODES } from '@/config/currencies';
import { PAY_BASES } from '@/config/statuses';
import { parseDateOnly } from '@/lib/dates/date-only';
import { objectIdSchema } from './common';

/** `objectIdSchema` accepts both spellings of a hex id; identity checks need exactly one. */
const lowerId = objectIdSchema.transform((v) => v.toLowerCase());

/** "Front   end" and "Front end" are the same role: whitespace runs collapse before the length checks. */
const collapse = (s: string) => s.replace(/\s+/g, ' ');

const roleName = z
  .string({ error: 'Name is required' })
  .trim()
  .transform(collapse)
  .pipe(z.string().min(2, { error: 'Name is required (at least 2 characters)' }).max(60, { error: 'Name is too long (60 characters at most)' }));

/** Empty text clears the description. */
const roleDescription = z.string().trim().max(300, { error: 'Keep the description under 300 characters' });

export const teamRoleCreateSchema = z
  .object({ name: roleName, description: roleDescription.optional() })
  .strict();

export const teamRoleUpdateSchema = z
  .object({ name: roleName.optional(), description: roleDescription.optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'Nothing to update' });

export const teamRoleReorderSchema = z
  .object({ ids: z.array(lowerId).min(1).max(200) })
  .strict()
  .refine((v) => new Set(v.ids).size === v.ids.length, { error: 'Each job role can appear once', path: ['ids'] });

/** The earliest start date accepted: pay records older than this are a typo. */
export const PAY_EARLIEST = '2000-01-01';
/** Rates are minor units of the stated currency; this is a sanity ceiling, not a business rule. */
const MAX_RATE_MINOR = 100_000_000_000;

const calendarDate = z
  .string({ error: 'Enter the date this takes effect' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Enter the date this takes effect' })
  .refine((v) => parseDateOnly(v) !== null, { error: 'That is not a real date' })
  .refine((v) => v >= PAY_EARLIEST, { error: 'That date is too far in the past' });

/**
 * How one person is paid. Shared by the form and the route, and re-run inside the service so a
 * direct caller cannot skip it. `rateMinor` is in the minor unit of `currency`: monthly salary,
 * rate per hour or rate per task, depending on `basis`. Empty `payoutNote` clears it; leaving it
 * out keeps what is stored.
 */
export const payProfileSchema = z
  .object({
    basis: z.enum(PAY_BASES, { error: 'Choose how this person is paid' }),
    rateMinor: z
      .number({ error: 'Enter the rate' })
      .int({ error: 'The rate must be a whole number of minor units' })
      .min(0, { error: 'The rate cannot be negative' })
      .max(MAX_RATE_MINOR, { error: 'That rate is too large' }),
    currency: z.enum(CURRENCY_CODES, { error: 'Choose a currency' }),
    effectiveFrom: calendarDate,
    payoutNote: z.string().trim().max(500, { error: 'Keep the note under 500 characters' }).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.basis === 'none' && v.rateMinor !== 0) {
      ctx.addIssue({ code: 'custom', path: ['rateMinor'], message: 'A profile with no pay basis has no rate' });
    }
    if (v.basis !== 'none' && v.rateMinor === 0) {
      ctx.addIssue({ code: 'custom', path: ['rateMinor'], message: 'Enter the rate' });
    }
  });

/** What a person may change about themself. Job role, employment type, capacity, grants and pay are not on this list. */
export const OWN_PROFILE_FIELDS = ['phone', 'designation', 'skills'] as const;

const PHONE = /^[\d\s+().-]{5,30}$/;

export const ownProfileSchema = z
  .object({
    phone: z
      .string()
      .trim()
      .refine((v) => v === '' || PHONE.test(v), { error: 'Use digits, spaces and + ( ) - only (5 to 30 characters)' })
      .optional(),
    designation: z.string().trim().max(80, { error: 'Keep the title under 80 characters' }).optional(),
    skills: z
      .array(z.string().trim().min(1, { error: 'A skill cannot be empty' }).max(40, { error: 'Keep each skill under 40 characters' }))
      .max(30, { error: 'Thirty skills at most' })
      .optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'Nothing to update' });

export type TeamRoleCreateInput = z.infer<typeof teamRoleCreateSchema>;
export type TeamRoleUpdateInput = z.infer<typeof teamRoleUpdateSchema>;
export type TeamRoleReorderInput = z.infer<typeof teamRoleReorderSchema>;
export type PayProfileInput = z.infer<typeof payProfileSchema>;
export type OwnProfileInput = z.infer<typeof ownProfileSchema>;
