import { describe, expect, it } from 'vitest';
import { humanize } from './format';

describe('humanize', () => {
  it('turns codes and camelCase into a sentence-case label', () => {
    expect(humanize('in_progress')).toBe('In progress');
    expect(humanize('bank_transfer')).toBe('Bank transfer');
    expect(humanize('proposalSent')).toBe('Proposal sent');
    expect(humanize('  third_party  ')).toBe('Third party');
    expect(humanize('')).toBe('');
  });

  it('spells payment modes and brands the way people write them', () => {
    expect(humanize('upi')).toBe('UPI');
    expect(humanize('paypal')).toBe('PayPal');
    expect(humanize('wise')).toBe('Wise');
    expect(humanize('payoneer')).toBe('Payoneer');
  });

  it('keeps tax and FX acronyms in capitals', () => {
    expect(humanize('tds')).toBe('TDS');
    expect(humanize('gst')).toBe('GST');
    expect(humanize('gstin')).toBe('GSTIN');
    expect(humanize('fx')).toBe('FX');
    expect(humanize('inr')).toBe('INR');
    expect(humanize('ecb')).toBe('ECB');
  });

  it('fixes a known word wherever it sits in the label', () => {
    expect(humanize('fx_rate')).toBe('FX rate');
    expect(humanize('fxRate')).toBe('FX rate');
    expect(humanize('inrMinor')).toBe('INR minor');
    expect(humanize('payment_by_upi')).toBe('Payment by UPI');
    expect(humanize('tds_and_gst')).toBe('TDS and GST');
    expect(humanize('UPI')).toBe('UPI');
    expect(humanize('PAYPAL')).toBe('PayPal');
  });

  it('matches whole words only', () => {
    expect(humanize('wisely')).toBe('Wisely');
    expect(humanize('upis')).toBe('Upis');
    expect(humanize('gstinfo')).toBe('Gstinfo');
  });

  it('is safe on words that are also names on every object', () => {
    expect(humanize('constructor')).toBe('Constructor');
    expect(humanize('__proto__')).toBe('Proto');
    expect(humanize('toString')).toBe('To string');
  });

  it('leaves the first word lower case for running text when asked', () => {
    expect(humanize('mark_paid', false)).toBe('mark paid');
    expect(humanize('some_new_thing', false)).toBe('some new thing');
    // known words keep their own spelling even then
    expect(humanize('fx_rates', false)).toBe('FX rates');
    expect(humanize('paypal_fees', false)).toBe('PayPal fees');
  });
});
