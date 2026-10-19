import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatInr } from '@/lib/admin/format';
import type { SessionUser } from '@/types/session';
import { actorOf, makeAuditEntries } from '@/test/audit-factories';
import { setupTestDb } from '@/test/db';
import { makeClient } from '@/test/domain-factories';
import { makeAdmin } from '@/test/factories';
import { FY27_FIGURES, holding, makeOverviewWorld, makeViewers, without } from '@/test/overview-factories';

/**
 * The Overview end to end against a real database: the guard, the URL, the service and the markup. Only the
 * framework edges are stubbed (the session cookie and the router hooks). The period is pinned through the URL so
 * the figures do not depend on the day the test runs.
 */
let signedIn: SessionUser;
let query = '';
const guardCalls: Array<{ returnTo?: string; options?: { capability?: string } }> = [];

vi.mock('@/lib/auth/page-guard', () => ({
  requireAdminPage: async (returnTo?: string, options?: { capability?: string }) => {
    guardCalls.push({ returnTo, options });
    return signedIn;
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(query),
}));

import OverviewPage from '../../page';

setupTestDb();

const FY27_URL = { period: 'custom', from: '2026-04-01', to: '2027-03-31' };

async function renderPage(params: Record<string, string> = FY27_URL) {
  query = new URLSearchParams(params).toString();
  return renderToStaticMarkup(await OverviewPage({ searchParams: Promise.resolve(params) }));
}

const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

beforeEach(() => {
  guardCalls.length = 0;
});

describe('the overview page for a superadmin', () => {
  it('asks the guard for dashboard:view on /admin', async () => {
    signedIn = (await makeViewers()).sa;
    await renderPage();
    expect(guardCalls).toEqual([{ returnTo: '/admin', options: { capability: 'dashboard:view' } }]);
  });

  it('leads with company net and shows every tile, chart and list with the figures from the records', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    signedIn = v.sa;
    const markup = await renderPage();
    const t = text(markup);

    for (const label of [
      'Company net', 'Received from clients', 'Paid to third parties', 'Expenses', 'Team payouts', 'Outstanding from clients', 'Payables',
      'Active projects', 'Overdue projects', 'Open tasks', 'Overdue tasks', 'New enquiries', 'Waiting for a first reply',
    ]) {
      expect(t).toContain(label);
    }
    // The band leads with company net: it is the first tile.
    expect(t.indexOf('Company net')).toBeLessThan(t.indexOf('Received from clients'));
    for (const figure of [FY27_FIGURES.net, FY27_FIGURES.received, FY27_FIGURES.thirdParties, FY27_FIGURES.expenses, FY27_FIGURES.team, FY27_FIGURES.outstanding]) {
      expect(t).toContain(formatInr(figure));
    }
    expect(t).toContain('At latest rates');

    for (const title of ['Cash in and out', 'Company net per month', 'Top projects by margin', 'Projects by status', 'Recent activity']) expect(t).toContain(title);
    expect(t).toContain('A one');
    expect(markup).toContain('href="/admin/audit"');
    expect(markup).toContain('id="period-preset"'); // the period picker
    // The empty-database hint is for an empty database only.
    expect(t).not.toContain('Add your first client');
  });

  it('describes the period it is showing', async () => {
    signedIn = (await makeViewers()).sa;
    expect(text(await renderPage())).toContain('2026-04-01 to 2027-03-31');
    expect(text(await renderPage({}))).toContain('This financial year');
  });

  it('shows the latest activity of everyone, and says so', async () => {
    const v = await makeViewers();
    const bob = await makeAdmin({ name: 'Bob Das' });
    await makeAuditEntries([{ actor: actorOf(bob), action: 'client.create', entity: { type: 'client', label: 'Bob client' } }]);
    signedIn = v.sa;
    const t = text(await renderPage());
    expect(t).toContain('Recent activity');
    expect(t).toContain('Bob Das');
    expect(t).toContain('Bob client');
  });
});

describe('the overview page for everyone else', () => {
  it('shows a plain admin the work tiles and their own activity, with no money anywhere', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    const alice = await makeAdmin({ name: 'Alice Rao' });
    await makeAuditEntries([
      { actor: actorOf(alice), action: 'client.create', entity: { type: 'client', label: 'Alice client' } },
      { actor: { id: v.sa.id, name: v.sa.name }, action: 'client.create', entity: { type: 'client', label: 'Not for Alice' } },
    ]);
    signedIn = v.plain;
    const t = text(await renderPage());
    for (const label of ['Active projects', 'Overdue projects', 'Open tasks', 'Overdue tasks', 'New enquiries', 'Waiting for a first reply', 'Projects by status']) {
      expect(t).toContain(label);
    }
    for (const gone of ['Company net', 'Received from clients', 'Paid to third parties', 'Team payouts', 'Outstanding from clients', 'Payables', 'Cash in', 'Cash out', 'Top projects by margin', 'Money']) {
      expect(t).not.toContain(gone);
    }
    expect(t).not.toContain(formatInr(FY27_FIGURES.received));
    expect(t).toContain('Your recent activity');
    expect(t).not.toContain('Not for Alice');
  });

  it('shows payment:view only the tiles that need it', async () => {
    const v = await makeViewers();
    await makeOverviewWorld();
    signedIn = v.cash;
    const t = text(await renderPage());
    expect(t).toContain('Received from clients');
    expect(t).toContain('Outstanding from clients');
    expect(t.indexOf('Received from clients')).toBeLessThan(t.indexOf('Outstanding from clients')); // received leads: no net
    expect(t).toContain('Cash in');
    expect(t).not.toContain('Cash in and out');
    expect(t).toContain('Top projects by margin');
    for (const gone of ['Company net', 'Paid to third parties', 'Expenses', 'Team payouts', 'Payables', 'Company net per month']) expect(t).not.toContain(gone);
  });

  it('shows nothing of the work sections to a viewer who may not open them', async () => {
    const v = await makeViewers();
    signedIn = holding(v.sa, 'dashboard:view', 'payment:view');
    const t = text(await renderPage());
    expect(t).toContain('Received from clients');
    for (const gone of ['Work and enquiries', 'Active projects', 'Open tasks', 'New enquiries', 'Projects by status', 'Top projects by margin']) expect(t).not.toContain(gone);
  });
});

describe('the overview page on an empty database', () => {
  it('shows zeros, an empty state for every chart, and the next step', async () => {
    signedIn = (await makeViewers()).sa;
    const markup = await renderPage();
    const t = text(markup);
    expect(t).toContain('No clients yet');
    expect(t).toContain('Add your first client');
    expect(markup).toContain('href="/admin/clients/new"');
    expect(t).toContain(formatInr(0));
    expect(t).toContain('No settled money in this period');
    expect(t).toContain('No projects yet');
    expect(t).toContain('No activity yet');
    expect(t).not.toContain('NaN');
    expect(t).not.toContain('undefined');
  });

  it('names no step the viewer cannot take', async () => {
    const v = await makeViewers();
    signedIn = without(v.plain, 'client:edit');
    const markup = await renderPage();
    expect(text(markup)).toContain('No clients yet');
    expect(markup).not.toContain('/admin/clients/new');
  });

  it('moves on to the first project once there is a client', async () => {
    const v = await makeViewers();
    await makeClient();
    signedIn = v.sa;
    const markup = await renderPage();
    expect(text(markup)).toContain('Add your first project');
    expect(markup).toContain('href="/admin/projects/new"');
    expect(markup).not.toContain('/admin/clients/new');
  });
});
