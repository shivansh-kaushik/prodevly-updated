import { describe, expect, it } from 'vitest';
import { GRANTABLE } from './capabilities';
import { ALL_PRESENTED, GRANT_MODULES, grantsFromChoices, moduleLevel } from './grants-ui';

describe('grants form', () => {
  it('presents every grantable capability exactly once, and nothing that is not grantable', () => {
    expect([...ALL_PRESENTED].sort()).toEqual([...GRANTABLE].sort());
    expect(new Set(ALL_PRESENTED).size).toBe(ALL_PRESENTED.length);
  });
  it('round-trips choices', () => {
    const grants = grantsFromChoices({ payments: 'record', payouts: 'view', expenses: 'none' }, ['content:publish']);
    expect(grants).toEqual(['payment:record', 'payout:view', 'content:publish']);
    const payments = GRANT_MODULES.find((m) => m.key === 'payments')!;
    expect(moduleLevel(payments, grants)).toBe('record');
    expect(moduleLevel(GRANT_MODULES.find((m) => m.key === 'expenses')!, grants)).toBe('none');
    expect(moduleLevel(GRANT_MODULES.find((m) => m.key === 'payouts')!, grants)).toBe('view');
  });
});
