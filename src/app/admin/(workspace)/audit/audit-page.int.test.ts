import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@/types/session';
import { actorOf, makeAuditEntries } from '@/test/audit-factories';
import { setupTestDb } from '@/test/db';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';

/**
 * The page end to end against a real database: the guard, the URL, the services and the markup.
 * Only the framework edges are stubbed (the session cookie, the router hooks and the client's API).
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
  usePathname: () => '/admin/audit',
  useSearchParams: () => new URLSearchParams(query),
}));
vi.mock('@/components/admin/api-provider', () => ({ useAdminApi: () => ({ call: async () => ({ items: [] }) }) }));

import AuditPage from './page';

setupTestDb();

async function renderPage(params: Record<string, string> = {}) {
  query = new URLSearchParams(params).toString();
  const element = await AuditPage({ searchParams: Promise.resolve(params) });
  return renderToStaticMarkup(element);
}

/** An entry a month before "now", so it sits in the current financial year whenever the test runs. */
const recently = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

beforeEach(() => {
  guardCalls.length = 0;
});

describe('the audit page', () => {
  it('opens for any signed-in admin: the guard asks for sign-in, not for a capability', async () => {
    signedIn = await sessionFor(await makeAdmin());
    await renderPage();
    expect(guardCalls).toEqual([{ returnTo: '/admin/audit', options: undefined }]);
  });

  it('explains the scope to a superadmin and shows everyone\'s entries', async () => {
    const sa = await makeSuperadmin({ name: 'Sara Admin' });
    const alice = await makeAdmin({ name: 'Alice Rao' });
    const bob = await makeAdmin({ name: 'Bob Das' });
    await makeAuditEntries([
      { at: recently(1), actor: actorOf(alice), action: 'client.create', entity: { type: 'client', label: 'Alice client' } },
      { at: recently(2), actor: actorOf(bob), action: 'client.create', entity: { type: 'client', label: 'Bob client' } },
    ]);
    signedIn = await sessionFor(sa);
    const html = await renderPage();
    expect(html).toContain('Everything that happened');
    expect(html).toContain('Everyone');
    expect(html).toContain('Alice client');
    expect(html).toContain('Bob client');
    expect(html).toContain('2 entries');
    expect(html).toContain('Any person'); // the person picker is offered
    expect(html).toContain('Actions by person');
  });

  it('explains the scope to everyone else and shows only their own entries, whatever the URL asks for', async () => {
    const alice = await makeAdmin({ name: 'Alice Rao' });
    const bob = await makeAdmin({ name: 'Bob Das' });
    await makeAuditEntries([
      { at: recently(1), actor: actorOf(alice), action: 'client.create', entity: { type: 'client', label: 'Alice client' } },
      { at: recently(2), actor: actorOf(bob), action: 'client.create', entity: { type: 'client', label: 'Bob client' } },
    ]);
    signedIn = await sessionFor(alice);

    const attempts: Array<Record<string, string>> = [{}, { actor: String(bob._id) }, { q: 'Bob client' }];
    for (const params of attempts) {
      const html = await renderPage(params);
      expect(html).toContain('Your activity');
      expect(html).toContain('Only you');
      expect(html).not.toContain('Everything that happened');
      // as rendered entry text (the search box echoes what was typed, which is not an entry)
      expect(html).not.toContain('>Bob client<');
      expect(html).not.toContain('Bob Das');
      expect(html).not.toContain('Any person'); // no person picker
      expect(html).not.toContain('Actions by person');
    }
    expect(await renderPage()).toContain('Alice client');
    // asking for another person is not a "filtered" view for someone who cannot pick people
    expect(await renderPage({ actor: String(bob._id) })).not.toContain('No entries match');
  });

  it('shows the request id to the person and, only to a superadmin, the start of the IP hash', async () => {
    const sa = await makeSuperadmin();
    const alice = await makeAdmin({ name: 'Alice Rao' });
    await makeAuditEntries([
      { at: recently(1), actor: actorOf(alice), action: 'task.create', entity: { type: 'task', label: 'A task' }, requestId: 'req-5e5e5e', ipHash: 'f00dfeedcafe0123456789abcdef', userAgent: 'SecretBrowser/1.0' },
    ]);
    signedIn = await sessionFor(alice);
    const own = await renderPage();
    expect(own).toContain('Request req-5e5e5e');
    expect(own).not.toContain('IP hash');
    expect(own).not.toContain('f00dfeedcafe');

    signedIn = await sessionFor(sa);
    const all = await renderPage();
    expect(all).toContain('Request req-5e5e5e');
    expect(all).toContain('IP hash f00dfeedcafe');
    expect(all).not.toContain('f00dfeedcafe0123456789abcdef'); // shortened
    expect(all).not.toContain('SecretBrowser'); // the user agent is never shown
  });

  it('says what is missing, and offers the next step, when the log is empty or a filter matches nothing', async () => {
    signedIn = await sessionFor(await makeSuperadmin());
    expect(await renderPage()).toContain('Nothing recorded in this period');
    const lastFy = await renderPage({ period: 'last_fy' });
    expect(lastFy).toContain('Nothing recorded in this period');
    expect(lastFy).toContain('Show this financial year');

    await makeAuditEntries([{ at: recently(1), action: 'client.create', entity: { type: 'client', label: 'Acme' } }]);
    const none = await renderPage({ q: 'zzz', period: 'this_fy' });
    expect(none).toContain('No entries match');
    expect(none).toContain('Clear filters');
    expect(none).toContain('href="/admin/audit?period=this_fy"'); // the search is cleared, the period stays
  });

  it('keeps the period when filters are cleared', async () => {
    signedIn = await sessionFor(await makeSuperadmin());
    const html = await renderPage({ q: 'zzz', period: 'this_month' });
    expect(html).toContain('href="/admin/audit?period=this_month"');
  });

  it('reads the URL defensively: junk ids, junk actions and a page far past the end still render', async () => {
    const sa = await makeSuperadmin();
    await makeAuditEntries(Array.from({ length: 3 }, (_, i) => ({ at: recently(i + 1), action: 'client.create', entity: { type: 'client', label: `Client ${i}` } })));
    signedIn = await sessionFor(sa);
    const html = await renderPage({ actor: 'nope', client: '12', project: '$ne', action: '{"$ne":1}', entity: '<script>', page: '999', sort: 'x' });
    expect(html).toContain('Client 0');
    expect(html).not.toContain('<script>');
  });

  it('pages the list and shows the total', async () => {
    signedIn = await sessionFor(await makeSuperadmin());
    await makeAuditEntries(Array.from({ length: 27 }, (_, i) => ({ at: recently(1 + i / 100), action: 'task.update', entity: { type: 'task', label: `Task ${i}` } })));
    const first = await renderPage();
    expect(first).toContain('27 entries');
    expect(first).toContain('Showing 1-25 of 27 entries');
    expect(first).toContain('Next page');
    const second = await renderPage({ page: '2' });
    expect(second).toContain('Showing 26-27 of 27 entries');
    expect(second).toContain('Previous page');
  });

  it('shows the names of the selected filters, and the exact action as chosen from the menu', async () => {
    signedIn = await sessionFor(await makeSuperadmin());
    await makeAuditEntries([{ at: recently(1), action: 'payment.void', entity: { type: 'payment', label: 'Receipt' } }]);
    const html = await renderPage({ action: 'payment.void', entity: 'payment' });
    expect(html).toContain('Voided payment'); // the menu option, by its readable name
    expect(html).toContain('Receipt');
  });
});
