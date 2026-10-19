import { z } from 'zod';
import { LEAD_STATUSES, type LeadStatus } from '@/config/statuses';
import { parseDateOnly } from '@/lib/dates/date-only';
import { emailSchema, objectIdSchema } from './common';

/**
 * Enquiries (the `leads` collection). Two audiences, two kinds of schema:
 *
 * - `leadIntakeSchema` faces the PUBLIC contact form. Everything in it is untrusted visitor input,
 *   so text is cleaned (control, bidi-override and zero-width characters removed), optional fields
 *   that are junk are dropped instead of failing the whole submission, and nothing is trusted to be
 *   a real id or a real option until the service has checked it against the database.
 * - The admin schemas face signed-in staff and are strict.
 */

/** Statuses that still need work. Won, lost and spam are closed. */
export const OPEN_LEAD_STATUSES = ['new', 'contacted', 'qualified', 'proposal_sent'] as const satisfies readonly LeadStatus[];
export type OpenLeadStatus = (typeof OPEN_LEAD_STATUSES)[number];

export const isOpenLeadStatus = (status: string): status is OpenLeadStatus => (OPEN_LEAD_STATUSES as readonly string[]).includes(status);

/** The order of the status funnel. A lead "reached" a stage when it is, or ever was, at or past it. */
export const FUNNEL_STAGES = ['new', 'contacted', 'qualified', 'proposal_sent', 'won'] as const satisfies readonly LeadStatus[];

// Characters that are invisible or can make text lie about its order: control characters, bidi
// overrides and isolates (text displays reversed), zero-width characters and the byte-order mark.
// The class is built from code points so the source holds no literal control or separator characters.
const esc = (code: number) => `\\u${code.toString(16).padStart(4, '0')}`;
const span = ([from, to]: readonly [number, number]) => (from === to ? esc(from) : `${esc(from)}-${esc(to)}`);
const INVISIBLE_RANGES = [
  [0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x2069], [0xfeff, 0xfeff],
] as const;
const INVISIBLE = new RegExp(`[${INVISIBLE_RANGES.map(span).join('')}]`, 'g');
const LINE_BREAKS = new RegExp(`[\\r\\n\\t${esc(0x2028)}${esc(0x2029)}]+`, 'g');
const ANY_NEWLINE = new RegExp(`\\r\\n?|${esc(0x2028)}|${esc(0x2029)}`, 'g');

/** One-line text (a name, a company): line breaks become spaces, invisible characters go, whitespace collapses. */
export function cleanLine(value: string): string {
  return value.replace(LINE_BREAKS, ' ').replace(INVISIBLE, '').replace(/ {2,}/g, ' ').trim();
}

