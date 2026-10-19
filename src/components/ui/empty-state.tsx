import { cx } from '@/lib/cx';

/** Shown instead of a table or chart with nothing in it. Says what is missing and offers the next step. */
export function EmptyState({ title, body, action, className }: { title: string; body?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center gap-1.5 px-6 py-12 text-center', className)}>
      <p className="font-pd-serif text-[18px] font-semibold text-pd-ink">{title}</p>
      {body ? <p className="max-w-sm text-[14px] text-pd-ink-3">{body}</p> : null}
      {action ? <div className="pt-3">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('pd-skeleton rounded-pd-sm', className)} />;
}
