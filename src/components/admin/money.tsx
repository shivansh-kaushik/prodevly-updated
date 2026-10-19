import { formatMinor } from '@/lib/money/minor';
import { formatInr } from '@/lib/admin/format';
import { cx } from '@/lib/cx';

/** INR gets Indian grouping (12,34,567.00); every other currency gets Western grouping. */
export function formatNative(amountMinor: number, currency: string): string {
  return formatMinor(amountMinor, currency, currency === 'INR' ? 'en-IN' : 'en-US');
}

/**
 * An amount for display. INR shows once. A foreign amount shows its own currency first and the
 * INR value beneath it ("USD 4,000.00" over "₹3,33,680.00"), because dashboards total in INR and
 * the native figure is the one the client actually paid.
 */
export function Money({ amountMinor, currency = 'INR', inrMinor, className, inline }: { amountMinor: number; currency?: string; inrMinor?: number; className?: string; inline?: boolean }) {
  if (currency === 'INR') return <span className={cx('pd-figure', className)}>{formatInr(amountMinor)}</span>;
  const native = formatNative(amountMinor, currency);
  if (inrMinor === undefined) return <span className={cx('pd-figure', className)}>{native}</span>;
  return inline ? (
    <span className={cx('pd-figure', className)}>{native} <span className="text-pd-ink-3">({formatInr(inrMinor)})</span></span>
  ) : (
    <span className={cx('pd-figure inline-flex flex-col items-end leading-5', className)}>
      <span>{native}</span>
      <span className="text-[12px] text-pd-ink-3">{formatInr(inrMinor)}</span>
    </span>
  );
}
