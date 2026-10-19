import { formatDate } from '@/lib/admin/format';
import type { Period } from '@/lib/dates/ranges';

/** The current financial year as a ledger stamp: the one place the rubric appears as a frame. */
export function FyStamp({ period }: { period: Pick<Period, 'fyLabel' | 'from' | 'to'> }) {
  if (!period.fyLabel) return null;
  return (
    <p
      className="inline-flex flex-col rounded-pd-sm px-2 py-1 font-pd-mono text-[11px] leading-4 text-pd-rubric shadow-[inset_0_0_0_1px_var(--color-pd-rubric)]"
      aria-label={`Financial year ${period.fyLabel}, ${formatDate(period.from)} to ${formatDate(period.to)}`}
    >
      <span className="font-medium tracking-[0.12em] uppercase">{period.fyLabel}</span>
      <span className="text-pd-rubric/80">{formatDate(period.from)} - {formatDate(period.to)}</span>
    </p>
  );
}
