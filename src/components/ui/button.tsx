import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { cx } from '@/lib/cx';

/**
 * Buttons. The primary action is INK (dark, quiet, unmistakable); the rubric red is kept for
 * danger and attention so it still means something when it appears.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-pd-ink text-white hover:bg-pd-ink-2',
  secondary:
    'bg-pd-leaf text-pd-ink shadow-[inset_0_0_0_1px_var(--color-pd-rule-strong)] hover:bg-pd-well',
  ghost: 'text-pd-ink-2 hover:bg-pd-well hover:text-pd-ink',
  danger:
    'bg-pd-leaf text-pd-rubric shadow-[inset_0_0_0_1px_var(--color-pd-rubric)] hover:bg-pd-rubric hover:text-white',
};

const SIZE: Record<ButtonSize, string> = {
  md: 'h-9 px-3.5 text-[14px] pointer-coarse:h-11',
  sm: 'h-8 px-2.5 text-[13px] pointer-coarse:h-10',
};

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra?: string) {
  return cx(
    'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-pd-sm font-medium',
    'transition-[background-color,color,box-shadow,transform] duration-150 ease-pd-out active:scale-[0.97]',
    'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    VARIANT[variant],
    SIZE[size],
    extra,
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

export function Button({ variant, size, loading, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

type LinkButtonProps = React.ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize };

export function LinkButton({ variant, size, className, ...rest }: LinkButtonProps) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

/** Icon-only button. `label` is required: it becomes the accessible name and the tooltip. */
export function IconButton({
  label,
  className,
  children,
  type = 'button',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-grid size-9 place-items-center rounded-pd-sm text-pd-ink-2 transition-[background-color,color,transform] duration-150 ease-pd-out',
        'hover:bg-pd-well hover:text-pd-ink active:scale-[0.95] pointer-coarse:size-11 disabled:opacity-50',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
