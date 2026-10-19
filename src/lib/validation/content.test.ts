import { describe, expect, it } from 'vitest';
import {
  createDeveloperSchema,
  createPricingSchema,
  createShowcaseSchema,
  reorderSchema,
  siteInfoSchema,
  updatePartnerSchema,
  updatePricingSchema,
  updateShowcaseSchema,
} from './content';

const ID = '65f1c2a4b6d3e8a9c0b1d2e3';

describe('web addresses end up in hrefs, so only http(s) gets in', () => {
  it.each(['javascript:alert(1)', 'data:text/html,<script>1</script>', 'ftp://example.com', 'example.com', 'https://', '//evil.example', 'https://user:pass@example.com'])('rejects %s', (url) => {
    expect(createShowcaseSchema.safeParse({ title: 'Shop', summary: 'A shop', liveUrl: url }).success).toBe(false);
  });
  it('accepts a normal https link and clears on empty', () => {
    expect(createShowcaseSchema.parse({ title: 'Shop', summary: 'A shop', liveUrl: 'https://shop.example.com/x?y=1' }).liveUrl).toBe('https://shop.example.com/x?y=1');
    expect(createShowcaseSchema.parse({ title: 'Shop', summary: 'A shop', liveUrl: '  ' }).liveUrl).toBeNull();
  });
  it('applies to every link field: partner, developer and company info', () => {
    expect(updatePartnerSchema.safeParse({ url: 'javascript:alert(1)' }).success).toBe(false);
    expect(createDeveloperSchema.safeParse({ displayName: 'Dev', links: { github: 'javascript:1' } }).success).toBe(false);
    expect(siteInfoSchema.safeParse({ displayName: 'ProDevly', social: { x: 'javascript:1' } }).success).toBe(false);
  });
});

describe('PATCH semantics: undefined leaves a field, null or empty clears it', () => {
  it('does not invent values for fields the caller did not send (no defaults leak into a partial update)', () => {
    const patch = updateShowcaseSchema.parse({ title: 'New title' });
    expect(Object.keys(patch)).toEqual(['title']);
    expect(Object.keys(updatePricingSchema.parse({ name: 'Pro' }))).toEqual(['name']);
  });
  it('turns null and "" into null (clear), keeping undefined as undefined (leave)', () => {
    const patch = updateShowcaseSchema.parse({ clientDisplayName: '', coverMediaId: null, liveUrl: null, completedOn: '' });
    expect(patch).toEqual({ clientDisplayName: null, coverMediaId: null, liveUrl: null, completedOn: null });
  });
  it('rejects an empty patch and unknown fields', () => {
    expect(updateShowcaseSchema.safeParse({}).success).toBe(false);
    expect(updateShowcaseSchema.safeParse({ title: 'x1', status: 'published' }).success).toBe(false);
    expect(createShowcaseSchema.safeParse({ title: 'Shop', summary: 'A shop', publishedAt: '2026-01-01' }).success).toBe(false);
  });
  it('cannot set status, order or slug from the body: they are not fields', () => {
    for (const bad of [{ status: 'published' }, { order: 3 }, { slug: 'hacked' }, { publishedBy: 'x' }]) {
      expect(createShowcaseSchema.safeParse({ title: 'Shop', summary: 'A shop', ...bad }).success).toBe(false);
    }
  });
});

describe('showcase', () => {
  it('needs a title and a summary', () => {
    const r = createShowcaseSchema.safeParse({});
    expect(r.success).toBe(false);
  });
  it('lowercases ids, merges duplicates and drops blank list entries', () => {
    const v = createShowcaseSchema.parse({
      title: 'Shop',
      summary: 'A shop',
      serviceIds: [ID.toUpperCase(), ID],
      stack: ['React', 'react', '', ' Node '],
    });
    expect(v.serviceIds).toEqual([ID]);
    expect(v.stack).toEqual(['React', 'Node']);
  });
  it('takes a real calendar date or nothing', () => {
    expect(createShowcaseSchema.safeParse({ title: 'Shop', summary: 'A shop', completedOn: '2026-02-30' }).success).toBe(false);
    expect(createShowcaseSchema.parse({ title: 'Shop', summary: 'A shop', completedOn: '2026-02-28' }).completedOn).toBe('2026-02-28');
  });
});

describe('developers', () => {
  it('limits the bio to 280 characters', () => {
    expect(createDeveloperSchema.safeParse({ displayName: 'Dev', bio: 'x'.repeat(281) }).success).toBe(false);
    expect(createDeveloperSchema.safeParse({ displayName: 'Dev', bio: 'x'.repeat(280) }).success).toBe(true);
  });
});

describe('pricing', () => {
  it('takes integer minor units only', () => {
    expect(createPricingSchema.safeParse({ name: 'Pro', priceModel: 'fixed_from', amountMinor: 1999.5, currency: 'INR' }).success).toBe(false);
    expect(createPricingSchema.safeParse({ name: 'Pro', priceModel: 'fixed_from', amountMinor: 0, currency: 'INR' }).success).toBe(false);
    expect(createPricingSchema.safeParse({ name: 'Pro', priceModel: 'fixed_from', amountMinor: -5, currency: 'INR' }).success).toBe(false);
    expect(createPricingSchema.safeParse({ name: 'Pro', priceModel: 'fixed_from', amountMinor: 199_900, currency: 'INR' }).success).toBe(true);
  });
  it('knows only the listed price models and currencies', () => {
    expect(createPricingSchema.safeParse({ name: 'Pro', priceModel: 'free', amountMinor: 1, currency: 'INR' }).success).toBe(false);
    expect(createPricingSchema.safeParse({ name: 'Pro', priceModel: 'quote', currency: 'XXX' }).success).toBe(false);
    expect(createPricingSchema.safeParse({ name: 'Pro', priceModel: 'quote' }).success).toBe(true);
  });
});

describe('company info', () => {
  it('needs a display name, takes a valid email and a plain phone number', () => {
    expect(siteInfoSchema.safeParse({}).success).toBe(false);
    expect(siteInfoSchema.safeParse({ displayName: 'ProDevly', email: 'not-an-email' }).success).toBe(false);
    expect(siteInfoSchema.safeParse({ displayName: 'ProDevly', phone: 'call me maybe' }).success).toBe(false);
    expect(siteInfoSchema.parse({ displayName: 'ProDevly', email: 'HELLO@Example.com', phone: '+91 98765 43210' })).toMatchObject({ email: 'hello@example.com', phone: '+91 98765 43210' });
  });
});

describe('reorder', () => {
  it('needs at least one id, each once', () => {
    expect(reorderSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(reorderSchema.safeParse({ ids: [ID, ID] }).success).toBe(false);
    expect(reorderSchema.safeParse({ ids: [ID, 'not-an-id'] }).success).toBe(false);
    expect(reorderSchema.parse({ ids: [ID.toUpperCase()] }).ids).toEqual([ID]);
  });
});
