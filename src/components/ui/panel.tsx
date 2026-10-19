import { cx } from '@/lib/cx';

/** A panel is paper with a hairline: no shadow (depth is borders-only), padded on the 4px grid. */
export function Panel({ children, className, flush }: { children: React.ReactNode; className?: string; flush?: boolean }) {
  return <section className={cx('rounded-pd-md bg-pd-leaf shadow-[0_0_0_1px_var(--color-pd-rule)]', !flush && 'p-5', className)}>{children}</section>;
}

export function PanelHeader({ title, action, hint }: { title: string; action?: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 pb-3">
      <div className="min-w-0">
        <h2 className="text-[15px] leading-6 font-semibold text-pd-ink">{title}</h2>
        {hint ? <p className="text-[12px] leading-4 text-pd-ink-3">{hint}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Label/value pairs. Labels are the quiet eyebrow style; values carry the weight. */
export function DescriptionList({ items, columns = 2 }: { items: ReadonlyArray<{ label: string; value: React.ReactNode }>; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cx('grid gap-x-8 gap-y-4', columns === 1 && 'grid-cols-1', columns === 2 && 'grid-cols-1 sm:grid-cols-2', columns === 3 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3')}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="pd-eyebrow">{it.label}</dt>
          <dd className="mt-0.5 min-w-0 break-words text-[14px] text-pd-ink">{it.value || <span className="text-pd-ink-3">Not set</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
