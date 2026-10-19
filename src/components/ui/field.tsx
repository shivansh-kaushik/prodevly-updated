'use client';

import { useId } from 'react';
import { cx } from '@/lib/cx';

/**
 * Form controls. Inputs sit one step DARKER than the page (they receive content) and take a
 * hairline ring that firms up on hover and turns blue on focus. Errors are shown as text under
 * the field and wired to the control with aria-describedby, never by colour alone.
 */
const CONTROL = cx(
  'w-full rounded-pd-sm bg-pd-well px-3 text-[14px] text-pd-ink placeholder:text-pd-ink-3',
  'shadow-[inset_0_0_0_1px_var(--color-pd-rule)] transition-[box-shadow,background-color] duration-150',
  'hover:shadow-[inset_0_0_0_1px_var(--color-pd-rule-strong)]',
  'focus:bg-pd-sheet focus:shadow-[inset_0_0_0_1px_var(--color-pd-blue),0_0_0_3px_var(--color-pd-blue-wash)] focus:outline-none',
  'disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:shadow-[inset_0_0_0_1px_var(--color-pd-rubric)]',
);

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Visually hide the label (it still names the control for assistive technology). */
  hideLabel?: boolean;
  className?: string;
  children: (control: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true; 'aria-required'?: true }) => React.ReactNode;
}

export function Field({ label, hint, error, required, hideLabel, className, children }: FieldProps) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className={cx('text-[13px] font-medium text-pd-ink-2', hideLabel && 'sr-only')}>
        {label}
        {required ? <span className="ml-0.5 text-pd-rubric" aria-hidden> *</span> : null}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, 'aria-required': required ? true : undefined })}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-[12px] leading-4 text-pd-ink-3">{hint}</p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[12px] leading-4 font-medium text-pd-rubric">{error}</p>
      ) : null}
    </div>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;
export function Input({ className, type = 'text', ...rest }: InputProps) {
  return <input type={type} className={cx(CONTROL, 'h-9 pointer-coarse:h-11', className)} {...rest} />;
}

export function Textarea({ className, rows = 3, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} className={cx(CONTROL, 'min-h-20 resize-y py-2 leading-5', className)} {...rest} />;
}

/** Native select (keyboard, mobile pickers and screen readers for free), restyled with a drawn chevron. */
export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cx(CONTROL, 'h-9 appearance-none pr-9 pointer-coarse:h-11', className)}
        {...rest}
      >
        {children}
      </select>
      <svg viewBox="0 0 16 16" aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-pd-ink-3">
        <path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function Checkbox({ label, className, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={cx('inline-flex min-h-9 cursor-pointer items-center gap-2.5 text-[14px] text-pd-ink', className)}>
      <input type="checkbox" className="pd-checkbox" {...rest} />
      {label}
    </label>
  );
}

/** A group of related controls (radio-like choices, a set of checkboxes). */
export function Fieldset({ legend, hint, children, className }: { legend: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <fieldset className={cx('min-w-0 border-0 p-0', className)}>
      <legend className="mb-1.5 p-0 text-[13px] font-medium text-pd-ink-2">{legend}</legend>
      {hint ? <p className="mb-2 text-[12px] text-pd-ink-3">{hint}</p> : null}
      {children}
    </fieldset>
  );
}
