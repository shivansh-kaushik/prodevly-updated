import { cx } from '@/lib/cx';

export type Tone = 'neutral' | 'credit' | 'amber' | 'rubric' | 'blue' | 'violet';

const TONE: Record<Tone, string> = {
  neutral: 'bg-pd-well text-pd-ink-2',
  credit: 'bg-pd-credit-wash text-pd-credit',
  amber: 'bg-pd-amber-wash text-pd-amber',
  rubric: 'bg-pd-rubric-wash text-pd-rubric',
  blue: 'bg-pd-blue-wash text-pd-blue',
  violet: 'bg-pd-violet-wash text-pd-violet',
};

/** A small label. The dot is decorative; the TEXT carries the meaning, so it never relies on colour alone. */
export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex h-5 items-center gap-1.5 rounded-pd-sm px-1.5 text-[12px] leading-none font-medium whitespace-nowrap', TONE[tone], className)}>
      <span aria-hidden className="size-1.5 rounded-full bg-current opacity-70" />
      {children}
    </span>
  );
}
