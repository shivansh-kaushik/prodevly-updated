import Link from 'next/link';
import { cx } from '@/lib/cx';
import { withParams, type RawSearchParams } from '@/lib/admin/search-params';

/** Tabs as links (`?tab=money`): shareable, back-button friendly, and server-rendered. */
export function TabLinks({
  tabs,
  active,
  path,
  params,
  param = 'tab',
}: {
  tabs: ReadonlyArray<{ key: string; label: string; count?: number }>;
  active: string;
  path: string;
  params: RawSearchParams;
  param?: string;
}) {
  return (
    <nav aria-label="Sections" className="-mb-px flex gap-1 overflow-x-auto border-b border-pd-rule">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={withParams(path, params, { [param]: t.key === tabs[0]?.key ? undefined : t.key, page: undefined })}
            aria-current={on ? 'page' : undefined}
            prefetch={false}
            className={cx(
              'relative inline-flex h-10 shrink-0 items-center gap-1.5 px-3 text-[14px] font-medium whitespace-nowrap transition-colors duration-150',
              on ? 'text-pd-ink' : 'text-pd-ink-3 hover:text-pd-ink',
            )}
          >
            {t.label}
            {t.count !== undefined ? <span className="pd-figure rounded-pd-sm bg-pd-well px-1.5 text-[12px] leading-5 text-pd-ink-2">{t.count}</span> : null}
            {on ? <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 bg-pd-rubric" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
