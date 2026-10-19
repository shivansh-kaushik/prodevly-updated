import { minorToDecimal, parseMinor } from '@/lib/money/minor';
import type { MoneyValue } from '@/components/admin/money-input';
import type { ContractShape, PricingModelKey } from './types';

/** The contract part of the project form while it is being typed: amounts stay text until submit. */
export interface ContractValue {
  pricingModel: PricingModelKey;
  /** The contract value and its currency. */
  amount: MoneyValue;
  hourlyRate: string;
  retainerMonthly: string;
  /** Internal cost budget in rupees. */
  costBudget: string;
}

export function emptyContract(currency = 'INR'): ContractValue {
  return { pricingModel: 'fixed', amount: { amount: '', currency }, hourlyRate: '', retainerMonthly: '', costBudget: '' };
}

export function contractToValue(contract: ContractShape, costBudgetInrMinor: number | null): ContractValue {
  const c = contract.currency;
  return {
    pricingModel: contract.pricingModel,
    amount: { amount: contract.amountMinor > 0 ? minorToDecimal(contract.amountMinor, c) : '', currency: c },
    hourlyRate: contract.hourlyRateMinor ? minorToDecimal(contract.hourlyRateMinor, c) : '',
    retainerMonthly: contract.retainerMonthlyMinor ? minorToDecimal(contract.retainerMonthlyMinor, c) : '',
    costBudget: costBudgetInrMinor ? minorToDecimal(costBudgetInrMinor, 'INR') : '',
  };
}

export interface ParsedContract {
  errors: Record<string, string>;
  contract: { pricingModel: PricingModelKey; amountMinor: number; currency: string; hourlyRateMinor: number | null; retainerMonthlyMinor: number | null };
  costBudgetInrMinor: number | null;
}

const BAD = 'Enter a valid amount, like 1,250.50';

/** Turns the typed contract into integer minor units, or says which field is not a real amount. */
export function parseContract(v: ContractValue): ParsedContract {
  const errors: Record<string, string> = {};
  const currency = v.amount.currency;
  const read = (text: string, cur: string, key: string): number | null => {
    const t = text.trim();
    if (!t) return null;
    const minor = parseMinor(t, cur);
    if (minor === null) errors[key] = BAD;
    return minor;
  };
  const amountMinor = read(v.amount.amount, currency, 'contract.amountMinor') ?? 0;
  const hourlyRateMinor = v.pricingModel === 'hourly' ? read(v.hourlyRate, currency, 'contract.hourlyRateMinor') : null;
  const retainerMonthlyMinor = v.pricingModel === 'retainer' ? read(v.retainerMonthly, currency, 'contract.retainerMonthlyMinor') : null;
  const costBudgetInrMinor = read(v.costBudget, 'INR', 'costBudgetInrMinor');
  return { errors, contract: { pricingModel: v.pricingModel, amountMinor, currency, hourlyRateMinor, retainerMonthlyMinor }, costBudgetInrMinor };
}
