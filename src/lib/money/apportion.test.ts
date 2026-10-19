import { describe, expect, it } from 'vitest';
import { allocationInrShares, apportion, proposeSplit } from './apportion';

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

describe('apportion', () => {
  it('splits an odd amount three ways without losing a unit, the extra going to the earliest', () => {
    expect(apportion(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(apportion(101, [1, 1, 1])).toEqual([34, 34, 33]);
    expect(apportion(1, [1, 1, 1])).toEqual([1, 0, 0]);
  });

  it('follows the weights, and the leftover goes to the share that lost the most', () => {
    expect(apportion(10, [1, 2, 3])).toEqual([2, 3, 5]); // 1.67, 3.33, 5 -> floors 1, 3, 5 then +1 to the biggest loss
    expect(apportion(100, [7, 1, 1, 1])).toEqual([70, 10, 10, 10]);
    expect(sum(apportion(1_000_003, [3, 5, 7, 11, 13]))).toBe(1_000_003);
  });

  it('gives a zero weight nothing, and nothing at all when every weight is zero', () => {
    expect(apportion(100, [0, 1, 0])).toEqual([0, 100, 0]);
    expect(apportion(100, [0, 0])).toEqual([0, 0]);
    expect(apportion(100, [])).toEqual([]);
    expect(apportion(0, [3, 4])).toEqual([0, 0]);
  });

  it('survives amounts whose product with a weight leaves the safe-integer range', () => {
    const total = 1_000_000_000_000; // INR 10 billion in paise
    const shares = apportion(total, [999_999_999_999, 1, 7]);
    expect(sum(shares)).toBe(total);
    expect(shares.every(Number.isSafeInteger)).toBe(true);
  });

  it('refuses fractions and negatives: money is whole minor units', () => {
    expect(() => apportion(10.5, [1])).toThrow();
    expect(() => apportion(-1, [1])).toThrow();
    expect(() => apportion(10, [1, -1])).toThrow();
    expect(() => apportion(10, [1.5])).toThrow();
  });

  it('never exceeds the total, for a spread of awkward inputs', () => {
    for (const total of [1, 2, 3, 7, 99, 100, 101, 12_345, 99_999_999]) {
      for (const weights of [[1], [1, 1], [1, 1, 1], [1, 2, 3, 4, 5, 6, 7], [3, 3, 3, 1], [1, 0, 1], [999, 1]]) {
        const shares = apportion(total, weights);
        expect(sum(shares), `${total} over ${weights}`).toBe(total);
        shares.forEach((s) => expect(s).toBeGreaterThanOrEqual(0));
      }
    }
  });
});

describe('allocationInrShares', () => {
  it('shares equal the allocations for an INR payout', () => {
    expect(allocationInrShares(100_000, 100_000, [60_000, 40_000])).toEqual([60_000, 40_000]);
    expect(allocationInrShares(100_000, 100_000, [10_001, 20_003])).toEqual([10_001, 20_003]);
  });

  it('a foreign payout allocated in full adds up to exactly its INR value, however the rounding falls', () => {
    // USD 100.01 at 83.4167 -> INR value is a fixed integer; three allocations of an odd amount
    const payoutMinor = 10_001;
    const inr = 834_237;
    const parts = [3_334, 3_334, 3_333];
    const shares = allocationInrShares(payoutMinor, inr, parts);
    expect(sum(shares)).toBe(inr);
    shares.forEach((s) => expect(s).toBeGreaterThan(0));
  });

  it('an allocation of part of the payout never exceeds the INR value of that part', () => {
    const shares = allocationInrShares(10_000, 833_333, [3_333, 3_333]);
    expect(sum(shares)).toBeLessThanOrEqual(833_333);
    expect(sum(shares)).toBe(Math.floor((833_333 * 6_666) / 10_000));
  });

  it('is empty-safe', () => {
    expect(allocationInrShares(10_000, 833_333, [])).toEqual([]);
    expect(allocationInrShares(10_000, 833_333, [0, 0])).toEqual([0, 0]);
  });

  it('refuses allocations larger than the payout', () => {
    expect(() => allocationInrShares(100, 100, [60, 41])).toThrow(/cannot exceed/);
  });

  it('never exceeds the payout in INR across many awkward splits (property check)', () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    for (let round = 0; round < 300; round++) {
      const payoutMinor = 1 + rand(5_000_000);
      const inr = 1 + rand(900_000_000);
      const k = 1 + rand(6);
      const weights = Array.from({ length: k }, () => 1 + rand(100));
      // allocate between 0 and all of the payout
      const part = rand(payoutMinor + 1);
      const parts = apportion(part, weights);
      const shares = allocationInrShares(payoutMinor, inr, parts);
      expect(sum(parts)).toBeLessThanOrEqual(payoutMinor);
      expect(sum(shares)).toBeLessThanOrEqual(inr);
      if (part === payoutMinor) expect(sum(shares)).toBe(inr);
    }
  });
});

describe('proposeSplit', () => {
  it('shares the whole payout in proportion to the minutes, and the INR to match', () => {
    const split = proposeSplit(1_000_000, 1_000_000, [
      { projectId: 'a', minutes: 600 },
      { projectId: 'b', minutes: 300 },
      { projectId: 'c', minutes: 100 },
    ]);
    expect(split.map((s) => s.amountMinor)).toEqual([600_000, 300_000, 100_000]);
    expect(split.map((s) => s.inrMinor)).toEqual([600_000, 300_000, 100_000]);
  });

  it('a three-way split of an odd amount keeps the sum exact in both currencies', () => {
    const split = proposeSplit(100_001, 8_341_583, [
      { projectId: 'a', minutes: 60 },
      { projectId: 'b', minutes: 60 },
      { projectId: 'c', minutes: 60 },
    ]);
    expect(sum(split.map((s) => s.amountMinor))).toBe(100_001);
    expect(sum(split.map((s) => s.inrMinor))).toBe(8_341_583);
  });

  it('proposes nothing when no time was logged', () => {
    expect(proposeSplit(100, 100, [])).toEqual([]);
    expect(proposeSplit(100, 100, [{ projectId: 'a', minutes: 0 }])).toEqual([{ projectId: 'a', amountMinor: 0, inrMinor: 0 }]);
  });
});
