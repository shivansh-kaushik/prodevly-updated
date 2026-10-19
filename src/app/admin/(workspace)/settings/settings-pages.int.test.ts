import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminProviders } from '@/components/admin/api-provider';
import { createFxRate } from '@/services/fx.service';
import { updateSettings } from '@/services/settings.service';
import { setupTestDb } from '@/test/db';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { makeFxRate, makeLedgerEntry, moneyOf } from '@/test/settings-factories';
import type { SessionUser } from '@/types/session';
import FxRatesPage from './fx/page';
import SettingsListsPage from './lists/page';
import SettingsPage from './page';

setupTestDb();

const guard = vi.hoisted(() => ({ viewer: null as unknown, calls: [] as Array<{ path?: string; capability?: string }> }));

// The real guard reads the session cookie; here the viewer is chosen by the test. What matters is
// WHICH path and capability each page asks for, so those are recorded.
vi.mock('@/lib/auth/page-guard', () => ({
  getCurrentAdmin: async () => ({ admin: guard.viewer, hadCookie: true }),
  requireAdminPage: async (path?: string, options?: { capability?: string }) => {
    guard.calls.push({ path, capability: options?.capability });
    const viewer = guard.viewer as SessionUser;
    if (options?.capability && !viewer.capabilities.has(options.capability as never)) throw new Error('NOT_FOUND');
    return viewer;
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/admin/settings/fx',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

beforeEach(() => {
  guard.calls = [];
});

const render = async (page: (p: never) => Promise<React.ReactNode>, searchParams: Record<string, string> = {}) =>
  renderToStaticMarkup(h(AdminProviders, null, (await page({ searchParams: Promise.resolve(searchParams) } as never)) as React.ReactElement));

describe('the settings pages', () => {
  it('ask the guard for settings:edit on their own path, and refuse anyone without it', async () => {
    guard.viewer = await sessionFor(await makeAdmin({ grants: ['fx:edit'] }));
    await expect(render(SettingsPage as never)).rejects.toThrow('REDIRECT /admin/settings/fx');
    guard.viewer = await sessionFor(await makeAdmin());
    await expect(render(SettingsPage as never)).rejects.toThrow('NOT_FOUND');
    await expect(render(SettingsListsPage as never)).rejects.toThrow('NOT_FOUND');
    expect(guard.calls).toEqual([
      { path: '/admin/settings', capability: 'settings:edit' },
      { path: '/admin/settings/lists', capability: 'settings:edit' },
    ]);
  });

  it('send someone who can only edit rates (the sidebar link points at /admin/settings for them) to the rates page, not a 404', async () => {
    guard.viewer = await sessionFor(await makeAdmin({ grants: ['fx:edit'] }));
    await expect(render(SettingsPage as never)).rejects.toThrow('REDIRECT /admin/settings/fx');
    guard.viewer = await sessionFor(await makeAdmin());
    await expect(render(SettingsPage as never)).rejects.toThrow('NOT_FOUND'); // nothing to offer: hidden, not forbidden
  });

  it('render the general form and the lists from what is stored, with the change history beside them', async () => {
    const sa = await makeSuperadmin();
    guard.viewer = await sessionFor(sa);
    await updateSettings(guard.viewer as SessionUser, { orgName: 'Acme Studio', paymentModes: ['Razorpay', 'cash'] });

    const general = await render(SettingsPage as never);
    expect(general).toContain('value="Acme Studio"');
    expect(general).toContain('Recent changes');
    expect(general).toContain(sa.name);
    expect(general).toMatch(/updated\s+<span[^>]*>Organisation settings<\/span>/); // the feed's phrase, then the entry's own label

    const lists = await render(SettingsListsPage as never);
    expect(lists).toContain('Razorpay');
    expect(lists).toContain('razorpay');
    expect(lists).toContain('Enquiry budget ranges');
  });
});

describe('the FX rates page', () => {
  it('is open to a plain admin for reading: the rates, no edit controls, no ledger tile, no history panel', async () => {
    await makeFxRate({ currency: 'USD', on: '2026-10-09', rate: 83.42, source: 'ecb' });
    guard.viewer = await sessionFor(await makeAdmin());
    const html = await render(FxRatesPage as never, { period: 'custom', from: '2026-10-01', to: '2026-10-31' });
    expect(guard.calls).toEqual([{ path: '/admin/settings/fx', capability: undefined }]);
    expect(html).toContain('83.42');
    expect(html).toContain('Latest rate per currency');
    expect(html).toContain('You can read rates here.');
    expect(html).not.toContain('Add rate');
    expect(html).not.toContain('Edit USD rate');
    expect(html).not.toContain('On a manual or bank rate');
    expect(html).not.toContain('Recent rate changes');
    expect(html).not.toContain('aria-label="Settings"'); // no tabs for someone who can only read
  });

  it('gives a superadmin the whole page: tiles, latest rates, chart, table with edit buttons, tabs and history', async () => {
    const sa = await makeSuperadmin();
    guard.viewer = await sessionFor(sa);
    await createFxRate(guard.viewer as SessionUser, { currency: 'EUR', rateOn: '2026-10-09', rate: 91.2 });
    await makeFxRate({ currency: 'USD', on: '2026-10-09', rate: 83.42, source: 'ecb' });
    await makeLedgerEntry('clientPayment', { amount: moneyOf('manual'), on: '2026-10-09' });
    const html = await render(FxRatesPage as never, { period: 'custom', from: '2026-10-01', to: '2026-10-31' });

    for (const text of ['Rates out of date', 'Currencies tracked', 'On a manual or bank rate', 'Client payments 1', 'Latest rate per currency', 'Rate history, USD']) {
      expect(html).toContain(text);
    }
    expect(html).toContain('Add rate');
    expect(html).toContain('Edit EUR rate for 9 Oct 2026');
    expect(html).toContain('Recent rate changes');
    expect(html).toContain('aria-label="Settings"');
    expect(html).toContain('Search currency or person');
  });

  it('shows the empty states on a fresh database instead of zeros that look like data', async () => {
    guard.viewer = await sessionFor(await makeSuperadmin());
    const html = await render(FxRatesPage as never);
    expect(html).toContain('No rates in this period');
    expect(html).toContain('No records yet'); // the chart
    expect(html).toContain('No rate'); // every currency is missing
    expect(html).toContain('None in FY');
  });

  it('applies the currency and source filters to the table', async () => {
    guard.viewer = await sessionFor(await makeSuperadmin());
    await makeFxRate({ currency: 'USD', on: '2026-10-09', rate: 83.42, source: 'ecb' });
    await makeFxRate({ currency: 'EUR', on: '2026-10-09', rate: 91.2 });
    const eur = await render(FxRatesPage as never, { period: 'custom', from: '2026-10-01', to: '2026-10-31', currency: 'EUR' });
    expect(eur).toContain('Edit EUR rate');
    expect(eur).not.toContain('Edit USD rate');
    const ecb = await render(FxRatesPage as never, { period: 'custom', from: '2026-10-01', to: '2026-10-31', source: 'ecb' });
    expect(ecb).toContain('Edit USD rate');
    expect(ecb).not.toContain('Edit EUR rate');
    const none = await render(FxRatesPage as never, { period: 'custom', from: '2026-10-01', to: '2026-10-31', q: 'zzz' });
    expect(none).toContain('No rates match');
  });
});
