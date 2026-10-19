import Link from 'next/link';
import { cx } from '@/lib/cx';
import { PATHS } from './labels';

export type Section = 'directory' | 'work-orders' | 'payouts';

/**
 * Directory, Work orders and Payouts are three screens of one module. Work orders and payouts are money, so
 * they show only for viewers who may read them (`payout:view`); without it the directory stands alone.
 */
export function SectionNav({ active, showMoney }: { active: Section; showMoney: boolean }) {
  if (!showMoney) return null;
  const items: ReadonlyArray<{ key: Section; label: string; href: string }> = [
    { key: 'directory', label: 'Directory', href: PATHS.directory },
    { key: 'work-orders', label: 'Work orders', href: PATHS.workOrders },
    { key: 'payouts', label: 'Payouts', href: PATHS.payouts },
  ];
  return (
    <div className="mb-6">
      <nav aria-label="Third parties sections" className="-mb-px flex gap-1 overflow-x-auto border-b border-pd-rule">
        {items.map((item) => {
          const on = item.key === active;
          return (
            <Link
              key={item.key}
              href={item.href}
              prefetch={false}
              aria-current={on ? 'page' : undefined}
              className={cx(
                'relative inline-flex h-10 shrink-0 items-center px-3 text-[14px] font-medium whitespace-nowrap transition-colors duration-150',
                on ? 'text-pd-ink' : 'text-pd-ink-3 hover:text-pd-ink',
              )}
            >
              {item.label}
              {on ? <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 bg-pd-rubric" /> : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
