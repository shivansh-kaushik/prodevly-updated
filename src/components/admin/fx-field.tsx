'use client';

import { useEffect, useId, useState } from 'react';
import { Fieldset, Input } from '@/components/ui/field';
import { BASE_CURRENCY } from '@/config/currencies';
import { ApiError, qs } from '@/lib/admin/api-client';
import { formatDate } from '@/lib/admin/format';
import { cx } from '@/lib/cx';
import { useAdminApi } from './api-provider';
import {
  deriveRate,
  fxSummary,
  fxValueError,
  parseRateText,
  parseSettledInr,
  previewInr,
  tableBasis,
  tableUsable,
  type FxChoice,
  type FxLookup,
  type FxValue,
} from './fx-field-model';

/**
 * The exchange-rate part of every money form. Put it under the amount, the currency and the date:
 *
 *   <FxField currency={c} amountMinor={minor} date="2026-10-12" value={fx} onChange={setFx} error={errors.fxRate ?? errors.settledInrMinor} />
 *
 * It asks the server for the table rate for that currency and day (GET /api/admin/fx-rates/lookup),
 * says in one quiet line what the amount comes to, warns when the rate on file is stale or missing, and
 * lets the person choose how the amount is settled: the table rate, the exact rate the bank used, or
 * the INR that actually arrived. On submit send `fxValueToPayload(value)` with the body and let the
 * server's `resolveFx` do the conversion: nothing computed here is ever stored. INR needs no rate, so
 * the field renders nothing for it. Check `fxValueError(value)` before submitting.
 */
export interface FxFieldProps {
  currency: string;
  amountMinor: number | null;
  /** The entry's date, "YYYY-MM-DD". */
  date: string | null;
  value: FxValue;
  onChange: (value: FxValue) => void;
  /** A server error for the field (`fxRate` or `settledInrMinor`), shown in place. */
  error?: string;
  disabled?: boolean;
}

const CHOICES: ReadonlyArray<{ value: FxChoice; label: string }> = [
  { value: 'table', label: 'Table rate' },
  { value: 'manual', label: 'Exact rate' },
  { value: 'bank', label: 'INR received' },
];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Answer = { key: string; lookup: FxLookup | null; failed?: string };

