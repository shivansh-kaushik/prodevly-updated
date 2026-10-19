'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Banknote, BriefcaseBusiness, Building2, ClipboardList, Clock3, FileText, Gauge, Handshake, History, Inbox, ListChecks, Settings, UserCog, Users, Wallet,
  type LucideIcon,
} from 'lucide-react';
import { cx } from '@/lib/cx';
import type { NavGroup, NavIcon } from '@/config/admin-nav';

const ICONS: Record<NavIcon, LucideIcon> = {
  overview: Gauge, clients: Building2, projects: BriefcaseBusiness, tasks: ListChecks, worklogs: Clock3, my: ClipboardList,
  payments: Banknote, thirdparties: Handshake, expenses: Wallet, team: Users, admins: UserCog, content: FileText,
  enquiries: Inbox, settings: Settings, audit: History,
};

/** The sidebar list. The current section carries the red margin mark of a ledger. */
export function NavLinks({ groups, onNavigate, badges }: { groups: NavGroup[]; onNavigate?: () => void; badges?: Record<string, number> }) {
  const pathname = usePathname();
  const isActive = (href: string, match?: string) =>
    match ? new RegExp(`^${match}`).test(pathname) : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav aria-label="Admin" className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.label ?? 'top'} className="flex flex-col gap-0.5">
          {group.label ? <p className="pd-eyebrow px-3 pb-1">{group.label}</p> : null}
          {group.items.map((item) => {
            const Icon = ICONS[item.icon];
            const active = isActive(item.href, item.match);
            return (
              <Link
                key={item.key}
                href={item.href}
                prefetch={false}
                aria-current={active ? 'page' : undefined}
                onClick={onNavigate}
                className={cx(
                  'flex h-9 items-center gap-2.5 rounded-pd-sm px-3 text-[14px] transition-colors duration-100 pointer-coarse:h-11',
                  active ? 'pd-margin-flag bg-pd-well font-medium text-pd-ink' : 'text-pd-ink-2 hover:bg-pd-well/70 hover:text-pd-ink',
                )}
              >
                <Icon className={cx('size-4 shrink-0', active ? 'text-pd-rubric' : 'text-pd-ink-3')} aria-hidden />
                {item.label}
                {badges?.[item.key] ? (
                  <span className="pd-figure ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-pd-rubric px-1.5 text-[11px] leading-none font-medium text-white" aria-label={`${badges[item.key]} new`}>
                    {badges[item.key]}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
