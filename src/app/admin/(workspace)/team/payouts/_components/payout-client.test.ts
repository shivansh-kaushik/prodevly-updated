import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PayoutSuggestionDTO, TeamPayoutDTO } from '@/services/team-payout.service';
import type { PayProfileDTO } from '@/services/pay-profile.service';
import { PaySection } from '../../[adminId]/_components/pay-section';
import { AllocationEditor, type AllocationRow } from './allocation-editor';
import { PayoutActions, type ActionsPayout } from './payout-actions';
import { PayoutForm } from './payout-form';
import { PayoutsTable } from './payouts-table';
import { PayoutTotalsBand } from './payout-totals';
import { SuggestionPanel } from './suggestion-panel';

// The client components read the router, the API provider and the toast context. None matters for what is rendered, so they are
// replaced: what these tests check is WHAT EACH STATE SHOWS (the effects and clicks are exercised through the services and routes).
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/components/admin/api-provider', () => ({ useAdminApi: () => ({ call: vi.fn() }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ show: vi.fn() }) }));

const html = (el: unknown) => renderToStaticMarkup(el as never);

const rows: AllocationRow[] = [
  { projectId: 'p1', label: 'Alpha site', ref: 'PRJ-0001', minutes: 150, amount: '30,000.00' },
  { projectId: 'p2', label: 'Beta app', ref: 'PRJ-0002', minutes: 0, amount: '' },
];

const editor = (over: Partial<Parameters<typeof AllocationEditor>[0]> = {}) =>
  html(createElement(AllocationEditor, { rows, onChange: () => {}, onPropose: () => {}, currency: 'INR', amountMinor: 5_000_000, errors: {}, ...over }));

describe('AllocationEditor', () => {
  it('lists each project with its time, an amount box named for it, a remove button, and the remainder as company overhead', () => {
    const out = editor();
    expect(out).toContain('Alpha site');
    expect(out).toContain('PRJ-0001');
    expect(out).toContain('2h 30m logged');
    expect(out).toContain('No time logged');
    expect(out).toContain('aria-label="INR amount for Alpha site"');
    expect(out).toContain('Remove Alpha site');
    expect(out).toContain('Share by logged time');
    expect(out).toContain('Add a project');
    expect(out).toContain('₹30,000.00'); // charged
    expect(out).toContain('₹20,000.00'); // overhead: 50,000 - 30,000
    expect(out).toContain('Company overhead');
  });

  it('says plainly when the split is over the payout, and when there is no amount yet', () => {
    expect(editor({ amountMinor: 2_000_000 })).toContain('Over by ₹10,000.00');
    expect(editor({ amountMinor: null })).toContain('Enter the amount');
  });

  it('says that everything is overhead when nothing is charged to a project', () => {
    const out = editor({ rows: [] });
    expect(out).toContain('all of this payout is company overhead');
    expect(out).toContain('₹50,000.00'); // the whole amount is overhead
  });

  it('shows a row\'s server error in place, and an amount that is not an amount before the server does', () => {
    expect(editor({ errors: { 'allocations.0.amountMinor': 'Enter an amount above zero' } })).toContain('Enter an amount above zero');
    expect(editor({ errors: { allocations: 'The split is more than the payout.' } })).toContain('The split is more than the payout.');
    expect(editor({ rows: [{ ...rows[0]!, amount: '12,50' }] })).toContain('Enter an amount like 1,250.00');
  });

  it('uses the payout currency for amounts and the overhead', () => {
    const out = editor({ currency: 'USD', amountMinor: 100_000, rows: [{ ...rows[0]!, amount: '400.00' }] });
    expect(out).toContain('aria-label="USD amount for Alpha site"');
    expect(out).toContain('$400.00');
    expect(out).toContain('$600.00');
  });
});

const suggestion = (over: Partial<PayoutSuggestionDTO> = {}): PayoutSuggestionDTO => ({
  adminId: 'a1',
  adminName: 'Asha Rao',
  periodFrom: '2026-04-01',
  periodTo: '2026-04-30',
  terms: { basis: 'hourly', rateMinor: 120_000, currency: 'INR' },
  payoutBasis: 'hours',
  minutes: 240,
  taskCount: 3,
  computedMinor: 480_000,
  suggestion: null,
  projects: [],
  proposedAllocations: [],
  warnings: [],
  ...over,
});