export function FxField({ currency, amountMinor, date, value, onChange, error, disabled }: FxFieldProps) {
  const { call } = useAdminApi();
  const name = useId();
  const [touched, setTouched] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const key = currency !== BASE_CURRENCY && date && DATE.test(date) ? `${currency}|${date}` : null;

  // The amount is not part of the key: the table rate for a day does not depend on it, and the sum is
  // done here with the same function the server uses, so the line follows the typing without a request.
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const lookup = await call<FxLookup>(`/api/admin/fx-rates/lookup${qs({ currency, date })}`, { signal: controller.signal });
        setAnswer({ key, lookup });
      } catch (e) {
        if (controller.signal.aborted) return;
        setAnswer({ key, lookup: null, failed: e instanceof ApiError ? e.message : 'We could not look up the rate.' });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, currency, date, call]);

  if (currency === BASE_CURRENCY) return null;

  const current = answer && answer.key === key ? answer : null;
  const lookup = current?.lookup ?? null;
  const usable = tableUsable(lookup);
  const loading = key !== null && current === null;
  const problem = touched ? fxValueError(value) : null;
  const shownError = error ?? problem ?? undefined;
  const amount = amountMinor && amountMinor > 0 ? amountMinor : null;

  const line = describe();

  function describe(): { text: string; tone: 'quiet' | 'warn' } {
    if (value.choice === 'manual') {
      const rate = parseRateText(value.manualRate);
      if (rate === null) return { text: 'Type the exact rate the bank used, in INR per 1 ' + currency + '.', tone: 'quiet' };
      return { text: fxSummary({ currency, amountMinor: amount, inrMinor: amount ? previewInr(amount, currency, rate) : null, rate, basis: 'the rate you entered' }), tone: 'quiet' };
    }
    if (value.choice === 'bank') {
      const settled = parseSettledInr(value.settledInr);
      const rate = amount && settled ? deriveRate(amount, currency, settled) : null;
      if (rate === null || !amount) return { text: 'Type the INR that reached the account. The rate is worked out from it.', tone: 'quiet' };
      return { text: fxSummary({ currency, amountMinor: amount, inrMinor: settled, rate, basis: 'worked out from the INR that arrived' }), tone: 'quiet' };
    }
    if (!key) return { text: 'Choose the date to see the table rate.', tone: 'quiet' };
    if (loading) return { text: 'Looking up the rate...', tone: 'quiet' };
    if (current?.failed) return { text: current.failed, tone: 'warn' };
    if (usable) {
      const inrMinor = amount ? previewInr(amount, currency, lookup.rate) : null;
      return { text: fxSummary({ currency, amountMinor: amount, inrMinor, rate: lookup.rate, basis: tableBasis(lookup.rateOn) }), tone: 'quiet' };
    }
    if (lookup?.rate != null && lookup.rateOn) {
      return {
        text: `The latest ${currency} rate on file is from ${formatDate(lookup.rateOn)}, more than ${lookup.staleDays} days before this date. Enter the exact rate, or the INR that arrived.`,
        tone: 'warn',
      };
    }
    return { text: `There is no ${currency} rate on file for this date. Enter the exact rate, or the INR that arrived.`, tone: 'warn' };
  }

  const tableBlocked = lookup !== null && !usable;
  const describedBy = `${name}-line`;

  return (
    <Fieldset legend="Exchange rate" className="flex flex-col gap-2.5">
      <div role="radiogroup" aria-label="How to convert to INR" className="inline-flex w-full rounded-pd-sm bg-pd-well p-0.5 text-[13px] font-medium sm:w-fit">
        {CHOICES.map((c) => {
          const off = disabled || (c.value === 'table' && tableBlocked);
          return (
            <label
              key={c.value}
              className={cx(
                'flex min-h-8 flex-1 cursor-pointer items-center justify-center rounded-[3px] px-3 whitespace-nowrap transition-colors pointer-coarse:min-h-10 sm:flex-none',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-pd-blue',
                value.choice === c.value ? 'bg-pd-sheet text-pd-ink shadow-[0_0_0_1px_var(--color-pd-rule)]' : 'text-pd-ink-3 hover:text-pd-ink',
                off && 'cursor-not-allowed opacity-50',
              )}
            >
              <input
                type="radio"
                name={name}
                className="sr-only"
                checked={value.choice === c.value}
                disabled={off}
                onChange={() => {
                  setTouched(false);
                  onChange({ ...value, choice: c.value });
                }}
              />
              {c.label}
            </label>
          );
        })}
      </div>

      {value.choice === 'manual' ? (
        <div className="flex max-w-xs flex-col gap-1.5">
          <label htmlFor={`${name}-rate`} className="text-[13px] font-medium text-pd-ink-2">Rate the bank used (INR per 1 {currency})</label>
          <Input
            id={`${name}-rate`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="83.42"
            className="pd-figure text-right"
            value={value.manualRate}
            disabled={disabled}
            aria-invalid={shownError ? true : undefined}
            aria-describedby={describedBy}
            onChange={(e) => onChange({ ...value, manualRate: e.target.value })}
            onBlur={() => setTouched(true)}
          />
        </div>
      ) : null}

      {value.choice === 'bank' ? (
        <div className="flex max-w-xs flex-col gap-1.5">
          <label htmlFor={`${name}-inr`} className="text-[13px] font-medium text-pd-ink-2">INR that arrived, after bank charges</label>
          <Input
            id={`${name}-inr`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="83,420.00"
            className="pd-figure text-right"
            value={value.settledInr}
            disabled={disabled}
            aria-invalid={shownError ? true : undefined}
            aria-describedby={describedBy}
            onChange={(e) => onChange({ ...value, settledInr: e.target.value })}
            onBlur={() => setTouched(true)}
          />
        </div>
      ) : null}

      <p id={describedBy} aria-live="polite" className={cx('text-[12px] leading-4', line.tone === 'warn' ? 'font-medium text-pd-amber' : 'pd-figure text-pd-ink-3')}>
        {line.text}
      </p>
      {shownError ? <p role="alert" className="text-[12px] leading-4 font-medium text-pd-rubric">{shownError}</p> : null}
    </Fieldset>
  );
}
