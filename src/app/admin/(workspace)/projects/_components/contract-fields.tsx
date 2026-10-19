'use client';

import { MoneyInput } from '@/components/admin/money-input';
import { Field, Input, Select } from '@/components/ui/field';
import type { ContractValue } from './contract-value';
import { PRICING_HINTS, PRICING_LABELS } from './labels';
import type { PricingModelKey } from './types';

/**
 * How the client is billed, and the internal cost budget. Only rendered for people who may edit
 * money (payment:record). Amounts are typed as text and turned into minor units on submit.
 */
export function ContractFields({
  value,
  onChange,
  errors,
  currencies,
  currencyLocked,
}: {
  value: ContractValue;
  onChange: (next: ContractValue) => void;
  errors: Record<string, string>;
  currencies: readonly string[];
  currencyLocked?: boolean;
}) {
  const set = <K extends keyof ContractValue>(key: K, v: ContractValue[K]) => onChange({ ...value, [key]: v });
  const model = value.pricingModel;
  const cur = value.amount.currency;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Pricing" hint={PRICING_HINTS[model]} error={errors['contract.pricingModel']} className="sm:col-span-2">
        {(c) => (
          <Select {...c} value={model} onChange={(e) => set('pricingModel', e.target.value as PricingModelKey)}>
            {(Object.keys(PRICING_LABELS) as PricingModelKey[]).map((k) => <option key={k} value={k}>{PRICING_LABELS[k]}</option>)}
          </Select>
        )}
      </Field>

      <Field
        label={model === 'fixed' || model === 'milestone' ? 'Contract value' : 'Estimated value'}
        hint={
          currencyLocked
            ? 'The currency is fixed because milestones or payments already use it.'
            : model === 'fixed' || model === 'milestone'
              ? 'The total the client agreed to pay. Milestones cannot add up to more than this.'
              : 'Optional. Hourly and retainer projects are billed by the milestones you add.'
        }
        error={errors['contract.amountMinor'] ?? errors['contract.currency']}
      >
        {(c) => (
          <MoneyInput
            id={c.id}
            value={value.amount}
            onChange={(amount) => set('amount', amount)}
            currencies={currencies}
            lockCurrency={currencyLocked}
            invalid={Boolean(errors['contract.amountMinor'] ?? errors['contract.currency'])}
            describedBy={c['aria-describedby']}
          />
        )}
      </Field>

      {model === 'hourly' ? (
        <Field label={`Hourly rate (${cur})`} error={errors['contract.hourlyRateMinor']}>
          {(c) => <Input {...c} inputMode="decimal" autoComplete="off" className="pd-figure text-right" placeholder="0.00" value={value.hourlyRate} onChange={(e) => set('hourlyRate', e.target.value)} />}
        </Field>
      ) : null}
      {model === 'retainer' ? (
        <Field label={`Monthly fee (${cur})`} error={errors['contract.retainerMonthlyMinor']}>
          {(c) => <Input {...c} inputMode="decimal" autoComplete="off" className="pd-figure text-right" placeholder="0.00" value={value.retainerMonthly} onChange={(e) => set('retainerMonthly', e.target.value)} />}
        </Field>
      ) : null}

      <Field label="Cost budget (INR)" hint="Internal. What you expect this project to cost you, in rupees. Never shown to the client." error={errors.costBudgetInrMinor}>
        {(c) => <Input {...c} inputMode="decimal" autoComplete="off" className="pd-figure text-right" placeholder="0.00" value={value.costBudget} onChange={(e) => set('costBudget', e.target.value)} />}
      </Field>
    </div>
  );
}
