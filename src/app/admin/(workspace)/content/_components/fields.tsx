'use client';

import { Checkbox, Field, Textarea, Input } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { cx } from '@/lib/cx';
import { listToLines, linesToList, listToTags, tagsToList } from './lists';

/** One entry per line, stored as a list. Shown as plain text so it works with every keyboard and screen reader. */
export function LinesField({ label, hint, error, value, onChange, disabled, rows = 4, placeholder }: {
  label: string;
  hint?: string;
  error?: string;
  value: string[];
  onChange: (list: string[]) => void;
  disabled?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <Field label={label} hint={hint ?? 'One per line.'} error={error}>
      {(c) => (
        <Textarea
          {...c}
          rows={rows}
          disabled={disabled}
          placeholder={placeholder}
          defaultValue={listToLines(value)}
          // Uncontrolled while typing so a trailing newline is not eaten; the list is parsed on every change.
          onChange={(e) => onChange(linesToList(e.target.value))}
        />
      )}
    </Field>
  );
}

/** Comma separated tags, stored as a list. */
export function TagsField({ label, hint, error, value, onChange, disabled, placeholder }: {
  label: string;
  hint?: string;
  error?: string;
  value: string[];
  onChange: (list: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <Field label={label} hint={hint ?? 'Separate with commas.'} error={error}>
      {(c) => <Input {...c} disabled={disabled} placeholder={placeholder} defaultValue={listToTags(value)} onChange={(e) => onChange(tagsToList(e.target.value))} />}
    </Field>
  );
}

/**
 * The "may we show this?" tick, made hard to miss. Publishing is refused until it is ticked, so the
 * state is spelled out in words (never colour alone) and sits in its own box above the save bar.
 */
export function PermissionTick({ label, explanation, checked, onChange, disabled, error }: {
  label: string;
  explanation: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <div className={cx('flex flex-col gap-2 rounded-pd-md p-4 shadow-[0_0_0_1px_var(--color-pd-rule-strong)]', checked ? 'bg-pd-credit-wash' : 'bg-pd-amber-wash', error && 'shadow-[0_0_0_1px_var(--color-pd-rubric)]')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Checkbox label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-describedby={error ? 'permission-error' : undefined} />
        <Badge tone={checked ? 'credit' : 'amber'}>{checked ? 'Confirmed' : 'Not confirmed'}</Badge>
      </div>
      <p className="text-[13px] leading-5 text-pd-ink-2">{explanation}</p>
      {error ? <p id="permission-error" role="alert" className="text-[13px] font-medium text-pd-rubric">{error}</p> : null}
    </div>
  );
}