describe('SuggestionPanel', () => {
  const panel = (state: Parameters<typeof SuggestionPanel>[0]['state'], amountMinor: number | null = null) =>
    html(createElement(SuggestionPanel, { state, amountMinor, currency: 'INR', onUse: () => {} }));

  it('waits for a person and a period, shows a placeholder while loading, and reports a failure without blocking', () => {
    expect(panel({ data: null, loading: false, enabled: false })).toContain('Pick a person and a period');
    const loading = panel({ data: null, loading: true, enabled: true });
    expect(loading).toContain('aria-busy="true"');
    expect(loading).not.toContain('Pick a person');
    expect(panel({ data: null, loading: false, enabled: true, error: 'We could not load the proposal.' })).toContain('You can still enter the amount yourself');
  });

  it('shows the terms, the facts and the proposed amount, with a button only when the form holds another amount', () => {
    const state = { data: suggestion(), loading: false, enabled: true };
    const out = panel(state, 100);
    expect(out).toContain('₹1,200.00 per hour');
    expect(out).toContain('4h'); // time logged
    expect(out).toContain('₹4,800.00'); // 240 minutes at INR 1,200 an hour
    expect(out).toContain('Use this amount');
    expect(panel(state, 480_000)).not.toContain('Use this amount'); // already the proposed amount
  });

  it('says no amount is proposed for a person with no pay basis, and lists the warnings', () => {
    const out = panel({ data: suggestion({ terms: null, computedMinor: null, warnings: ['Asha Rao had no pay basis during this period, so no amount is proposed.'] }), loading: false, enabled: true });
    expect(out).toContain('No amount is proposed. Enter the amount yourself.');
    expect(out).toContain('had no pay basis during this period');
    expect(out).not.toContain('Use this amount');
  });

  it('does not offer a zero amount, and says nothing has been earned', () => {
    const out = panel({ data: suggestion({ computedMinor: 0, minutes: 0 }), loading: false, enabled: true });
    expect(out).toContain('Nothing has been earned in this period yet');
    expect(out).not.toContain('Use this amount');
  });
});

const initial = {
  person: { id: 'a1', label: 'Asha Rao' },
  basis: 'salary',
  periodFrom: '2026-04-01',
  periodTo: '2026-04-30',
  money: { amount: '50000.00', currency: 'INR' },
  dueOn: '2026-05-05',
  note: 'April',
};

describe('PayoutForm', () => {
  it('records a new payout: the person, the period, the amount, the rate, the split and the note, with a submit and a cancel', () => {
    const out = html(createElement(PayoutForm, { mode: 'create', currencies: ['INR', 'USD'], initial: { ...initial, person: null, money: { amount: '', currency: 'INR' }, note: '' } }));
    for (const text of ['Person', 'Kind of payout', 'Period from', 'Period to', 'Amount', 'Due on', 'Charge to projects', 'Note', 'Record payout', 'Cancel', 'Pick a person and a period']) {
      expect(out, text).toContain(text);
    }
    for (const basis of ['Salary', 'Hours worked', 'Tasks completed', 'Bonus', 'Other']) expect(out).toContain(basis);
    expect(out).not.toContain('Exchange rate'); // INR needs none
    expect(out).toContain('href="/admin/team/payouts"');
  });

  it('shows the exchange-rate choice for a foreign currency', () => {
    const out = html(createElement(PayoutForm, { mode: 'create', currencies: ['INR', 'USD'], initial: { ...initial, money: { amount: '1000.00', currency: 'USD' } } }));
    expect(out).toContain('Exchange rate');
    expect(out).toContain('Table rate');
    expect(out).toContain('INR received');
  });

  it('edits a due payout from its stored values: the person is fixed, the split is the stored one, and it saves changes', () => {
    const out = html(
      createElement(PayoutForm, {
        mode: 'edit',
        payoutId: 'p9',
        currencies: ['INR'],
        initial: { ...initial, rows: [{ projectId: 'p1', label: 'Alpha site', ref: 'PRJ-0001', minutes: 90, amount: '20000.00' }] },
      }),
    );
    expect(out).toContain('Save changes');
    expect(out).toContain('To pay someone else, void this payout and record a new one.');
    expect(out).toContain('value="Asha Rao"');
    expect(out).toContain('disabled=""'); // the person picker
    expect(out).toContain('Alpha site');
    expect(out).toContain('value="20000.00"');
    expect(out).toContain('value="50000.00"');
    expect(out).toContain('href="/admin/team/payouts/p9"'); // cancel goes back to the payout
  });
});

