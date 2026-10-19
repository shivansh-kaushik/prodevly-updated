import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AdminProviders } from '@/components/admin/api-provider';
import { FxField } from '@/components/admin/fx-field';
import { TABLE_FX } from '@/components/admin/fx-field-model';
import { GeneralForm } from './general-form';
import { LatestRates } from './latest-rates';
import { ListsForm } from './lists-form';
import { RatesTable } from './rates-table';
import { SettingsNav } from './settings-nav';

// The screens are client components that need the app router and the admin providers. These tests
// render their first paint to HTML, which catches broken props, hook misuse and missing labels
// without a browser. Behaviour that needs events (typing, saving) is covered by the services' tests.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/admin/settings',
  useSearchParams: () => new URLSearchParams(),
}));

const render = (node: ReactElement) => renderToStaticMarkup(h(AdminProviders, null, node));

const GENERAL = {
  orgName: 'ProDevly',
  timezone: 'Asia/Kolkata',
  fyStartMonth: 4,
  workLogEditWindowDays: 7,
  fxStaleDays: 7,
  enabledCurrencies: ['INR', 'USD', 'EUR'],
};

describe('settings navigation', () => {
  it('shows three tabs to a superadmin, marks the current one, and nothing at all to a viewer who can only read rates', () => {
    const full = renderToStaticMarkup(h(SettingsNav, { active: 'lists', canEditSettings: true }));
    expect(full).toContain('href="/admin/settings"');
    expect(full).toContain('href="/admin/settings/lists"');
    expect(full).toContain('href="/admin/settings/fx"');
    expect(full.match(/aria-current="page"/g)).toHaveLength(1);
    expect(full).toMatch(/aria-current="page"[^>]*>Lists/);
    expect(renderToStaticMarkup(h(SettingsNav, { active: 'fx', canEditSettings: false }))).toBe('');
  });
});

describe('general settings form', () => {
  const html = render(h(GeneralForm, { initial: GENERAL, zones: ['Asia/Kolkata', 'UTC'] }));

  it('labels every control and fills them from the saved values', () => {
    for (const label of ['Organisation name', 'Time zone', 'Financial year starts in', 'Work-log edit window (days)', 'Exchange rate may be this old (days)']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('value="ProDevly"');
    expect(html).toContain('value="Asia/Kolkata"');
    expect(html).toMatch(/<option value="4" selected="">April<\/option>/);
    expect(html).toContain('April to March');
    expect(html).toContain('<option value="Asia/Kolkata">');
  });

  it('shows INR as always on, and ticks the enabled currencies only', () => {
    const box = (code: string) => new RegExp(`<input[^>]*type="checkbox"[^>]*>\\s*${code}`).exec(html)?.[0] ?? '';
    expect(box('INR')).toContain('disabled');
    expect(box('INR')).toContain('checked');
    expect(box('USD')).toContain('checked');
    expect(box('USD')).not.toContain('disabled');
    expect(box('GBP')).not.toContain('checked');
  });

  it('starts with Save disabled: nothing has changed yet', () => {
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save settings/);
  });
});

describe('lists form', () => {
  it('shows each list as people read it, with the code beside it, and keeps the last required item from being removed', () => {
    const html = render(
      h(ListsForm, {
        initial: { paymentModes: ['bank_transfer'], expenseCategories: ['travel', 'office'], thirdPartyTypes: ['freelancer'], budgetRanges: [] },
      }),
    );
    for (const title of ['Payment modes', 'Expense categories', 'Third-party types', 'Enquiry budget ranges']) expect(html).toContain(title);
    expect(html).toContain('Bank transfer');
    expect(html).toContain('bank_transfer');
    expect(html).toContain('No budget ranges yet.');
    expect(html).toMatch(/aria-label="Bank transfer cannot be removed: keep at least 1"[^>]*disabled=""/);
    expect(html).toMatch(/aria-label="Remove Travel"/);
    expect(html).toContain('Add a payment mode');
  });
});

