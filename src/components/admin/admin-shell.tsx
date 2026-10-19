import Link from 'next/link';
import { visibleNav } from '@/config/admin-nav';
import type { SessionUser } from '@/types/session';
import { getPeriod } from '@/lib/admin/period';
import { countNewlyAssigned } from '@/services/task.service';
import { readMyVisit } from '@/app/admin/(workspace)/my/_lib/read-visit';
import { AdminProviders } from './api-provider';
import { FyStamp } from './fy-stamp';
import { MobileNav } from './mobile-nav';
import { NavLinks } from './nav-links';
import { UserMenu } from './user-menu';

const Brand = () => (
  <Link href="/admin" prefetch={false} className="block px-3 leading-none">
    <span className="font-pd-serif text-[22px] font-semibold tracking-[-0.02em] text-pd-ink">ProDevly</span>
    <span className="pd-eyebrow ml-2 align-middle">Admin</span>
  </Link>
);

/**
 * The frame around every signed-in screen. Desktop: a paper-coloured sidebar (same ground as the
 * page, divided by a hairline, not a different colour) beside the content. Phone: a slim top bar
 * and the same navigation in a drawer. The skip link is the first focusable thing.
 */
export async function AdminShell({ admin, children }: { admin: SessionUser; children: React.ReactNode }) {
  const groups = visibleNav(admin.capabilities);
  const period = await getPeriod({});
  // A small red count on "My work" for tasks assigned since this browser last opened it. Never blocks the page.
  const newlyAssigned = await readMyVisit(admin.id).then((since) => countNewlyAssigned(admin, since)).catch(() => 0);
  const badges = { my: newlyAssigned };
  const roleLabel = admin.role === 'superadmin' ? 'Superadmin' : 'Admin';
  const footer = (
    <div className="flex flex-col gap-3">
      <FyStamp period={period} />
      <UserMenu name={admin.name} roleLabel={roleLabel} />
    </div>
  );

  return (
    <AdminProviders>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-pd-sm focus:bg-pd-ink focus:px-3 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <div className="lg:grid lg:min-h-svh lg:grid-cols-[15.5rem_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-svh flex-col overflow-y-auto border-r border-pd-rule px-3 pt-5 lg:flex">
          <div className="flex flex-col gap-7 pb-6">
            <Brand />
            <NavLinks groups={groups} badges={badges} />
          </div>
          {/* Pinned to the bottom of the sidebar, whatever the window height. */}
          <div className="sticky bottom-0 mt-auto border-t border-pd-rule bg-pd-paper pt-3 pb-4">{footer}</div>
        </aside>
        <div className="min-w-0">
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-pd-rule bg-pd-paper/95 px-4 backdrop-blur lg:hidden">
            <div className="flex items-center gap-3">
              <MobileNav groups={groups} footer={footer} badges={badges} />
              <Brand />
            </div>
          </header>
          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[84rem] px-4 pt-6 pb-16 outline-none sm:px-6 lg:px-10 lg:pt-9">
            {children}
          </main>
        </div>
      </div>
    </AdminProviders>
  );
}
