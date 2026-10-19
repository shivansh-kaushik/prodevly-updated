/**
 * Splitting an amount of minor units across weights, in whole units, without ever creating or
 * losing a unit. Pure integer maths (BigInt for the products, so a large amount times a large
 * weight cannot leave the safe-integer range). Used by team payouts: a payout is split across
 * the projects the person worked on, and the INR value of each share must add up to at most the
 * payout's INR value, whatever the rounding.
 *
 * Both functions use the largest-remainder method: every share is rounded DOWN first, and the
 * units left over go one each to the shares that lost the most to rounding (ties go to the
 * earlier entry, so the result is deterministic).
 */

const ZERO = BigInt(0);
const ONE = BigInt(1);

function whole(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a whole number of minor units, zero or more`);
  return value;
}

/**
 * Splits `total` across `weights` in proportion to them. The shares add up to exactly `total`
 * whenever any weight is above zero; with all-zero (or no) weights nothing can be split and every
 * share is 0. A weight of 0 never receives anything.
 *
 *   apportion(100, [1, 1, 1])  ->  [34, 33, 33]
 */
export function apportion(total: number, weights: readonly number[]): number[] {
  whole('total', total);
  weights.forEach((w) => whole('weight', w));
  const sum = weights.reduce((s, w) => s + BigInt(w), ZERO);
  if (sum === ZERO) return weights.map(() => 0);

  const bigTotal = BigInt(total);
  const rows = weights.map((w, index) => {
    const product = bigTotal * BigInt(w);
    return { index, share: product / sum, remainder: product % sum, weight: w };
  });
  const left = Number(bigTotal - rows.reduce((s, r) => s + r.share, ZERO));
  const byLoss = [...rows].filter((r) => r.weight > 0).sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  for (let i = 0; i < left; i++) {
    const row = byLoss[i];
    if (row) row.share += ONE;
  }
  return rows.map((r) => Number(r.share));
}

/**
 * The INR value of each allocation of a payout, from the payout's own INR value:
 *
 *   inr_i = amountMinor_i x payoutInr / payoutMinor    (in whole paise, largest remainder)
 *
 * The shares add up to the payout's INR value scaled by how much of the payout is allocated, rounded
 * down: a payout allocated in full has shares that add up to exactly its INR value (nothing is left
 * over as "overhead" by a rounding accident), and a payout allocated in part never exceeds it.
 * Throws when the allocations are more than the payout: that is the caller's rule to report, and
 * this function will not quietly produce numbers for a split that cannot exist.
 */
export function allocationInrShares(payoutMinor: number, payoutInrMinor: number, allocationMinor: readonly number[]): number[] {
  whole('payoutMinor', payoutMinor);
  whole('payoutInrMinor', payoutInrMinor);
  allocationMinor.forEach((a) => whole('allocation', a));
  const allocated = allocationMinor.reduce((s, a) => s + BigInt(a), ZERO);
  if (allocated > BigInt(payoutMinor)) throw new Error('Allocations cannot exceed the payout amount');
  if (payoutMinor === 0) return allocationMinor.map(() => 0);
  const target = Number((BigInt(payoutInrMinor) * allocated) / BigInt(payoutMinor));
  return apportion(target, allocationMinor);
}

export interface WorkedProject {
  projectId: string;
  minutes: number;
}

/**
 * The proposed split of a payout: the whole amount shared across the projects the person logged time
 * on, in proportion to the minutes. Returns the amount in the payout's currency and its INR value
 * for each project, in the order given. With no minutes logged there is nothing to propose and every
 * share is 0 (the payout is then company overhead until someone allocates it by hand).
 */
export function proposeSplit(payoutMinor: number, payoutInrMinor: number, worked: readonly WorkedProject[]): Array<{ projectId: string; amountMinor: number; inrMinor: number }> {
  const amounts = apportion(payoutMinor, worked.map((w) => w.minutes));
  const inr = allocationInrShares(payoutMinor, payoutInrMinor, amounts);
  return worked.map((w, i) => ({ projectId: w.projectId, amountMinor: amounts[i] ?? 0, inrMinor: inr[i] ?? 0 }));
}
