import { describe, expect, it } from 'vitest';
import { TABLE_FX } from '@/components/admin/fx-field-model';
import type { PayoutSuggestionDTO } from '@/services/team-payout.service';
import type { AllocationRow } from './allocation-editor';
import { archivedWithTime, buildPayload, proposeRows, suggestedMoney, type PayoutDraft } from './form-model';

const suggestion = (over: Partial<PayoutSuggestionDTO> = {}): PayoutSuggestionDTO => ({
  adminId: 'a1',
  adminName: 'Asha Rao',
  periodFrom: '2026-04-01',
  periodTo: '2026-04-30',
  terms: { basis: 'monthly', rateMinor: 5_000_000, currency: 'INR' },
  payoutBasis: 'salary',
  minutes: 1_000,
  taskCount: 0,
  computedMinor: 5_000_000,
  suggestion: { minutes: 1_000, taskCount: 0, rateMinor: 5_000_000, currency: 'INR', computedMinor: 5_000_000 },
  projects: [
    { projectId: 'p1', projectRef: 'PRJ-0001', projectName: 'Alpha', clientId: 'c', clientName: 'Client', minutes: 600, archived: false },
    { projectId: 'p2', projectRef: 'PRJ-0002', projectName: 'Beta', clientId: 'c', clientName: 'Client', minutes: 300, archived: false },
    { projectId: 'p3', projectRef: 'PRJ-0003', projectName: 'Gamma', clientId: 'c', clientName: 'Client', minutes: 100, archived: false },
  ],
  proposedAllocations: [],
  warnings: [],
  ...over,
});

const row = (projectId: string, amount: string): AllocationRow => ({ projectId, label: projectId, ref: '', minutes: 0, amount });

const draft = (over: Partial<PayoutDraft> = {}): PayoutDraft => ({
  personId: 'a1',
  basis: 'salary',
  periodFrom: '2026-04-01',
  periodTo: '2026-04-30',
  money: { amount: '50,000.00', currency: 'INR' },
  dueOn: '2026-05-05',
  note: '  Paid in two parts  ',
  rows: [],
  fx: TABLE_FX,
  ...over,
});

describe('proposeRows', () => {
  it('shares the amount in the form across the projects by minutes, in decimal text', () => {
    const rows = proposeRows(suggestion(), 5_000_000, 'INR');
    expect(rows.map((r) => [r.projectId, r.amount, r.minutes])).toEqual([
      ['p1', '30000.00', 600],
      ['p2', '15000.00', 300],
      ['p3', '5000.00', 100],
    ]);
  });

  it('follows the amount typed, not the proposed one, and a three-way split of an odd amount keeps the sum', () => {
    const rows = proposeRows(suggestion({ projects: [1, 2, 3].map((n) => ({ projectId: `p${n}`, projectRef: '', projectName: `P${n}`, clientId: 'c', clientName: '', minutes: 60, archived: false })) }), 100_001, 'USD');
    expect(rows.map((r) => r.amount)).toEqual(['333.34', '333.34', '333.33']);
  });

  it('leaves archived projects and projects without time out, and proposes nothing without an amount or a proposal', () => {
    const data = suggestion({
      projects: [
        { projectId: 'p1', projectRef: '', projectName: 'Open', clientId: 'c', clientName: '', minutes: 100, archived: false },
        { projectId: 'p2', projectRef: '', projectName: 'Archived', clientId: 'c', clientName: '', minutes: 100, archived: true },
        { projectId: 'p3', projectRef: '', projectName: 'Nothing', clientId: 'c', clientName: '', minutes: 0, archived: false },
      ],
    });
    expect(proposeRows(data, 1_000, 'INR').map((r) => [r.projectId, r.amount])).toEqual([['p1', '10.00']]);
    expect(archivedWithTime(data)).toBe(1);
    expect(proposeRows(data, null, 'INR').map((r) => r.amount)).toEqual(['']);
    expect(proposeRows(null, 1_000, 'INR')).toEqual([]);
    expect(proposeRows(suggestion({ projects: [] }), 1_000, 'INR')).toEqual([]);
    expect(archivedWithTime(null)).toBe(0);
  });
});

