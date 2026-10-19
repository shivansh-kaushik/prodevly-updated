'use client';

import { useState } from 'react';
import { Input, Select } from '@/components/ui/field';
import { minorToDecimal, parseMinor } from '@/lib/money/minor';

/**
 * An amount and a currency. The person types "1,250.50"; the form value stays text while they type
 * and `moneyToMinor` turns it into integer minor units (125050) when it is submitted. Anything
 * that is not a real amount in that currency (too many decimals, a decimal comma) yields null,
 * and the field shows why instead of guessing.
 */
export interface MoneyValue {
  amount: string;
  currency: string;
}

/** Integer minor units, or null when the text is not a valid amount for the currency. */
export function moneyToMinor(value: MoneyValue): number | null {
  const minor = parseMinor(value.amount, value.currency);
  return minor !== null && minor > 0 ? minor : null;
}

/** The decimal text for a stored amount (125050 INR -> "1250.50"). */
export function minorToInput(amountMinor: number, currency: string): string {
  return minorToDecimal(amountMinor, currency);
}

export function MoneyInput({
  id,
  value,
  onChange,
  currencies,
  invalid,
  describedBy,
  disabled,
  lockCurrency,
}: {
  id?: string;
  value: MoneyValue;
  onChange: (next: MoneyValue) => void;
  currencies: readonly string[];
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  /** Keep the currency fixed (a payment against a work order in its own currency). */
  lockCurrency?: boolean;
}) {
  const [touched, setTouched] = useState(false);
  const text = value.amount.trim();
  const parsed = text ? parseMinor(text, value.currency) : null;
  const bad = touched && text !== '' && parsed === null;

  return (
    <div className="flex gap-2">
      <div className="w-[5.5rem] shrink-0">
        <Select aria-label="Currency" value={value.currency} disabled={disabled || lockCurrency} onChange={(e) => onChange({ ...value, currency: e.target.value })}>
          {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </div>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        className="pd-figure text-right"
        value={value.amount}
        disabled={disabled}
        aria-invalid={invalid || bad || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange({ ...value, amount: e.target.value })}
        onBlur={() => {
          setTouched(true);
          if (parsed !== null) onChange({ ...value, amount: minorToDecimal(parsed, value.currency) });
        }}
      />
    </div>
  );
}
