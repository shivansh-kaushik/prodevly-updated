import { describe, expect, it } from 'vitest';
import { PRICING_SECTION } from '@/content/home';
import { priceLine } from '@/lib/price-line';

describe('priceLine', () => {
  it('shows a number only when a plan carries one', () => {
    expect(priceLine({ priceModel: 'quote', price: null })).toBe(PRICING_SECTION.quoted);
    expect(priceLine({ priceModel: 'fixed_from', price: null })).toBe(PRICING_SECTION.quoted);
    expect(priceLine({ priceModel: 'fixed_from', price: { amountMinor: 150000, currency: 'INR' } })).toMatch(/^From .*1,500/);
    expect(priceLine({ priceModel: 'per_month', price: { amountMinor: 250000, currency: 'USD' } })).toMatch(/2,500.* a month$/);
    expect(priceLine({ priceModel: 'per_hour', price: { amountMinor: 5000, currency: 'EUR' } })).toMatch(/50.* an hour$/);
  });
});
