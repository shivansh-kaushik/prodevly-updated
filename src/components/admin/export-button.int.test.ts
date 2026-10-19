import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AdminProviders } from '@/components/admin/api-provider';
import { setupTestDb } from '@/test/db';
import { makeExportWorld } from '@/test/export-factories';
import { makeAdmin, sessionFor } from '@/test/factories';
import type { SessionUser } from '@/types/session';

/**
 * The list pages against a real database, with the real providers around them: the export button shows for a viewer
 * who holds export:data and for nobody else, and never changes what else the page shows. Only the framework edges
 * (the session guard and the router hooks) are stubbed.
 */
let signedIn: SessionUser;

vi.mock('@/lib/auth/page-guard', () => ({
  requireAdminPage: async () => signedIn,
  getCurrentAdmin: async () => ({ admin: signedIn, hadCookie: true }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  usePathname: () => '/admin/clients',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import AuditPage from '@/app/admin/(workspace)/audit/page';
import ClientsPage from '@/app/admin/(workspace)/clients/page';
import EnquiriesPage from '@/app/admin/(workspace)/enquiries/page';
import PaymentsPage from '@/app/admin/(workspace)/payments/page';
import WorkLogsPage from '@/app/admin/(workspace)/work-logs/page';

setupTestDb();

const html = (node: ReactElement) => renderToStaticMarkup(h(AdminProviders, null, node));
const clients = async () => html(await ClientsPage({ searchParams: Promise.resolve({}) }));

describe('the export button on a list page', () => {
  it('shows for a superadmin, next to the page\'s own action', async () => {
    const w = await makeExportWorld();
    signedIn = w.sa;
    const markup = await clients();
    expect(markup).toContain('Export CSV');
    expect(markup).toContain('New client');
    // The export comes first, so the primary action stays rightmost.
    expect(markup.indexOf('Export CSV')).toBeLessThan(markup.indexOf('New client'));
  });

  it('does not show for an admin who holds no export grant, and the page is otherwise the same', async () => {
    const w = await makeExportWorld();
    signedIn = w.devSession;
    const markup = await clients();
    expect(markup).not.toContain('Export CSV');
    expect(markup).toContain('New client');
    expect(markup).toContain('Acme Studio');
  });

  it('shows for an admin who was granted export:data, and leaves an empty actions area out for one who has nothing to offer', async () => {
    const w = await makeExportWorld();
    const granted = await makeAdmin({ grants: ['export:data'] });
    signedIn = await sessionFor(granted);
    expect(await clients()).toContain('Export CSV');

    const viewOnly = { ...w.devSession, capabilities: new Set(['client:view' as const]) };
    signedIn = viewOnly;
    const markup = await clients();
    expect(markup).not.toContain('Export CSV');
    expect(markup).not.toContain('New client');
    // PageHeader renders its actions wrapper only when it is given something.
    expect(markup).not.toContain('<div class="flex flex-wrap items-center gap-2"></div>');
  });

  it('is on the audit log for an admin with export:data (their own trail), and absent without it', async () => {
    const w = await makeExportWorld();
    const granted = await makeAdmin({ grants: ['export:data'] });
    const render = async () => html(await AuditPage({ searchParams: Promise.resolve({}) }));
    signedIn = await sessionFor(granted);
    expect(await render()).toContain('Export CSV');
    signedIn = w.devSession;
    expect(await render()).not.toContain('Export CSV');
  });

  it('is on the enquiries, payments and work-log pages only for a holder of export:data', async () => {
    const w = await makeExportWorld();
    const pages = [
      () => EnquiriesPage({ searchParams: Promise.resolve({}) }),
      () => PaymentsPage({ searchParams: Promise.resolve({}) }),
      () => WorkLogsPage({ searchParams: Promise.resolve({}) }),
    ];
    signedIn = w.sa;
    for (const page of pages) expect(html(await page())).toContain('Export CSV');
    signedIn = { ...w.sa, capabilities: new Set([...w.sa.capabilities].filter((c) => c !== 'export:data')) };
    for (const page of pages) expect(html(await page())).not.toContain('Export CSV');
  });
});
