import Link from 'next/link';
import { cx } from '@/lib/cx';

const TABS = [
  { key: 'general', label: 'General', href: '/admin/settings', needsSettings: true },
  { key: 'lists', label: 'Lists', href: '/admin/settings/lists', needsSettings: true },
  { key: 'fx', label: 'FX rates', href: '/admin/settings/fx', needsSettings: false },
] as const;

export type SettingsTab = (typeof TABS)[number]['key'];

/**
 * The three settings pages as tabs. They are separate routes (each checks its own capability), so
 * these are plain links, and a viewer who can only read rates sees no tabs at all: one page needs no menu.
 */
export function SettingsNav({ active, canEditSettings }: { active: SettingsTab; canEditSettings: boolean }) {
  const tabs = TABS.filter((t) => canEditSettings || !t.needsSettings);
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Settings" className="-mt-2 mb-6 flex gap-1 overflow-x-auto border-b border-pd-rule">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            prefetch={false}
            aria-current={on ? 'page' : undefined}
            className={cx(
              'relative inline-flex h-10 shrink-0 items-center px-3 text-[14px] font-medium whitespace-nowrap transition-colors duration-150',
              on ? 'text-pd-ink' : 'text-pd-ink-3 hover:text-pd-ink',
            )}
          >
            {t.label}
            {on ? <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 bg-pd-rubric" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
