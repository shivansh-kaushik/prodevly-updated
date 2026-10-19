import { formatCoded } from '@/components/admin/fx-field-model';
import { currencyDigits } from '@/config/currencies';

/**
 * The money rules of client payments that need no database (plan section 4). Pure integer maths on
 * minor units, so the service's rules are tested directly and read in one place.
 */

export type PaymentType = 'receipt' | 'refund';
export type MilestoneStatus = 'pending' | 'invoiced' | 'paid';

const MICRO = BigInt(1_000_000);

/**
 * What an INR value comes to in the project's contract currency, from that currency's rate (INR per 1
 * unit): contractMinor = inrMinor x 10^(digits - 2) / rate, rounded half up, in exact integer arithmetic
 * (the mirror of `toInrMinor`). USD 1,000.00 at 83.42 is 8,342,000 paise, so 8,342,000 gives 100,000 cents.
 * Null when the rate is unusable or the answer is not a safe integer.
 */
export function contractEquivalentFromInr(inrMinor: number, contractCurrency: string, rate: number): number | null {
  if (!Number.isSafeInteger(inrMinor) || inrMinor < 0) return null;
  const rateMicro = BigInt(Math.round(rate * 1_000_000));
  if (rateMicro <= BigInt(0)) return null;
  const digits = currencyDigits(contractCurrency);
  // inr/100 rupees, over the rate, times 10^digits minor units, with the rate held as micro-units.
  const numerator = BigInt(inrMinor) * BigInt(10) ** BigInt(digits) * MICRO;
  const denominator = BigInt(100) * rateMicro;
  const value = Number((numerator * BigInt(2) + denominator) / (denominator * BigInt(2)));
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * The aggregation expression for the same thing on stored entries: a refund counts against what was received,
 * in the contract currency. Built from literals only, so it is safe inside a pipeline.
 */
export const SIGNED_CONTRACT = {
  $cond: [{ $eq: ['$type', 'refund'] }, { $multiply: ['$contractEquivalentMinor', -1] }, '$contractEquivalentMinor'],
};

/** A refund counts against what was received. */
export const signed = (type: PaymentType, contractEquivalentMinor: number): number => (type === 'refund' ? -contractEquivalentMinor : contractEquivalentMinor);

/** An amount for a sentence, code first so no symbol can be misread: "USD 1,000.00", "INR 1,00,000.00". */
export const sayMoney = (amountMinor: number, currency: string): string => formatCoded(amountMinor, currency);

/**
 * The status a milestone should take now that the money linked to it moved from `beforeMinor` to
 * `afterMinor` (net of refunds, in the contract currency), or null to leave it alone.
 *
 * It moves on CHANGE, not on level: a milestone someone marked paid by hand that has only a part-payment
 * linked is left alone, and only a milestone that WAS covered and no longer is goes back to invoiced.
 */
export function nextMilestoneStatus(current: MilestoneStatus, amountMinor: number, beforeMinor: number, afterMinor: number): MilestoneStatus | null {
  if (!(amountMinor > 0)) return null;
  const covered = afterMinor >= amountMinor;
  const wasCovered = beforeMinor >= amountMinor;
  if (covered && current !== 'paid') return 'paid';
  if (!covered && wasCovered && current === 'paid') return 'invoiced';
  return null;
}

export interface DueCheck {
  /** Net received toward the contract by every OTHER received payment, contract currency. */
  receivedOthersMinor: number;
  /** This payment's own signed contribution (negative for a refund). */
  contributionMinor: number;
  billableMinor: number;
}

export interface DueResult {
  /** Net received after this payment. */
  afterMinor: number;
  /** More received than billable. */
  exceeds: boolean;
  excessMinor: number;
  /** A refund (or an edit) that would leave less than nothing received. */
  negative: boolean;
}

export function checkDue(c: DueCheck): DueResult {
  const afterMinor = c.receivedOthersMinor + c.contributionMinor;
  const excessMinor = Math.max(0, afterMinor - c.billableMinor);
  return { afterMinor, exceeds: afterMinor > c.billableMinor, excessMinor, negative: afterMinor < 0 };
}

/** The sentence behind PAYMENT_EXCEEDS_DUE: what would be received, what is billable, and the way out. */
export function exceedsMessage(result: DueResult, billableMinor: number, currency: string, canAdvance: boolean): string {
  if (billableMinor <= 0) {
    return `Nothing is billable on this project yet. Set the contract amount, or add an invoiced milestone, first.${canAdvance ? ' Or tick "Record as advance".' : ' Or ask a superadmin to record it as an advance.'}`;
  }
  return `That takes the total received to ${sayMoney(result.afterMinor, currency)}, which is ${sayMoney(result.excessMinor, currency)} more than the ${sayMoney(billableMinor, currency)} billable on this project.${canAdvance ? ' Tick "Record as advance" if it was paid early.' : ' A superadmin can record it as an advance.'}`;
}
