import Link from 'next/link';
import { cx } from '@/lib/cx';
import { CONTENT_LABELS, CONTENT_TYPES, type ContentType } from '@/lib/content/types';

export type ContentNavKey = 'overview' | ContentType | 'site';

/** The sections of Website content, as links. The current one is marked with text-level state (aria-current), not colour alone. */
export function ContentNav({ active }: { active: ContentNavKey }) {
  const links: Array<{ key: ContentNavKey; label: string; href: string }> = [
    { key: 'overview', label: 'Overview', href: '/admin/content' },
    ...CONTENT_TYPES.map((t) => ({ key: t, label: CONTENT_LABELS[t].plural, href: `/admin/content/${t}` })),
    { key: 'site', label: 'Company info', href: '/admin/content/site' },
  ];
  return (
    <nav aria-label="Website content sections" className="-mt-2 mb-6 flex gap-1 overflow-x-auto border-b border-pd-rule">
      {links.map((l) => {
        const on = l.key === active;
        return (
          <Link
            key={l.key}
            href={l.href}
            prefetch={false}
            aria-current={on ? 'page' : undefined}
            className={cx('relative inline-flex h-10 shrink-0 items-center px-3 text-[14px] font-medium whitespace-nowrap transition-colors duration-150', on ? 'text-pd-ink' : 'text-pd-ink-3 hover:text-pd-ink')}
          >
            {l.label}
            {on ? <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 bg-pd-rubric" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
