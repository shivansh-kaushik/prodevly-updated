import { describe, expect, it } from 'vitest';
import {
  billableTotalMinor,
  budgetUsedPercent,
  computeMargin,
  marginPercent,
  outstandingMinor,
  projectedMargin,
  ratioPercent,
  totalCost,
} from './margin';

describe('marginPercent', () => {
  it('is margin over received, to one decimal', () => {
    expect(marginPercent(4_250_000, 10_000_000)).toBe(42.5);
    expect(marginPercent(1, 3)).toBe(33.3);
    expect(marginPercent(10_000_000, 10_000_000)).toBe(100);
  });

  it('is null when nothing was received, never NaN or Infinity', () => {
    expect(marginPercent(0, 0)).toBeNull();
    expect(marginPercent(-500_000, 0)).toBeNull();
    expect(marginPercent(500_000, -100)).toBeNull();
  });

  it('goes negative on a loss', () => {
    expect(marginPercent(-2_500_000, 10_000_000)).toBe(-25);
  });

  it('refuses a fractional amount: money is whole minor units', () => {
    expect(() => marginPercent(1.5, 100)).toThrow(/whole number/);
    expect(() => marginPercent(100, Number.NaN)).toThrow(/whole number/);
  });
});

describe('computeMargin', () => {
  it('is received minus every cost', () => {
    const m = computeMargin({ receivedInr: 10_000_000, thirdPartyInr: 2_000_000, expenseInr: 500_000, teamInr: 3_000_000 });
    expect(m).toMatchObject({ costInr: 5_500_000, marginInr: 4_500_000, marginPct: 45 });
  });

  it('keeps the inputs on the result', () => {
    const parts = { receivedInr: 100, thirdPartyInr: 10, expenseInr: 20, teamInr: 30 };
    expect(computeMargin(parts)).toMatchObject(parts);
  });

  it('shows costs with no revenue as a negative margin and no percentage', () => {
    const m = computeMargin({ receivedInr: 0, thirdPartyInr: 100_000, expenseInr: 0, teamInr: 50_000 });
    expect(m.marginInr).toBe(-150_000);
    expect(m.marginPct).toBeNull();
  });

  it('is all zeros for nothing', () => {
    expect(computeMargin({ receivedInr: 0, thirdPartyInr: 0, expenseInr: 0, teamInr: 0 })).toMatchObject({ costInr: 0, marginInr: 0, marginPct: null });
  });
});

describe('ratios and budgets', () => {
  it('totalCost adds the three costs', () => {
    expect(totalCost({ thirdPartyInr: 1, expenseInr: 2, teamInr: 3 })).toBe(6);
  });
  it('ratioPercent needs a denominator above zero', () => {
    expect(ratioPercent(5, 0)).toBeNull();
    expect(ratioPercent(1, 8)).toBe(12.5);
  });
  it('budgetUsedPercent can pass 100 and is null without a budget', () => {
    expect(budgetUsedPercent(6_000_000, 5_000_000)).toBe(120);
    expect(budgetUsedPercent(1_000_000, 0)).toBeNull();
  });
});

describe('billable total and outstanding', () => {
  const milestones = [
    { amountMinor: 300_000, status: 'paid' as const },
    { amountMinor: 200_000, status: 'invoiced' as const },
    { amountMinor: 100_000, status: 'pending' as const },
  ];
  it('is the contract amount for fixed and milestone pricing, whatever the milestones say', () => {
    expect(billableTotalMinor({ pricingModel: 'fixed', amountMinor: 900_000 }, milestones)).toBe(900_000);
    expect(billableTotalMinor({ pricingModel: 'milestone', amountMinor: 900_000 }, milestones)).toBe(900_000);
  });
  it('is the invoiced and paid milestones for hourly and retainer pricing', () => {
    expect(billableTotalMinor({ pricingModel: 'hourly', amountMinor: 0 }, milestones)).toBe(500_000);
    expect(billableTotalMinor({ pricingModel: 'retainer', amountMinor: 123 }, milestones)).toBe(500_000);
    expect(billableTotalMinor({ pricingModel: 'hourly', amountMinor: 0 }, [])).toBe(0);
  });
  it('outstanding is billable less received, negative for an advance', () => {
    expect(outstandingMinor(900_000, 300_000)).toBe(600_000);
    expect(outstandingMinor(900_000, 1_000_000)).toBe(-100_000);
  });
});

describe('projectedMargin', () => {
  it('is billable less settled and committed costs', () => {
    const p = projectedMargin({ billableInr: 10_000_000, settledCostInr: 3_000_000, dueThirdPartyInr: 500_000, openWorkOrderInr: 1_000_000, dueTeamInr: 500_000 });
    expect(p).toEqual({ committedCostInr: 5_000_000, projectedMarginInr: 5_000_000, projectedMarginPct: 50 });
  });
  it('has no percentage when nothing is billable', () => {
    const p = projectedMargin({ billableInr: 0, settledCostInr: 100, dueThirdPartyInr: 0, openWorkOrderInr: 0, dueTeamInr: 0 });
    expect(p.projectedMarginInr).toBe(-100);
    expect(p.projectedMarginPct).toBeNull();
  });
});
