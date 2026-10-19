import { describe, expect, it } from 'vitest';
import { createClientSchema, normaliseContacts, updateClientSchema } from './client';

const ok = (v: unknown) => createClientSchema.safeParse(v);

describe('client schema', () => {
  it('needs only a name and fills the defaults', () => {
    const r = ok({ name: '  Brightpath Learning ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ name: 'Brightpath Learning', kind: 'company', status: 'prospect', contacts: [], tags: [] });
  });
  it('checks the GSTIN length, country code and currency, and uppercases them', () => {
    const r = ok({ name: 'Acme', gstin: ' 22abcde1234f1z5 ', country: 'in', billingCurrency: 'usd' });
    expect(r.success && r.data).toMatchObject({ gstin: '22ABCDE1234F1Z5', country: 'IN', billingCurrency: 'USD' });
    expect(ok({ name: 'Acme', gstin: 'SHORT' }).success).toBe(false);
    expect(ok({ name: 'Acme', country: 'India' }).success).toBe(false);
    expect(ok({ name: 'Acme', billingCurrency: 'XXX' }).success).toBe(false);
    expect(ok({ name: 'Acme', gstin: '' }).success).toBe(true); // empty clears
  });
  it('refuses a website that is not http(s)', () => {
    expect(ok({ name: 'Acme', website: 'javascript:alert(1)' }).success).toBe(false);
    expect(ok({ name: 'Acme', website: 'acme.com' }).success).toBe(false);
    expect(ok({ name: 'Acme', website: 'https://acme.com' }).success).toBe(true);
  });
  it('is strict: unknown fields, including isInternal, are rejected', () => {
    expect(ok({ name: 'Acme', isInternal: true }).success).toBe(false);
    expect(updateClientSchema.safeParse({}).success).toBe(false);
    expect(updateClientSchema.safeParse({ isInternal: true }).success).toBe(false);
    expect(updateClientSchema.safeParse({ notes: 'x' }).success).toBe(true);
  });
  it('bounds contacts and validates their email', () => {
    expect(ok({ name: 'Acme', contacts: [{ name: 'A', email: 'not-an-email', isPrimary: true }] }).success).toBe(false);
    expect(ok({ name: 'Acme', contacts: [{ name: 'A', email: 'A@Example.com', isPrimary: true }] }).success).toBe(true);
    expect(ok({ name: 'Acme', contacts: Array.from({ length: 21 }, () => ({ name: 'A', isPrimary: false })) }).success).toBe(false);
  });
});

describe('normaliseContacts', () => {
  const c = (name: string, isPrimary = false) => ({ name, isPrimary });
  it('makes the first contact primary when none is', () => {
    expect(normaliseContacts([c('A'), c('B')]).contacts.map((x) => x.isPrimary)).toEqual([true, false]);
  });
  it('keeps the one flagged primary and refuses several', () => {
    expect(normaliseContacts([c('A'), c('B', true)]).contacts.map((x) => x.isPrimary)).toEqual([false, true]);
    expect(normaliseContacts([c('A', true), c('B', true)]).error).toMatch(/Only one/);
    expect(normaliseContacts([])).toEqual({ contacts: [] });
  });
});
