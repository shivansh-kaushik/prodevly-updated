import { PRICING_SECTION } from '@/content/home';
import type { PublicPricingPlan } from '@/lib/content/types';
import { formatMinor } from '@/lib/money/minor';

/** "From ₹X", "₹X a month", "₹X an hour", or the quoted line: only numbers somebody typed into a record. */
export function priceLine(plan: Pick<PublicPricingPlan, 'priceModel' | 'price'>): string {
  if (plan.priceModel === 'quote' || !plan.price) return PRICING_SECTION.quoted;
  const amount = formatMinor(plan.price.amountMinor, plan.price.currency);
  if (plan.priceModel === 'per_month') return `${amount} a month`;
  if (plan.priceModel === 'per_hour') return `${amount} an hour`;
  return `From ${amount}`;
}