/** Multi-line text (a message, a note): keeps line breaks, removes invisible characters, caps runs of blank lines. */
export function cleanMultiline(value: string): string {
  return value
    .replace(ANY_NEWLINE, '\n')
    .replace(INVISIBLE, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The page a visitor sent the form from: a path only, never a query string (it can carry tokens or
 * personal data) and never an absolute or protocol-relative URL. Anything else is dropped.
 */
export function normaliseSourcePath(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const path = cleanLine(raw.split(/[?#]/)[0] ?? '');
  if (!path.startsWith('/') || path.startsWith('//')) return undefined;
  if (!/^\/[A-Za-z0-9\-._~%!$&'()*+,;=:@/]*$/.test(path)) return undefined;
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') || '/' : path;
  return trimmed.length <= 300 ? trimmed : undefined;
}

/** Optional one-line text: empty and missing both mean "not given". */
const optionalLine = (max: number) =>
  z
    .string()
    .nullish()
    .transform((v) => (v ? cleanLine(v) || undefined : undefined))
    .pipe(z.string().max(max, { error: `Keep this under ${max} characters` }).optional());

const utmValue = z
  .string()
  .nullish()
  .transform((v) => (v ? cleanLine(v).toLowerCase().slice(0, 100) || undefined : undefined));

const OBJECT_ID = /^[a-f\d]{24}$/i;

export const leadIntakeSchema = z.object({
  name: z
    .string({ error: 'Your name is required' })
    .transform(cleanLine)
    .pipe(z.string().min(2, { error: 'Your name is required' }).max(120, { error: 'That name is too long' })),
  email: emailSchema.pipe(z.string().max(160, { error: 'That email address is too long' })),
  phone: optionalLine(40).refine((v) => v === undefined || (/^[+()\d\s.\-/]{5,40}$/.test(v) && (v.match(/\d/g)?.length ?? 0) >= 6), {
    error: 'Enter a valid phone number',
  }),
  company: optionalLine(120),
  country: optionalLine(80),
  /** Ids of services the visitor ticked. Unknown, unpublished or malformed ids are ignored by the service, never an error. */
  serviceIds: z
    .array(z.unknown())
    .max(20)
    .catch([])
    .default([])
    .transform((ids) => [...new Set(ids.filter((id): id is string => typeof id === 'string' && OBJECT_ID.test(id)).map((id) => id.toLowerCase()))]),
  /** Must match one of the ranges in Settings; the service drops anything else. */
  budgetRange: optionalLine(60),
  message: z
    .string({ error: 'Tell us about your project' })
    .transform(cleanMultiline)
    .pipe(
      z
        .string()
        .min(10, { error: 'Tell us a little more (at least 10 characters)' })
        .max(5000, { error: 'That message is too long (5,000 characters at most)' }),
    ),
  sourcePath: z.string().max(2000).nullish().catch(undefined).transform(normaliseSourcePath),
  utm: z
    .object({ source: utmValue, medium: utmValue, campaign: utmValue })
    .nullish()
    .catch(undefined)
    .transform((u) => (u && (u.source || u.medium || u.campaign) ? { source: u.source, medium: u.medium, campaign: u.campaign } : undefined)),
});

export type LeadIntake = z.output<typeof leadIntakeSchema>;

const dateOnlyString = z.string().refine((v) => parseDateOnly(v) !== null, { error: 'Enter a valid date' });

export const updateLeadSchema = z
  .object({
    status: z.enum(LEAD_STATUSES, { error: 'Pick a status' }).optional(),
    /** Why the status changed; kept in the status history. */
    statusNote: z.string().trim().max(500, { error: 'Keep the note under 500 characters' }).optional(),
    /** An admin id to assign to, or null to unassign. */
    assignedTo: objectIdSchema.nullable().optional(),
    /** A calendar date (YYYY-MM-DD), or null to clear it. */
    followUpOn: dateOnlyString.nullable().optional(),
  })
  .strict()
  .refine((v) => v.status !== undefined || v.assignedTo !== undefined || v.followUpOn !== undefined, { error: 'Nothing to update' })
  .refine((v) => v.statusNote === undefined || v.status !== undefined, { error: 'A note needs a status change', path: ['statusNote'] });

export const addLeadNoteSchema = z
  .object({
    text: z
      .string({ error: 'Write a note' })
      .transform(cleanMultiline)
      .pipe(z.string().min(1, { error: 'Write a note' }).max(2000, { error: 'Keep the note under 2,000 characters' })),
  })
  .strict();

export const markSpamSchema = z.object({ note: z.string().trim().max(500, { error: 'Keep the note under 500 characters' }).optional() }).strict();

export const deleteLeadSchema = z
  .object({ reason: z.string({ error: 'Give a reason' }).trim().min(3, { error: 'Give a reason' }).max(300) })
  .strict();

export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
export type AddLeadNoteInput = z.infer<typeof addLeadNoteSchema>;
export type MarkSpamInput = z.infer<typeof markSpamSchema>;
export type DeleteLeadInput = z.infer<typeof deleteLeadSchema>;

/** The `?source=` filter on the list: `utm:google` or `page:/contact`. Anything else is ignored. */
export function parseSourceFilter(raw: string | undefined): { kind: 'utm' | 'page'; value: string } | undefined {
  if (!raw) return undefined;
  const match = /^(utm|page):(.{1,300})$/s.exec(raw);
  if (!match) return undefined;
  return { kind: match[1] as 'utm' | 'page', value: match[2] as string };
}

export const sourceFilterValue = (kind: 'utm' | 'page', value: string) => `${kind}:${value}`;
