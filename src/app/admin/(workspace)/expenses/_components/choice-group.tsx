'use client';

import { useId } from 'react';
import { Fieldset } from '@/components/ui/field';
import { cx } from '@/lib/cx';

/**
 * A single choice shown as large radio cards: the answer is one of a few things and each deserves a sentence
 * of explanation (who paid, company or project). A real radio group, so arrow keys and screen readers work;
 * the card is the label, which keeps the touch target above 44px on a phone.
 */
export interface Choice<T extends string> {
  value: T;
  title: string;
  hint?: string;
  disabled?: boolean;
}

export function ChoiceGroup<T extends string>({
  legend,
  value,
  choices,
  onChange,
  error,
  disabled,
}: {
  legend: string;
  value: T;
  choices: ReadonlyArray<Choice<T>>;
  onChange: (value: T) => void;
  error?: string;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <Fieldset legend={legend}>
      <div className={cx('grid gap-2', choices.length > 1 && 'sm:grid-cols-2')}>
        {choices.map((c) => {
          const off = disabled || c.disabled;
          return (
            <label
              key={c.value}
              className={cx(
                'flex min-h-14 cursor-pointer items-start gap-3 rounded-pd-md bg-pd-leaf p-3 transition-shadow',
                'shadow-[inset_0_0_0_1px_var(--color-pd-rule)] hover:shadow-[inset_0_0_0_1px_var(--color-pd-rule-strong)]',
                'has-[:checked]:shadow-[inset_0_0_0_2px_var(--color-pd-ink)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-pd-blue',
                off && 'cursor-not-allowed opacity-50',
              )}
            >
              <input
                type="radio"
                name={name}
                className="mt-0.5 size-4 shrink-0 appearance-none rounded-full border border-pd-rule-strong bg-pd-well checked:border-pd-ink checked:bg-pd-ink checked:shadow-[inset_0_0_0_3px_var(--color-pd-sheet)]"
                checked={value === c.value}
                disabled={off}
                onChange={() => onChange(c.value)}
              />
              <span className="min-w-0">
                <span className="block text-[14px] font-medium text-pd-ink">{c.title}</span>
                {c.hint ? <span className="block text-[12px] leading-4 text-pd-ink-3">{c.hint}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
      {error ? <p role="alert" className="mt-1.5 text-[12px] leading-4 font-medium text-pd-rubric">{error}</p> : null}
    </Fieldset>
  );
}
