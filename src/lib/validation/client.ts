import { z } from 'zod';
import { CURRENCY_CODES, isCurrencyCode } from '@/config/currencies';
import { CLIENT_KINDS, CLIENT_SOURCES, CLIENT_STATUSES } from '@/config/statuses';
import { emailSchema, objectIdSchema } from './common';

/**
 * Client schemas, shared by the form and the route handlers. No database in here, so the form
 * can import it. The service repeats the rules that need the database (settings, duplicates).
 */
export const MAX_CONTACTS = 20;

const text = (max: number, tooLong = 'That is too long') => z.string().trim().max(max, { error: tooLong });

const name = z.string({ error: 'Name is required' }).trim().min(2, { error: 'Name is required' }).max(120, { error: 'Name is too long' });

/** A company's 15-character tax number. Empty clears it. */
const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => v === '' || /^[0-9A-Z]{15}$/.test(v), { error: 'A GSTIN has exactly 15 letters and digits' });

const country = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => v === '' || /^[A-Z]{2}$/.test(v), { error: 'Use the 2-letter country code, for example IN or US' });

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => v === '' || isCurrencyCode(v), { error: 'Pick a currency' });

/** http(s) only: the website renders as a link and a `javascript:` address must never get through. */
const website = text(200).refine(
  (v) => {
    if (v === '') return true;
    try {
      const url = new URL(v);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  },
  { error: 'Enter a full web address starting with https://' },
);

export const contactSchema = z
  .object({
    name: z.string({ error: 'Name is required' }).trim().min(1, { error: 'Name is required' }).max(100, { error: 'Name is too long' }),
    email: z.union([z.literal(''), emailSchema]).optional(),
    phone: text(30).optional(),
    designation: text(80).optional(),
    isPrimary: z.boolean().default(false),
  })
  .strict();

const contacts = z.array(contactSchema).max(MAX_CONTACTS, { error: `Up to ${MAX_CONTACTS} contacts` });

const address = z
  .object({
    line1: text(160).optional(),
    line2: text(160).optional(),
    city: text(80).optional(),
    state: text(80).optional(),
    postalCode: text(20).optional(),
    country: country.optional(),
  })
  .strict();

const tags = z.array(z.string().trim().min(1).max(40)).max(20, { error: 'Up to 20 tags' });

const base = {
  name,
  kind: z.enum(CLIENT_KINDS, { error: 'Pick company or individual' }),
  status: z.enum(CLIENT_STATUSES, { error: 'Pick a status' }),
  industry: text(80),
  country,
  billingCurrency: currency,
  gstin,
  taxId: text(40),
  website,
  address,
  contacts,
  /** An active admin. Empty clears the owner. */
  accountOwnerId: z.union([z.literal(''), objectIdSchema]),
  source: z.union([z.literal(''), z.enum(CLIENT_SOURCES)]),
  notes: text(4000, 'Keep the notes under 4,000 characters'),
  tags,
};

export const createClientSchema = z
  .object({
    name: base.name,
    kind: base.kind.default('company'),
    status: base.status.default('prospect'),
    industry: base.industry.optional(),
    country: base.country.optional(),
    billingCurrency: base.billingCurrency.optional(),
    gstin: base.gstin.optional(),
    taxId: base.taxId.optional(),
    website: base.website.optional(),
    address: base.address.optional(),
    contacts: base.contacts.default([]),
    accountOwnerId: base.accountOwnerId.optional(),
    source: base.source.optional(),
    notes: base.notes.optional(),
    tags: base.tags.default([]),
  })
  .strict();

export const updateClientSchema = z
  .object({
    name: base.name.optional(),
    kind: base.kind.optional(),
    status: base.status.optional(),
    industry: base.industry.optional(),
    country: base.country.optional(),
    billingCurrency: base.billingCurrency.optional(),
    gstin: base.gstin.optional(),
    taxId: base.taxId.optional(),
    website: base.website.optional(),
    address: base.address.optional(),
    contacts: base.contacts.optional(),
    accountOwnerId: base.accountOwnerId.optional(),
    source: base.source.optional(),
    notes: base.notes.optional(),
    tags: base.tags.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'Nothing to update' });

/** Deleting a client for good makes the person type its name, so it cannot be done by a stray click. */
export const deleteClientSchema = z.object({ confirmName: z.string({ error: 'Type the client name to confirm' }).trim().min(1, { error: 'Type the client name to confirm' }) });

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ClientContactInput = z.infer<typeof contactSchema>;

export const CLIENT_CURRENCIES: readonly string[] = CURRENCY_CODES;

/**
 * Exactly one primary contact when there are any contacts. None flagged: the first becomes primary.
 * Several flagged is an error the person must resolve, not something to guess at.
 */
export function normaliseContacts(input: readonly ClientContactInput[]): { contacts: ClientContactInput[]; error?: string } {
  if (input.length === 0) return { contacts: [] };
  const primaries = input.filter((c) => c.isPrimary).length;
  if (primaries > 1) return { contacts: [...input], error: 'Only one contact can be the main contact' };
  if (primaries === 1) return { contacts: input.map((c) => ({ ...c })) };
  return { contacts: input.map((c, i) => ({ ...c, isPrimary: i === 0 })) };
}
