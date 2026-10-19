/**
 * Project margin arithmetic (plan section 4). Pure integer maths on INR minor units (paise):
 * no dates, no database. The only non-integer is the one rounded percentage a person reads.
 *
 * Margin     = Received - Third-party cost - Expense cost - Team cost
 * Margin %   = Margin / Received, only when Received is above zero
 * Projected  = billable total in INR (at the latest rate) - committed costs, where committed
 *              costs are the settled costs plus due payouts, open work-order balances and due
 *              team allocations
 */

export interface MarginParts {
  /** Net of refunds. */
  receivedInr: number;
  thirdPartyInr: number;
  expenseInr: number;
  teamInr: number;
}

export interface Margin extends MarginParts {
  /** Third-party + expense + team. */
  costInr: number;
  marginInr: number;
  /** One decimal (42.5), or null when nothing was received (a ratio over zero means nothing). */
  marginPct: number | null;
}

function whole(name: string, value: number): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a whole number of minor units`);
  return value;
}

/** A ratio as a percentage with one decimal, or null when the denominator is not above zero. */
export function ratioPercent(numerator: number, denominator: number): number | null {
  whole('numerator', numerator);
  whole('denominator', denominator);
  if (!(denominator > 0)) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** Margin divided by received, shown only when received is above zero. A loss gives a negative percentage. */
export function marginPercent(marginInr: number, receivedInr: number): number | null {
  return ratioPercent(marginInr, receivedInr);
}

export function totalCost(parts: Pick<MarginParts, 'thirdPartyInr' | 'expenseInr' | 'teamInr'>): number {
  return whole('thirdPartyInr', parts.thirdPartyInr) + whole('expenseInr', parts.expenseInr) + whole('teamInr', parts.teamInr);
}

export function computeMargin(parts: MarginParts): Margin {
  const receivedInr = whole('receivedInr', parts.receivedInr);
  const costInr = totalCost(parts);
  const marginInr = receivedInr - costInr;
  return { ...parts, costInr, marginInr, marginPct: marginPercent(marginInr, receivedInr) };
}

/** How much of an internal cost budget has been spent, as a percentage. Null when there is no budget. Can pass 100. */
export function budgetUsedPercent(costInr: number, budgetInr: number): number | null {
  return ratioPercent(costInr, budgetInr);
}

export interface BillableContract {
  pricingModel: 'fixed' | 'milestone' | 'hourly' | 'retainer';
  amountMinor: number;
}

/**
 * What the client can be billed in the contract currency. Fixed and milestone projects bill the
 * contract amount. Hourly and retainer projects bill one milestone per invoice, so only milestones
 * marked invoiced or paid count.
 */
export function billableTotalMinor(
  contract: BillableContract,
  milestones: ReadonlyArray<{ amountMinor: number; status: 'pending' | 'invoiced' | 'paid' }>,
): number {
  if (contract.pricingModel === 'fixed' || contract.pricingModel === 'milestone') return whole('amountMinor', contract.amountMinor);
  return milestones.filter((m) => m.status !== 'pending').reduce((sum, m) => sum + whole('amountMinor', m.amountMinor), 0);
}

/** Billable minus received, in the contract currency. Negative means more was received than is billable (an advance). */
export function outstandingMinor(billableMinor: number, receivedContractMinor: number): number {
  return whole('billableMinor', billableMinor) - whole('receivedContractMinor', receivedContractMinor);
}

export interface ProjectedInput {
  /** Billable total converted at the latest table rate. */
  billableInr: number;
  /** Third-party, expense and team cost already paid out. */
  settledCostInr: number;
  dueThirdPartyInr: number;
  /** Agreed minus paid minus due on open work orders, at the latest rate. */
  openWorkOrderInr: number;
  dueTeamInr: number;
}

export interface Projected {
  committedCostInr: number;
  projectedMarginInr: number;
  projectedMarginPct: number | null;
}

export function projectedMargin(input: ProjectedInput): Projected {
  const committedCostInr =
    whole('settledCostInr', input.settledCostInr) +
    whole('dueThirdPartyInr', input.dueThirdPartyInr) +
    whole('openWorkOrderInr', input.openWorkOrderInr) +
    whole('dueTeamInr', input.dueTeamInr);
  const projectedMarginInr = whole('billableInr', input.billableInr) - committedCostInr;
  return { committedCostInr, projectedMarginInr, projectedMarginPct: marginPercent(projectedMarginInr, input.billableInr) };
}
