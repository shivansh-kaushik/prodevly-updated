import { describe, expect, it } from 'vitest';
import { blockersOf, developerGate, partnerGate, pricingGate, serviceGate, showcaseGate } from './gates';

describe('publish gates', () => {
  it('a showcase item needs the client to have approved it', () => {
    expect(showcaseGate({ clientApproved: false })).toHaveProperty('clientApproved');
    expect(showcaseGate({})).toHaveProperty('clientApproved');
    expect(showcaseGate({ clientApproved: true })).toEqual({});
  });

  it('a partner needs permission', () => {
    expect(partnerGate({ permissionConfirmed: false })).toHaveProperty('permissionConfirmed');
    expect(partnerGate({ permissionConfirmed: true })).toEqual({});
  });

  it('a developer profile needs consent and a bio of at most 280 characters', () => {
    expect(developerGate({ consentConfirmed: false })).toHaveProperty('consentConfirmed');
    expect(developerGate({ consentConfirmed: true, bio: 'x'.repeat(280) })).toEqual({});
    expect(developerGate({ consentConfirmed: true, bio: 'x'.repeat(281) })).toHaveProperty('bio');
    expect(Object.keys(developerGate({ consentConfirmed: false, bio: 'x'.repeat(300) })).sort()).toEqual(['bio', 'consentConfirmed']);
  });

  it('a priced plan needs an amount and a currency; a quote plan needs neither', () => {
    expect(pricingGate({ priceModel: 'fixed_from' })).toEqual(expect.objectContaining({ amountMinor: expect.any(String), currency: expect.any(String) }));
    expect(pricingGate({ priceModel: 'per_month', amountMinor: 0, currency: 'INR' })).toHaveProperty('amountMinor');
    expect(pricingGate({ priceModel: 'per_hour', amountMinor: 50_000 })).toHaveProperty('currency');
    expect(pricingGate({ priceModel: 'per_month', amountMinor: 50_000, currency: 'INR' })).toEqual({});
    expect(pricingGate({ priceModel: 'quote' })).toEqual({});
  });

  it('a service has no tick', () => {
    expect(serviceGate()).toEqual({});
  });

  it('lists blockers as plain sentences', () => {
    expect(blockersOf({ a: 'First', b: 'Second' })).toEqual(['First', 'Second']);
  });
});
