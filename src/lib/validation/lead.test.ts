import { describe, expect, it } from 'vitest';
import {
  addLeadNoteSchema,
  cleanLine,
  cleanMultiline,
  deleteLeadSchema,
  leadIntakeSchema,
  markSpamSchema,
  normaliseSourcePath,
  parseSourceFilter,
  updateLeadSchema,
} from './lead';

const base = { name: 'Neha Verma', email: 'Neha@Example.com', message: 'We need a customer portal for our business.' };
const parse = (extra: Record<string, unknown> = {}) => leadIntakeSchema.safeParse({ ...base, ...extra });
const ok = (extra: Record<string, unknown> = {}) => {
  const r = parse(extra);
  if (!r.success) throw new Error(JSON.stringify(r.error.issues));
  return r.data;
};

describe('text cleaning', () => {
  it('cleanLine turns breaks into spaces and removes invisible and bidi-override characters', () => {
    expect(cleanLine('  Neha\r\nVerma\t  ')).toBe('Neha Verma');
    const rlo = String.fromCharCode(0x202e);
    const zwsp = String.fromCharCode(0x200b);
    expect(cleanLine(`a${rlo}b${zwsp}c`)).toBe('abc');
    expect(cleanLine('bell\u0007char')).toBe('bellchar');
  });
  it('cleanMultiline keeps line breaks but caps blank runs and removes invisible characters', () => {
    expect(cleanMultiline('one\r\ntwo\n\n\n\n\nthree  \nfour')).toBe('one\ntwo\n\nthree\nfour');
    expect(cleanMultiline(`x${String.fromCharCode(0x2066)}y`)).toBe('xy');
  });
});

describe('normaliseSourcePath', () => {
  it('keeps a path, drops the query string and fragment, and trims a trailing slash', () => {
    expect(normaliseSourcePath('/contact?utm_source=x&token=secret#form')).toBe('/contact');
    expect(normaliseSourcePath('/services/web/')).toBe('/services/web');
    expect(normaliseSourcePath('/')).toBe('/');
  });
  it('drops anything that is not a plain path on this site', () => {
    for (const bad of ['https://evil.example/x', '//evil.example', 'contact', '/a b', '/<script>', '', undefined, null]) {
      expect(normaliseSourcePath(bad), String(bad)).toBeUndefined();
    }
    expect(normaliseSourcePath(`/${'a'.repeat(301)}`)).toBeUndefined();
  });
});

describe('intake schema', () => {
  it('accepts a minimal enquiry and normalises the email', () => {
    const data = ok();
    expect(data).toMatchObject({ name: 'Neha Verma', email: 'neha@example.com', serviceIds: [] });
    expect(data.phone).toBeUndefined();
  });

  it('treats empty optional fields as not given', () => {
    const data = ok({ phone: '', company: '  ', country: null, budgetRange: '', sourcePath: '', utm: null });
    expect(data).toMatchObject({ phone: undefined, company: undefined, country: undefined, budgetRange: undefined, sourcePath: undefined, utm: undefined });
  });

  it('reports field errors a visitor can act on', () => {
    const r = leadIntakeSchema.safeParse({ name: 'N', email: 'nope', message: 'short' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const fields = Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
      expect(fields.name).toBe('Your name is required');
      expect(fields.email).toBe('Enter a valid email address');
      expect(fields.message).toMatch(/at least 10 characters/);
    }
  });

  it('caps the message at 5,000 characters and the name at 120', () => {
    expect(parse({ message: 'x'.repeat(5001) }).success).toBe(false);
    expect(parse({ message: 'x'.repeat(5000) }).success).toBe(true);
    expect(parse({ name: 'n'.repeat(121) }).success).toBe(false);
  });

  it('validates phone numbers loosely but sensibly', () => {
    expect(parse({ phone: '+91 98765-43210' }).success).toBe(true);
    expect(parse({ phone: '(020) 7946 0958' }).success).toBe(true);
    expect(parse({ phone: 'call me maybe' }).success).toBe(false);
    expect(parse({ phone: '12345' }).success).toBe(false);
  });

  it('keeps only well-formed, lowercased, unique service ids and ignores the rest instead of failing', () => {
    const id = 'A'.repeat(24).replace(/A/g, 'a');
    const data = ok({ serviceIds: [id, id.toUpperCase(), 'not-an-id', '', 123] });
    expect(data.serviceIds).toEqual([id]);
    expect(ok({ serviceIds: 'garbage' }).serviceIds).toEqual([]);
  });

  it('lowercases and trims UTM values and drops an empty UTM object', () => {
    expect(ok({ utm: { source: ' Google ', medium: 'CPC', campaign: '' } }).utm).toEqual({ source: 'google', medium: 'cpc', campaign: undefined });
    expect(ok({ utm: { source: '', medium: '', campaign: '' } }).utm).toBeUndefined();
    expect(ok({ utm: 'junk' }).utm).toBeUndefined();
  });

  it('strips unknown keys rather than storing them', () => {
    expect(ok({ isAdmin: true, status: 'won', assignedTo: 'x' })).not.toHaveProperty('status');
  });
});

describe('admin schemas', () => {
  it('update: needs something to change, rejects unknown keys (notes cannot be rewritten through it)', () => {
    expect(updateLeadSchema.safeParse({}).success).toBe(false);
    expect(updateLeadSchema.safeParse({ notes: [] }).success).toBe(false);
    expect(updateLeadSchema.safeParse({ status: 'contacted' }).success).toBe(true);
    expect(updateLeadSchema.safeParse({ status: 'bogus' }).success).toBe(false);
    expect(updateLeadSchema.safeParse({ statusNote: 'why' }).success).toBe(false);
    expect(updateLeadSchema.safeParse({ assignedTo: null }).success).toBe(true);
    expect(updateLeadSchema.safeParse({ assignedTo: 'not-an-id' }).success).toBe(false);
    expect(updateLeadSchema.safeParse({ followUpOn: '2026-10-12' }).success).toBe(true);
    expect(updateLeadSchema.safeParse({ followUpOn: '2026-02-31' }).success).toBe(false);
    expect(updateLeadSchema.safeParse({ followUpOn: null }).success).toBe(true);
  });
  it('note: 1 to 2,000 characters after cleaning', () => {
    expect(addLeadNoteSchema.safeParse({ text: '   ' }).success).toBe(false);
    expect(addLeadNoteSchema.safeParse({ text: 'Called, no answer.' }).success).toBe(true);
    expect(addLeadNoteSchema.safeParse({ text: 'x'.repeat(2001) }).success).toBe(false);
  });
  it('spam and delete', () => {
    expect(markSpamSchema.safeParse({}).success).toBe(true);
    expect(markSpamSchema.safeParse({ note: 'x', extra: 1 }).success).toBe(false);
    expect(deleteLeadSchema.safeParse({}).success).toBe(false);
    expect(deleteLeadSchema.safeParse({ reason: 'ab' }).success).toBe(false);
    expect(deleteLeadSchema.safeParse({ reason: 'Test data' }).success).toBe(true);
  });
});

describe('parseSourceFilter', () => {
  it('reads utm: and page: filters and ignores the rest', () => {
    expect(parseSourceFilter('utm:google')).toEqual({ kind: 'utm', value: 'google' });
    expect(parseSourceFilter('page:/contact')).toEqual({ kind: 'page', value: '/contact' });
    expect(parseSourceFilter('other:x')).toBeUndefined();
    expect(parseSourceFilter('utm:')).toBeUndefined();
    expect(parseSourceFilter(undefined)).toBeUndefined();
  });
});