const payout = (over: Partial<ActionsPayout> = {}): ActionsPayout => ({
  id: 'p1',
  ref: 'TMP-FY27-0001',
  status: 'due',
  adminName: 'Asha Rao',
  amountMinor: 5_000_000,
  currency: 'INR',
  periodFrom: '2026-04-01',
  periodTo: '2026-04-30',
  logsToLock: 3,
  lockedLogs: null,
  warnings: [],
  ...over,
});

const actions = (p: ActionsPayout, caps: { canEdit?: boolean; canPay?: boolean; canVoid?: boolean } = {}) =>
  html(createElement(PayoutActions, { payout: p, canEdit: true, canPay: true, canVoid: true, ...caps, paymentModes: ['bank_transfer', 'upi'], today: '2026-10-12' }));

describe('PayoutActions', () => {
  it('a due payout offers edit, mark paid and void; the pay dialog asks for date, mode and reference and says it locks time', () => {
    const out = actions(payout());
    expect(out).toMatch(/Edit<\/a>/);
    expect(out).toMatch(/Mark paid<\/button>/);
    expect(out).toMatch(/Void<\/button>/);
    expect(out).toContain('href="/admin/team/payouts/p1/edit"');
    for (const text of ['Paid on', 'Payment mode', 'Transaction reference', 'Bank transfer', 'UPI']) expect(out, text).toContain(text);
    expect(out).toContain('This locks 3 of Asha Rao&#x27;s time entries from 1 Apr 2026 to 30 Apr 2026.');
    expect(out).toContain('max="2026-10-12"'); // cannot be paid in the future
    expect(out).not.toContain('Exchange rate');
  });

  it('a foreign payout shows the exchange-rate choice for the paid date, and warnings are shown before paying', () => {
    const out = actions(payout({ currency: 'USD', amountMinor: 100_000, warnings: ['This period overlaps TMP-FY27-0002.'] }));
    expect(out).toContain('Exchange rate');
    expect(out).toContain('This period overlaps TMP-FY27-0002.');
  });

  it('says so when there is no time to lock', () => {
    expect(actions(payout({ logsToLock: 0 }))).toContain('has no time logged from 1 Apr 2026 to 30 Apr 2026 that this would lock');
  });

  it('a paid payout can only be voided, and says how many entries that releases', () => {
    const out = actions(payout({ status: 'paid', lockedLogs: 1, logsToLock: null }));
    expect(out).not.toMatch(/Edit<\/a>/);
    expect(out).not.toMatch(/Mark paid<\/button>/);
    expect(out).toMatch(/Void<\/button>/);
    expect(out).toContain('The 1 time entry it locked is released.');
  });

  it('a void payout offers nothing, and each button needs its own capability', () => {
    expect(actions(payout({ status: 'void' }))).not.toMatch(/Edit<\/a>|Mark paid|Void/);
    const nothing = actions(payout(), { canEdit: false, canPay: false, canVoid: false });
    expect(nothing).not.toMatch(/Edit<\/a>|Mark paid|Void/);
    const payOnly = actions(payout(), { canEdit: false, canVoid: false });
    expect(payOnly).toMatch(/Mark paid<\/button>/);
    expect(payOnly).not.toMatch(/Void<\/button>|Edit<\/a>/);
  });
});

const dto = (over: Partial<TeamPayoutDTO> = {}): TeamPayoutDTO => ({
  id: 'p1',
  ref: 'TMP-FY27-0001',
  adminId: 'a1',
  adminName: 'Asha Rao',
  basis: 'salary',
  periodFrom: '2026-04-01',
  periodTo: '2026-04-30',
  amount: { amountMinor: 5_000_000, currency: 'INR', fxRate: 1, fxDate: '2026-05-05', fxSource: 'identity', inrMinor: 5_000_000 },
  status: 'due',
  dueOn: '2026-05-05',
  paidOn: null,
  mode: null,
  transactionRef: null,
  createdAt: '2026-05-01T00:00:00.000Z',
  detail: null,
  ...over,
});

