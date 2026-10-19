import { describe, expect, it } from 'vitest';
import { createClientSchema } from './client';
import { createProjectSchema } from './project';
import {
  buildClientInput,
  buildProjectInput,
  clientNameFromLead,
  convertLeadSchema,
  countryCodeFromText,
  prefillClient,
  prefillProject,
  scopeFromMessage,
  type LeadSource,
} from './lead-conversion';

const ID = '5f3a5f3a5f3a5f3a5f3a5f3a';
const lead = (o: Partial<LeadSource> = {}): LeadSource => ({
  name: 'Neha Verma',
  company: null,
  email: 'neha@example.com',
  phone: null,
  country: null,
  message: 'We need a customer portal for our logistics business.',
  ...o,
});
const parse = (v: unknown) => convertLeadSchema.safeParse(v);
const fieldsOf = (v: unknown) => {
  const r = parse(v);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
};

describe('convert body', () => {
  it('accepts a new client with nothing else, because the service falls back to the prefill', () => {
    expect(parse({ mode: 'new' }).success).toBe(true);
  });

  it('accepts a new client with edits and a draft project, trimming and uppercasing', () => {
    const r = parse({ mode: 'new', client: { name: '  Acme Logistics ', kind: 'company', country: 'in', billingCurrency: 'usd' }, project: { name: ' Portal ', type: 'web_app' } });
    expect(r.success && r.data).toMatchObject({
      mode: 'new',
      client: { name: 'Acme Logistics', kind: 'company', country: 'IN', billingCurrency: 'USD' },
      project: { name: 'Portal', type: 'web_app' },
    });
  });

  it('does not default the kind to company: an omitted kind is left for the enquiry to decide', () => {
    const r = parse({ mode: 'new', client: { name: 'Neha Verma' } });
    expect(r.success && r.data.mode === 'new' && r.data.client).toEqual({ name: 'Neha Verma' });
  });

  it('accepts an existing client, with the project null or left out', () => {
    expect(parse({ mode: 'existing', clientId: ID }).success).toBe(true);
    expect(parse({ mode: 'existing', clientId: ID, project: null }).success).toBe(true);
    expect(parse({ mode: 'existing', clientId: ID.toUpperCase() }).success).toBe(true);
  });

  it('needs a client id in existing mode, and says so on the right field', () => {
    expect(fieldsOf({ mode: 'existing' })).toEqual({ clientId: 'Pick a client' });
    expect(fieldsOf({ mode: 'existing', clientId: 'nope' })).toEqual({ clientId: 'Pick a client' });
  });

  it('refuses a missing or unknown mode with a message for the mode field', () => {
    expect(fieldsOf({})).toHaveProperty('mode');
    expect(fieldsOf({ mode: 'merge' })).toHaveProperty('mode');
    expect(fieldsOf({ mode: 'merge' }).mode).toMatch(/new client or an existing one/);
  });

  it('does not let one mode carry the other mode\'s fields', () => {
    expect(parse({ mode: 'new', clientId: ID }).success).toBe(false);
    expect(parse({ mode: 'existing', clientId: ID, client: { name: 'Acme' } }).success).toBe(false);
  });

  it('is strict everywhere: unknown keys are refused, so nothing can set status, owner or money', () => {
    for (const extra of [{ status: 'won' }, { isInternal: true }, { convertedClientId: ID }, { leadId: ID }]) {
      expect(parse({ mode: 'new', ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
    for (const client of [{ name: 'Acme', status: 'active' }, { name: 'Acme', isInternal: true }, { name: 'Acme', gstin: '22ABCDE1234F1Z5' }, { name: 'Acme', accountOwnerId: ID }]) {
      expect(parse({ mode: 'new', client }).success, JSON.stringify(client)).toBe(false);
    }
    for (const project of [{ name: 'Portal', type: 'web_app', status: 'active' }, { name: 'Portal', type: 'web_app', contract: { pricingModel: 'fixed', amountMinor: 1, currency: 'INR' } }, { name: 'Portal', type: 'web_app', clientId: ID }]) {
      expect(parse({ mode: 'new', project }).success, JSON.stringify(project)).toBe(false);
    }
  });

  it('applies the client and project modules\' own field rules', () => {
    expect(fieldsOf({ mode: 'new', client: { name: 'A' } })).toHaveProperty('client.name');
    expect(fieldsOf({ mode: 'new', client: { name: 'Acme', kind: 'charity' } })).toHaveProperty('client.kind');
    expect(fieldsOf({ mode: 'new', client: { name: 'Acme', country: 'India' } })).toHaveProperty('client.country');
    expect(fieldsOf({ mode: 'new', client: { name: 'Acme', billingCurrency: 'XXX' } })).toHaveProperty('client.billingCurrency');
    expect(fieldsOf({ mode: 'new', project: { name: 'P', type: 'web_app' } })).toHaveProperty('project.name');
    expect(fieldsOf({ mode: 'new', project: { name: 'Portal', type: 'rocket' } })).toHaveProperty('project.type');
    expect(fieldsOf({ mode: 'new', project: { name: 'Portal' } })).toHaveProperty('project.type');
    expect(fieldsOf({ mode: 'new', project: { name: 'x'.repeat(141), type: 'saas' } })).toHaveProperty('project.name');
  });
});

describe('country from free text', () => {
  it('reads a code, a name, and the shorthand people type', () => {
    expect(countryCodeFromText('IN')).toBe('IN');
    expect(countryCodeFromText('in')).toBe('IN');
    expect(countryCodeFromText('India')).toBe('IN');
    expect(countryCodeFromText('  united  states ')).toBe('US');
    expect(countryCodeFromText('United Kingdom')).toBe('GB');
    expect(countryCodeFromText('UK')).toBe('GB');
    expect(countryCodeFromText('U.S.A.')).toBe('US');
    expect(countryCodeFromText('the Netherlands')).toBe('NL');
  });
  it('returns an empty string rather than guess', () => {
    for (const text of ['', '   ', null, undefined, 'Narnia', 'XX', 'EU', 'ZZ', 'Greater Mumbai Area']) expect(countryCodeFromText(text), String(text)).toBe('');
  });
});

describe('prefill mapping', () => {
  it('names a company enquiry after the company and an individual after the person', () => {
    expect(prefillClient(lead({ company: ' Acme Logistics ' }))).toMatchObject({ name: 'Acme Logistics', kind: 'company' });
    expect(prefillClient(lead())).toMatchObject({ name: 'Neha Verma', kind: 'individual' });
    expect(prefillClient(lead({ company: '   ' }))).toMatchObject({ name: 'Neha Verma', kind: 'individual' });
    expect(clientNameFromLead({ name: 'N'.repeat(200), company: null })).toHaveLength(120);
  });

  it('turns the enquirer into the main contact, with email and phone', () => {
    const p = prefillClient(lead({ phone: '+91 98765 43210', country: 'India' }));
    expect(p.contact).toEqual({ name: 'Neha Verma', email: 'neha@example.com', phone: '+91 98765 43210' });
    expect(p.country).toBe('IN');
    expect(p.notes).toBe('');
  });

  it('keeps a phone number the contact record cannot hold in the notes instead of cutting it', () => {
    const long = '+91 (0) 98765-43210 ext. 12345678';
    expect(long.length).toBeGreaterThan(30);
    const p = prefillClient(lead({ phone: long }));
    expect(p.contact.phone).toBe('');
    expect(p.notes).toBe(`Phone from the enquiry: ${long}`);
  });

  it('suggests a project name from the client name, without choosing a type', () => {
    expect(prefillProject(lead({ company: 'Acme Logistics' }))).toEqual({ name: 'Acme Logistics project' });
    expect(Object.keys(prefillProject(lead()))).toEqual(['name']);
  });

  it('uses the enquiry message as the scope, cut to the project limit with a mark that it was cut', () => {
    expect(scopeFromMessage('  A short brief.  ')).toBe('A short brief.');
    const cut = scopeFromMessage('x'.repeat(4500));
    expect(cut).toHaveLength(4000);
    expect(cut.endsWith('...')).toBe(true);
  });
});

describe('what the create schemas are given', () => {
  it('builds a client the Clients schema accepts, from the enquiry alone', () => {
    const parsed = createClientSchema.parse(buildClientInput(lead({ company: 'Acme Logistics', phone: '+91 98765 43210', country: 'in' })));
    expect(parsed).toMatchObject({
      name: 'Acme Logistics',
      kind: 'company',
      status: 'prospect',
      country: 'IN',
      contacts: [{ name: 'Neha Verma', email: 'neha@example.com', phone: '+91 98765 43210', isPrimary: true }],
    });
    expect(parsed.billingCurrency).toBeUndefined();
  });

  it('lets the person\'s edits win, including clearing the country', () => {
    const parsed = createClientSchema.parse(
      buildClientInput(lead({ company: 'Acme', country: 'India' }), { name: 'Acme Logistics Pvt Ltd', kind: 'individual', country: '', billingCurrency: 'USD' }),
    );
    expect(parsed).toMatchObject({ name: 'Acme Logistics Pvt Ltd', kind: 'individual', billingCurrency: 'USD' });
    expect(parsed.country).toBe('');
  });

  it('builds a proposal project with the message as scope that the Projects schema accepts', () => {
    const parsed = createProjectSchema.parse(buildProjectInput(lead(), ID, { name: 'Portal', type: 'web_app' }));
    expect(parsed).toMatchObject({ clientId: ID, name: 'Portal', type: 'web_app', status: 'proposal', scopeSummary: 'We need a customer portal for our logistics business.' });
  });
});
