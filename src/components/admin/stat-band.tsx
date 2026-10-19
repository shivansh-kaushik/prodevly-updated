import Link from 'next/link';
import { cx } from '@/lib/cx';

/**
 * The totals strip at the top of a dashboard: one ruled band (not a grid of floating cards).
 * The first figure leads: larger, and underlined with the accountant's double rule. A tile that
 * needs attention takes the red margin line. Money tiles are simply left out for viewers who may
 * not see money (never shown as zero), so pass only what this viewer is entitled to.
 */
export interface Stat {
  label: string;
  value: React.ReactNode;
  /** A quieter second line: a native-currency breakdown, a comparison, a denominator. */
  sub?: React.ReactNode;
  href?: string;
  attention?: boolean;
}

function Tile({ stat, focal }: { stat: Stat; focal: boolean }) {
  const inner = (
    <div className={cx('flex h-full min-w-0 flex-col justify-start gap-2 p-4', stat.attention && 'pd-margin-flag')}>
      <p className="pd-eyebrow">{stat.label}</p>
      <div className="min-w-0">
        <p className={cx('pd-figure font-pd-serif leading-9 font-semibold tracking-[-0.02em] whitespace-nowrap text-pd-ink', focal ? 'text-[clamp(18px,13cqw,32px)]' : 'text-[clamp(16px,11.5cqw,26px)]')}>
          {stat.value}
        </p>
        {focal ? <span aria-hidden className="mt-1.5 block h-[3px] border-y border-pd-rule-strong" /> : null}
        {stat.sub ? <p className="pd-figure mt-1 text-[12px] leading-4 text-pd-ink-3">{stat.sub}</p> : null}
      </div>
    </div>
  );
  // Each tile is its own size container, so a long figure (rupees with lakh grouping) scales to fit instead of wrapping or being cut.
  const cell = 'min-w-0 [container-type:inline-size] shadow-[inset_-1px_0_0_var(--color-pd-rule),inset_0_-1px_0_var(--color-pd-rule)]';
  return stat.href ? (
    <Link href={stat.href} prefetch={false} className={cx(cell, 'transition-colors hover:bg-pd-well/60')}>{inner}</Link>
  ) : (
    <div className={cell}>{inner}</div>
  );
}

export function StatBand({ stats, className }: { stats: ReadonlyArray<Stat>; className?: string }) {
  if (stats.length === 0) return null;
  return (
    <div className={cx('overflow-hidden rounded-pd-md bg-pd-leaf shadow-[0_0_0_1px_var(--color-pd-rule)]', className)}>
      <div className="-mr-px -mb-px grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(11.5rem,1fr))]">
        {stats.map((s, i) => <Tile key={s.label} stat={s} focal={i === 0} />)}
      </div>
    </div>
  );
}
