import { z } from 'zod';
import { CLIENT_KINDS, PROJECT_TYPES } from '@/config/statuses';
import { createClientSchema } from './client';

/**
 * Converting an enquiry into a client, and optionally a draft project. Shared by the convert
 * drawer, the route and the service. No database in here.
 *
 * Two modes: `new` creates a client (the drawer prefills it from the enquiry, and the service
 * falls back to the same prefill for anything left out), `existing` links a client that is already
 * on the books. Either way a draft project can be started for that client.
 */

const clientId = z.string({ error: 'Pick a client' }).regex(/^[a-f\d]{24}$/i, { error: 'Pick a client' });

/**
 * The client fields the drawer lets the person change. The rules are the client module's own, so a
 * client made here can never be one the Clients form would have refused. `kind` is redefined without
 * the Clients form's default of "company": left out, it follows the enquiry (a person is an individual).
 */
const newClient = createClientSchema
  .pick({ name: true, country: true, billingCurrency: true })
  .extend({ kind: z.enum(CLIENT_KINDS, { error: 'Pick company or individual' }).optional() })
  .strict();

const draftProject = z
  .object({
    name: z.string({ error: 'Name is required' }).trim().min(2, { error: 'Name is required' }).max(140, { error: 'Name is too long' }),
    type: z.enum(PROJECT_TYPES, { error: 'Pick a project type' }),
  })
  .strict();

const project = draftProject.nullable().optional();

export const convertLeadSchema = z.discriminatedUnion(
  'mode',
  [
    z.object({ mode: z.literal('new'), client: newClient.optional(), project }).strict(),
    z.object({ mode: z.literal('existing'), clientId, project }).strict(),
  ],
  { error: 'Choose a new client or an existing one' },
);

export type ConvertLeadInput = z.infer<typeof convertLeadSchema>;
export type ConvertClientPart = z.infer<typeof newClient>;
export type ConvertProjectPart = z.infer<typeof draftProject>;

/* --------------------------------- prefill --------------------------------- */

/** The enquiry fields a conversion reads. Both the DTO the page holds and a database row fit. */
export interface LeadSource {
  name: string;
  company?: string | null;
  email: string;
  phone?: string | null;
  country?: string | null;
  message: string;
}

/** What the client side needs: the drawer prefills the client from the enquirer and never needs the message. */
export type ClientSource = Omit<LeadSource, 'message'>;

const CLIENT_NAME_MAX = 120;
const CONTACT_NAME_MAX = 100;
const CONTACT_PHONE_MAX = 30;
const SCOPE_MAX = 4000;

/** A company enquiry becomes a company named as it signed, a person's becomes an individual. */
export function clientNameFromLead(lead: Pick<LeadSource, 'name' | 'company'>): string {
  return (lead.company?.trim() || lead.name.trim()).slice(0, CLIENT_NAME_MAX);
}

// "UK" is what people type; ISO says GB (Intl knows UK as an exceptional reservation and would name it too).
const COUNTRY_ALIASES: Record<string, string> = { uk: 'GB', 'great britain': 'GB', england: 'GB', usa: 'US', 'united states of america': 'US', uae: 'AE' };
// Codes Intl can name that are not countries (European Union, United Nations, unknown region, islands that ride on another country).
const NOT_COUNTRIES = new Set(['AC', 'CP', 'DG', 'EA', 'EU', 'IC', 'QO', 'TA', 'UN', 'ZZ']);

let regionNames: Intl.DisplayNames | undefined;
let codesByName: Map<string, string> | undefined;
const normaliseCountry = (text: string) => text.toLowerCase().replace(/\./g, '').replace(/^the\s+/, '').replace(/\s+/g, ' ').trim();

function regions() {
  if (!regionNames || !codesByName) {
    regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
    codesByName = new Map();
    for (let a = 65; a <= 90; a += 1) {
      for (let b = 65; b <= 90; b += 1) {
        const code = String.fromCharCode(a, b);
        const name = NOT_COUNTRIES.has(code) ? undefined : regionNames.of(code);
        // First code wins: GB comes before the reserved UK, which Intl also calls "United Kingdom".
        if (name && !codesByName.has(normaliseCountry(name))) codesByName.set(normaliseCountry(name), code);
      }
    }
  }
  return { names: regionNames, byName: codesByName };
}

/**
 * The visitor types a country as free text ("India", "IN", "uk"); a client stores an ISO 3166-1
 * alpha-2 code. Returns the code, or '' when the text is not a country we recognise, so the person
 * picks it themselves instead of the client being saved with a guess.
 */
export function countryCodeFromText(text: string | null | undefined): string {
  const t = normaliseCountry(text ?? '');
  if (!t) return '';
  const alias = COUNTRY_ALIASES[t];
  if (alias) return alias;
  const { names, byName } = regions();
  const code = t.toUpperCase();
  if (/^[a-z]{2}$/.test(t) && !NOT_COUNTRIES.has(code) && names.of(code)) return code;
  return byName.get(t) ?? '';
}

export interface ClientPrefill {
  name: string;
  kind: 'company' | 'individual';
  /** ISO code, or '' when the enquiry's country is not one we recognise. */
  country: string;
  /** The enquirer, as the new client's main contact. */
  contact: { name: string; email: string; phone: string };
  /** Only used for what the contact record cannot hold (a phone number longer than it allows). */
  notes: string;
}

export function prefillClient(lead: ClientSource): ClientPrefill {
  const phone = lead.phone?.trim() ?? '';
  const phoneFits = phone.length <= CONTACT_PHONE_MAX;
  return {
    name: clientNameFromLead(lead),
    kind: lead.company?.trim() ? 'company' : 'individual',
    country: countryCodeFromText(lead.country),
    contact: { name: lead.name.trim().slice(0, CONTACT_NAME_MAX), email: lead.email.trim(), phone: phoneFits ? phone : '' },
    notes: phoneFits || !phone ? '' : `Phone from the enquiry: ${phone}`,
  };
}

/** The drawer's starting values for the optional draft project. The type is left for the person to choose. */
export function prefillProject(lead: Pick<LeadSource, 'name' | 'company'>): { name: string } {
  return { name: `${clientNameFromLead(lead)} project`.slice(0, 140) };
}

/** The enquiry's message becomes the project's scope summary; the full text stays on the enquiry. */
export function scopeFromMessage(message: string): string {
  const text = message.trim();
  return text.length > SCOPE_MAX ? `${text.slice(0, SCOPE_MAX - 3)}...` : text;
}

/**
 * What the client module's create schema is given. The enquirer is always the main contact; the
 * person's own edits (name, kind, country, currency) override the prefill, and a country they
 * cleared stays cleared.
 */
export function buildClientInput(lead: ClientSource, part?: ConvertClientPart): Record<string, unknown> {
  const fill = prefillClient(lead);
  return {
    name: part?.name ?? fill.name,
    kind: part?.kind ?? fill.kind,
    country: part?.country ?? fill.country,
    ...(part?.billingCurrency ? { billingCurrency: part.billingCurrency } : {}),
    contacts: [{ name: fill.contact.name, email: fill.contact.email, phone: fill.contact.phone, isPrimary: true }],
    ...(fill.notes ? { notes: fill.notes } : {}),
  };
}

/** What the project module's create schema is given: a proposal, with the enquiry's message as its scope. */
export function buildProjectInput(lead: LeadSource, clientId: string, part: ConvertProjectPart): Record<string, unknown> {
  return {
    clientId,
    name: part.name,
    type: part.type,
    status: 'proposal',
    scopeSummary: scopeFromMessage(lead.message),
  };
}