describe('PayoutsTable', () => {
  const empty = { title: 'No payouts yet', body: 'Nothing here.' };

  it('shows the person, the kind and period, the amount (with INR under a foreign one), the status and the date', () => {
    const out = html(
      createElement(PayoutsTable, {
        today: '2026-10-12',
        empty,
        payouts: [
          dto(),
          dto({ id: 'p2', ref: 'TMP-FY27-0002', status: 'paid', paidOn: '2026-05-10', amount: { amountMinor: 100_000, currency: 'USD', fxRate: 84, fxDate: '2026-05-09', fxSource: 'table', inrMinor: 8_400_000 } }),
        ],
      }),
    );
    expect(out).toContain('Asha Rao');
    expect(out).toContain('TMP-FY27-0001');
    expect(out).toContain('Salary');
    expect(out).toContain('1 Apr 2026 to 30 Apr 2026');
    expect(out).toContain('Overdue'); // due on 5 May, today is 12 Oct
    expect(out).toContain('Due 5 May 2026');
    expect(out).toContain('Paid 10 May 2026');
    expect(out).toContain('$1,000.00');
    expect(out).toContain('₹84,000.00');
    expect(out).toContain('href="/admin/team/payouts/p2"');
  });

  it('a payout that is not yet due is not overdue, and a person\'s own list drops the person column', () => {
    const out = html(createElement(PayoutsTable, { today: '2026-05-05', empty, showPerson: false, payouts: [dto()] }));
    expect(out).not.toContain('Overdue');
    expect(out).not.toContain('Asha Rao');
    expect(out).toContain('>Payout<');
  });

  it('shows the empty state with its next step', () => {
    const out = html(createElement(PayoutsTable, { today: '2026-05-05', payouts: [], empty: { title: 'No payouts match', body: 'Clear the filters.' } }));
    expect(out).toContain('No payouts match');
  });
});

describe('PayoutTotalsBand', () => {
  const zero = { paid: { inrMinor: 0, count: 0, native: [], unallocatedInrMinor: 0 }, due: { inrMinor: 0, count: 0, overdueCount: 0, native: [] }, owed: { inrMinor: 0, count: 0 } };

  it('shows zeros and plain sentences for an empty period, never NaN', () => {
    const out = html(createElement(PayoutTotalsBand, { totals: zero, periodLabel: 'This financial year' }));
    expect(out).toContain('Paid, This financial year');
    expect(out).toContain('₹0.00');
    expect(out).toContain('Nothing paid in this period');
    expect(out).toContain('Nothing falls due');
    expect(out).toContain('Nothing waiting');
    expect(out).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('puts the native amount under the INR figure and flags overdue', () => {
    const out = html(
      createElement(PayoutTotalsBand, {
        periodLabel: 'This month',
        totals: {
          paid: { inrMinor: 8_400_000, count: 1, native: [{ currency: 'USD', amountMinor: 100_000, inrMinor: 8_400_000 }], unallocatedInrMinor: 8_400_000 },
          due: { inrMinor: 4_500_000, count: 2, overdueCount: 1, native: [] },
          owed: { inrMinor: 4_500_000, count: 2 },
        },
      }),
    );
    expect(out).toContain('₹84,000.00');
    expect(out).toContain('$1,000.00 (₹84,000.00)');
    expect(out).toContain('2 payouts, 1 overdue');
    expect(out).toContain('2 payouts waiting to be paid, any date');
  });
});

describe('PaySection', () => {
  const profile: PayProfileDTO = { adminId: 'a1', adminName: 'Asha Rao', exists: true, basis: 'monthly', rateMinor: 5_000_000, currency: 'INR', effectiveFrom: '2026-04-01', updatedAt: '2026-04-01T00:00:00.000Z' };
  const section = (over: Partial<Parameters<typeof PaySection>[0]> = {}) =>
    html(createElement(PaySection, { person: { id: 'a1', name: 'Asha Rao' }, profile, payouts: [dto()], canEditProfile: false, canRecord: false, canSeeAll: false, currencies: ['INR'], today: '2026-10-12', self: true, ...over }));

  it('for the person: their terms and their payouts, in the first person, with nothing to edit or record', () => {
    const out = section();
    expect(out).toContain('How I am paid');
    expect(out).toContain('My payouts');
    expect(out).toContain('TMP-FY27-0001');
    expect(out).not.toContain('Save pay profile');
    expect(out).not.toContain('Record a payout');
    expect(out).not.toContain('All payouts for');
  });

  it('for a superadmin: the editor, the way to record a payout and the link to all of them', () => {
    const out = section({ self: false, canEditProfile: true, canRecord: true, canSeeAll: true });
    expect(out).toContain('How they are paid');
    expect(out).toContain('Save pay profile');
    expect(out).toContain('href="/admin/team/payouts/new?adminId=a1"');
    expect(out).toContain('All payouts for Asha Rao');
  });

  it('says so when there are no payouts yet', () => {
    expect(section({ payouts: [] })).toContain('No payouts yet');
    expect(section({ payouts: [], self: false, canSeeAll: true })).toContain('Nothing has been recorded for Asha Rao');
  });
});
