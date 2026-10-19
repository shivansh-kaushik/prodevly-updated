import { describe, expect, it } from 'vitest';
import { toInrMinor } from '@/lib/money/fx';
import { checkDue, contractEquivalentFromInr, exceedsMessage, nextMilestoneStatus, sayMoney, signed } from './client-payment.rules';

describe('contractEquivalentFromInr', () => {
  it('is the mirror of toInrMinor: USD 1,000.00 at 83.42 is 8,342,000 paise and back', () => {
    expect(toInrMinor(100_000, 'USD', 83.42)).toBe(8_342_000);
    expect(contractEquivalentFromInr(8_342_000, 'USD', 83.42)).toBe(100_000);
  });

  it('respects the contract currency minor unit: no decimals for JPY, three for KWD', () => {
    expect(contractEquivalentFromInr(10_000, 'JPY', 0.55)).toBe(182); // INR 100.00 at 0.55 INR per yen
    expect(contractEquivalentFromInr(30_000, 'KWD', 270)).toBe(1_111); // INR 300.00 at 270 INR per dinar = KWD 1.111
  });

  it('is the identity for INR at rate 1, and rounds half up', () => {
    expect(contractEquivalentFromInr(123_456, 'INR', 1)).toBe(123_456);
    expect(contractEquivalentFromInr(1, 'USD', 50)).toBe(0); // INR 0.01 is less than a cent
    expect(contractEquivalentFromInr(150, 'USD', 100)).toBe(2); // 1.5 cents rounds up
    expect(contractEquivalentFromInr(149, 'USD', 100)).toBe(1);
  });

  it('gives null for a rate that cannot be used and for an INR value that is not whole', () => {
    expect(contractEquivalentFromInr(100, 'USD', 0)).toBeNull();
    expect(contractEquivalentFromInr(100, 'USD', -1)).toBeNull();
    expect(contractEquivalentFromInr(1.5, 'USD', 83)).toBeNull();
    expect(contractEquivalentFromInr(-5, 'USD', 83)).toBeNull();
  });
});

describe('nextMilestoneStatus', () => {
  it('marks a milestone paid when the money reaches it, from invoiced or pending', () => {
    expect(nextMilestoneStatus('invoiced', 100, 0, 100)).toBe('paid');
    expect(nextMilestoneStatus('pending', 100, 60, 120)).toBe('paid');
    expect(nextMilestoneStatus('invoiced', 100, 0, 99)).toBeNull();
  });

  it('puts a paid milestone back to invoiced only when it WAS covered and no longer is', () => {
    expect(nextMilestoneStatus('paid', 100, 100, 60)).toBe('invoiced');
    expect(nextMilestoneStatus('paid', 100, 0, 60)).toBeNull(); // paid by hand, never covered by payments
    expect(nextMilestoneStatus('paid', 100, 100, 100)).toBeNull();
    expect(nextMilestoneStatus('invoiced', 100, 100, 60)).toBeNull();
  });

  it('ignores a milestone with no amount', () => {
    expect(nextMilestoneStatus('invoiced', 0, 0, 50)).toBeNull();
  });
});

describe('checkDue', () => {
  it('adds the signed contribution to what the others received', () => {
    expect(checkDue({ receivedOthersMinor: 60, contributionMinor: 40, billableMinor: 100 })).toEqual({ afterMinor: 100, exceeds: false, excessMinor: 0, negative: false });
    expect(checkDue({ receivedOthersMinor: 60, contributionMinor: 41, billableMinor: 100 })).toMatchObject({ exceeds: true, excessMinor: 1 });
    expect(checkDue({ receivedOthersMinor: 10, contributionMinor: signed('refund', 30), billableMinor: 100 })).toMatchObject({ negative: true, afterMinor: -20 });
  });

  it('says what would be received and what is billable, and who can allow it', () => {
    const due = checkDue({ receivedOthersMinor: 60_000, contributionMinor: 50_000, billableMinor: 100_000 });
    expect(exceedsMessage(due, 100_000, 'USD', false)).toBe('That takes the total received to USD 1,100.00, which is USD 100.00 more than the USD 1,000.00 billable on this project. A superadmin can record it as an advance.');
    expect(exceedsMessage(due, 100_000, 'USD', true)).toContain('Tick "Record as advance"');
    expect(exceedsMessage(checkDue({ receivedOthersMinor: 0, contributionMinor: 5, billableMinor: 0 }), 0, 'INR', false)).toMatch(/^Nothing is billable/);
  });
});

describe('sayMoney', () => {
  it('puts the code first so no symbol is misread', () => {
    expect(sayMoney(123_456_700, 'INR')).toBe('INR 12,34,567.00');
    expect(sayMoney(100_000, 'USD')).toBe('USD 1,000.00');
  });
});