describe('latest rates and the rate table', () => {
  it('flags stale and missing currencies in words, not colour alone', () => {
    const html = renderToStaticMarkup(
      h(LatestRates, {
        staleDays: 7,
        canEditSettings: true,
        rows: [
          { currency: 'USD', rate: 83.42, rateOn: '2026-10-10', source: 'ecb', ageDays: 2, status: 'current' },
          { currency: 'EUR', rate: 90.5, rateOn: '2026-10-01', source: 'manual', ageDays: 11, status: 'stale' },
          { currency: 'GBP', rate: null, rateOn: null, source: null, ageDays: null, status: 'missing' },
        ],
      }),
    );
    expect(html).toContain('83.42');
    expect(html).toContain('10 Oct 2026');
    expect(html).toContain('2 days ago, ECB');
    expect(html).toContain('Current');
    expect(html).toContain('Out of date');
    expect(html).toContain('No rate');
  });

  it('explains an INR-only setup and points a superadmin to the setting', () => {
    const html = renderToStaticMarkup(h(LatestRates, { rows: [], staleDays: 7, canEditSettings: true }));
    expect(html).toContain('Only INR is turned on');
    expect(html).toContain('href="/admin/settings"');
    expect(renderToStaticMarkup(h(LatestRates, { rows: [], staleDays: 7, canEditSettings: false }))).not.toContain('href="/admin/settings"');
  });

  const row = { id: '5f3a9c0b1d2e4f6a8b7c9d0e', currency: 'USD', rateOn: '2026-10-12', rate: 83.42, source: 'manual' as const, enteredBy: 'Aman Gupta', createdAt: '', updatedAt: '' };

  it('offers edit buttons only to people who may edit', () => {
    const base = { rows: [row], currencies: ['USD', 'EUR'], today: '2026-10-12', filtered: false };
    const editor = render(h(RatesTable, { ...base, canEdit: true }));
    expect(editor).toContain('Edit USD rate for 12 Oct 2026');
    expect(editor).toContain('83.42');
    expect(editor).toContain('Aman Gupta');
    expect(render(h(RatesTable, { ...base, canEdit: false }))).not.toContain('Edit USD rate');
  });

  it('says what is missing when the table is empty, and what to do next', () => {
    const base = { rows: [], currencies: ['USD'], today: '2026-10-12' };
    expect(render(h(RatesTable, { ...base, canEdit: true, filtered: false }))).toContain('Add rate');
    expect(render(h(RatesTable, { ...base, canEdit: false, filtered: false }))).toContain('someone with FX access');
    expect(render(h(RatesTable, { ...base, canEdit: true, filtered: true }))).toContain('Clear filters');
  });
});

describe('FxField first paint', () => {
  const field = (props: Partial<Parameters<typeof FxField>[0]>) =>
    render(h(FxField, { currency: 'USD', amountMinor: 100_000, date: '2026-10-12', value: TABLE_FX as never, onChange: () => {}, ...props }));

  it('renders nothing for INR: there is no rate to choose', () => {
    const html = field({ currency: 'INR' });
    // (the providers' own step-up dialog is in the markup; the field's controls are not)
    expect(html).not.toContain('Exchange rate');
    expect(html).not.toContain('Table rate');
  });

  it('offers the three ways to convert, with the table rate selected, and a lookup line', () => {
    const html = field({});
    for (const label of ['Table rate', 'Exact rate', 'INR received']) expect(html).toContain(label);
    expect(html).toMatch(/<input[^>]*type="radio"[^>]*checked=""[^>]*>Table rate/);
    expect(html).toContain('Looking up the rate...');
  });

  it('asks for a date before it can look anything up', () => {
    expect(field({ date: null })).toContain('Choose the date to see the table rate.');
  });

  it('shows the input and the sum for a typed rate, and the derived rate for a bank figure', () => {
    const manual = field({ value: { choice: 'manual', manualRate: '83.5', settledInr: '' } });
    expect(manual).toContain('Rate the bank used (INR per 1 USD)');
    expect(manual).toContain('USD 1,000.00 = INR 83,500.00 at 83.5 (the rate you entered)');
    const bank = field({ value: { choice: 'bank', manualRate: '', settledInr: '83,420.00' } });
    expect(bank).toContain('INR that arrived, after bank charges');
    expect(bank).toContain('USD 1,000.00 = INR 83,420.00 at 83.42 (worked out from the INR that arrived)');
  });

  it('shows a server error in place, with an alert role', () => {
    const html = field({ error: 'Enter the exchange rate' });
    expect(html).toMatch(/role="alert"[^>]*>Enter the exchange rate/);
  });
});
