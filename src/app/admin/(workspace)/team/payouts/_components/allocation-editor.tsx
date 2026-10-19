'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { EntityPicker } from '@/components/admin/entity-picker';
import { formatNative } from '@/components/admin/money';
import { Button, IconButton } from '@/components/ui/button';
import { Fieldset, Input } from '@/components/ui/field';
import { formatDuration } from '@/lib/admin/format';
import { parseMinor } from '@/lib/money/minor';

/** One project's share, as the person typed it. `amount` is text while typing and becomes minor units on submit. */
export interface AllocationRow {
  projectId: string;
  label: string;
  ref: string;
  /** What they logged on it in the period (for context; the server derives its own figure). */
  minutes: number;
  amount: string;
}

/** The row amounts as minor units: null for text that is not an amount, 0 for an empty box. */
export function rowAmounts(rows: readonly AllocationRow[], currency: string): Array<number | null> {
  return rows.map((r) => (r.amount.trim() === '' ? 0 : parseMinor(r.amount, currency)));
}

/**
 * The split of a payout across projects. The whole payout is shared by default, in proportion to the time logged; every
 * amount can be edited, projects can be added or removed, and what is left over (never negative) is company overhead.
 * It only reports: the server enforces that the split cannot exceed the payout and derives each project's INR share.
 */
export function AllocationEditor({
  rows,
  onChange,
  onPropose,
  currency,
  amountMinor,
  errors,
  disabled,
  note,
}: {
  rows: AllocationRow[];
  onChange: (rows: AllocationRow[]) => void;
  /** Share the payout by logged time again, discarding edits. */
  onPropose?: () => void;
  currency: string;
  /** The payout amount, or null while it is empty or not a valid amount. */
  amountMinor: number | null;
  errors: Record<string, string>;
  disabled?: boolean;
  note?: React.ReactNode;
}) {
  const [pickerKey, setPickerKey] = useState(0);
  const [duplicate, setDuplicate] = useState(false);
  const amounts = rowAmounts(rows, currency);
  const allocated = amounts.reduce<number>((s, a) => s + (a ?? 0), 0);
  const remainder = amountMinor === null ? null : amountMinor - allocated;
  const over = remainder !== null && remainder < 0;

  const update = (index: number, patch: Partial<AllocationRow>) => onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  return (
    <Fieldset legend="Charge to projects" hint="Share the cost across the projects they worked on. Whatever is not charged to a project stays company overhead.">
      {rows.length > 0 ? (
        <ul className="mb-3 flex flex-col rounded-pd-md bg-pd-leaf shadow-[0_0_0_1px_var(--color-pd-rule)]">
          {rows.map((row, i) => {
            const error = errors[`allocations.${i}.amountMinor`] ?? errors[`allocations.${i}.projectId`] ?? (amounts[i] === null ? 'Enter an amount like 1,250.00' : undefined);
            return (
              <li key={row.projectId} className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-pd-rule-soft p-3 last:border-b-0">
                <div className="min-w-0 flex-1 basis-44">
                  <p className="truncate text-[14px] font-medium text-pd-ink">{row.label}</p>
                  <p className="text-[12px] text-pd-ink-3">
                    <span className="font-pd-mono">{row.ref}</span> · {row.minutes > 0 ? `${formatDuration(row.minutes)} logged` : 'No time logged'}
                  </p>
                </div>
                <div className="flex items-start gap-1">
                  <div className="w-40">
                    <Input
                      aria-label={`${currency} amount for ${row.label}`}
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0.00"
                      className="pd-figure text-right"
                      value={row.amount}
                      disabled={disabled}
                      aria-invalid={error ? true : undefined}
                      onChange={(e) => update(i, { amount: e.target.value })}
                    />
                    {error ? <p role="alert" className="mt-1 text-[12px] leading-4 font-medium text-pd-rubric">{error}</p> : null}
                  </div>
                  <IconButton label={`Remove ${row.label}`} disabled={disabled} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4" aria-hidden />
                  </IconButton>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mb-3 rounded-pd-md bg-pd-well px-3 py-2.5 text-[13px] text-pd-ink-3">
          Nothing is charged to a project yet, so all of this payout is company overhead.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-xs">
          <EntityPicker
            key={pickerKey}
            kind="projects"
            value={null}
            disabled={disabled}
            placeholder="Add a project"
            onChange={(picked) => {
              if (!picked) return;
              if (rows.some((r) => r.projectId === picked.id)) {
                setDuplicate(true);
              } else {
                setDuplicate(false);
                onChange([...rows, { projectId: picked.id, label: picked.label, ref: picked.ref ?? '', minutes: 0, amount: '' }]);
              }
              setPickerKey((k) => k + 1);
            }}
          />
        </div>
        {onPropose ? (
          <Button variant="ghost" size="sm" disabled={disabled} onClick={onPropose}>Share by logged time</Button>
        ) : null}
      </div>
      {duplicate ? <p role="status" className="mt-1.5 text-[12px] text-pd-ink-3">That project is already in the list.</p> : null}
      {note ? <div className="mt-2 text-[12px] leading-4 text-pd-ink-3">{note}</div> : null}
      {errors.allocations ? <p role="alert" className="mt-2 text-[13px] font-medium text-pd-rubric">{errors.allocations}</p> : null}

      <dl className="pd-figure mt-3 grid grid-cols-2 gap-x-6 gap-y-1 rounded-pd-md bg-pd-paper px-3 py-2.5 text-[13px] sm:max-w-md" aria-live="polite">
        <dt className="text-pd-ink-3">Charged to projects</dt>
        <dd className="text-right font-medium text-pd-ink">{formatNative(allocated, currency)}</dd>
        <dt className="text-pd-ink-3">Company overhead</dt>
        <dd className={over ? 'text-right font-medium text-pd-rubric' : 'text-right font-medium text-pd-ink'}>
          {remainder === null ? 'Enter the amount' : over ? `Over by ${formatNative(-remainder, currency)}` : formatNative(remainder, currency)}
        </dd>
      </dl>
    </Fieldset>
  );
}