describe('suggestedMoney', () => {
  it('puts the proposed amount and its currency in the form, and leaves the form alone when there is none', () => {
    const current = { amount: '', currency: 'INR' };
    expect(suggestedMoney(suggestion(), current)).toEqual({ amount: '50000.00', currency: 'INR' });
    expect(suggestedMoney(suggestion({ terms: { basis: 'hourly', rateMinor: 100, currency: 'USD' }, computedMinor: 12_345 }), current)).toEqual({ amount: '123.45', currency: 'USD' });
    expect(suggestedMoney(suggestion({ computedMinor: null }), current)).toBe(current);
    expect(suggestedMoney(suggestion({ computedMinor: 0 }), current)).toBe(current);
    expect(suggestedMoney(suggestion({ terms: null }), current)).toBe(current);
    expect(suggestedMoney(null, current)).toBe(current);
  });
});

describe('buildPayload', () => {
  it('builds the body of a new payout: integer minor units, the split without zero rows, the note trimmed, no INR value', () => {
    const r = buildPayload(draft({ rows: [row('p1', '30,000.00'), row('p2', ''), row('p3', '20000')] }), 'create');
    expect(r).toEqual({
      ok: true,
      body: {
        adminId: 'a1',
        basis: 'salary',
        periodFrom: '2026-04-01',
        periodTo: '2026-04-30',
        amountMinor: 5_000_000,
        currency: 'INR',
        dueOn: '2026-05-05',
        note: 'Paid in two parts',
        allocations: [{ projectId: 'p1', amountMinor: 3_000_000 }, { projectId: 'p3', amountMinor: 2_000_000 }],
      },
    });
  });

  it('an edit does not send the person', () => {
    const r = buildPayload(draft({ personId: null }), 'edit');
    expect(r.ok).toBe(true);
    expect(r.ok && 'adminId' in r.body).toBe(false);
  });

  it('sends the exchange-rate fields only for a foreign currency, and only the kind the person chose', () => {
    const usd = { amount: '1,000.00', currency: 'USD' };
    const table = buildPayload(draft({ money: usd }), 'create');
    expect(table.ok && table.body).toMatchObject({ amountMinor: 100_000, currency: 'USD' });
    expect(table.ok && 'manualRate' in table.body).toBe(false);
    const manual = buildPayload(draft({ money: usd, fx: { choice: 'manual', manualRate: '83.42', settledInr: '' } }), 'create');
    expect(manual.ok && manual.body.manualRate).toBe(83.42);
    const bank = buildPayload(draft({ money: usd, fx: { choice: 'bank', manualRate: '', settledInr: '83,420.00' } }), 'create');
    expect(bank.ok && bank.body.settledInrMinor).toBe(8_342_000);
    // an INR payout never sends a rate, whatever is left in the exchange-rate state
    const inr = buildPayload(draft({ fx: { choice: 'manual', manualRate: '83.42', settledInr: '' } }), 'create');
    expect(inr.ok && 'manualRate' in inr.body).toBe(false);
  });

  it('reports each problem on its own field and sends nothing', () => {
    const r = buildPayload(draft({ personId: null, periodFrom: '', periodTo: '', dueOn: '', money: { amount: '12,50', currency: 'INR' } }), 'create');
    expect(r).toEqual({
      ok: false,
      errors: { adminId: expect.any(String), periodFrom: expect.any(String), periodTo: expect.any(String), dueOn: expect.any(String), amountMinor: expect.any(String) },
    });
    expect(buildPayload(draft({ periodFrom: '2026-05-01', periodTo: '2026-04-01' }), 'create')).toMatchObject({ ok: false, errors: { periodTo: expect.stringMatching(/cannot end before/) } });
    expect(buildPayload(draft({ money: { amount: '10.00', currency: 'USD' }, fx: { choice: 'manual', manualRate: '', settledInr: '' } }), 'create')).toMatchObject({ ok: false, errors: { fxRate: expect.any(String) } });
  });

  it('refuses a split with a bad amount or more than the payout, before the server does', () => {
    expect(buildPayload(draft({ rows: [row('p1', 'abc')] }), 'create')).toMatchObject({ ok: false, errors: { allocations: expect.stringMatching(/Fix the amounts/) } });
    expect(buildPayload(draft({ rows: [row('p1', '30,000.00'), row('p2', '20,000.01')] }), 'create')).toMatchObject({ ok: false, errors: { allocations: expect.stringMatching(/more than the payout/) } });
    expect(buildPayload(draft({ rows: [row('p1', '30,000.00'), row('p2', '20,000.00')] }), 'create').ok).toBe(true); // exactly the payout
  });
});
