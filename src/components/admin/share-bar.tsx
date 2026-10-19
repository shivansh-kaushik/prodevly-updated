import { cx } from '@/lib/cx';
import { formatCount } from '@/lib/admin/format';
import { SERIES_PALETTE } from '@/lib/admin/chart-colors';

/** A composition as one ruled bar with a legend (projects by status). Server-rendered, no chart library. */
export function ShareBar({ parts, className }: { parts: ReadonlyArray<{ label: string; value: number; color?: string }>; className?: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return null;
  const shown = parts.filter((p) => p.value > 0);
  return (
    <figure className={cx('flex flex-col gap-3', className)}>
      <div className="flex h-3 overflow-hidden rounded-pd-sm bg-pd-well" role="img" aria-label={shown.map((p) => `${p.label} ${p.value}`).join(', ')}>
        {shown.map((p, i) => (
          <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color ?? SERIES_PALETTE[i % SERIES_PALETTE.length] }} className="border-r border-pd-leaf last:border-r-0" />
        ))}
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        {shown.map((p, i) => (
          <span key={p.label} className="inline-flex items-center gap-1.5 text-pd-ink-2">
            <span aria-hidden className="size-2 rounded-[2px]" style={{ background: p.color ?? SERIES_PALETTE[i % SERIES_PALETTE.length] }} />
            {p.label} <span className="pd-figure font-medium text-pd-ink">{formatCount(p.value)}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
