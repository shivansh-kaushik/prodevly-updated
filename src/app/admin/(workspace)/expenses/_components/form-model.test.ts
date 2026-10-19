import { describe, expect, it } from 'vitest';
import type { ExpenseDTO } from '@/services/expense.service';
import { buildCreateBody, buildPatchBody, emptyState, stateFromExpense, type ExpenseFormState } from './form-model';

const base = (o: Partial<ExpenseFormState> = {}): ExpenseFormState => ({
  ...emptyState({ paidFrom: 'admin', today: '2026-10-12', currency: 'INR' }),
  category: 'travel',
  description: 'Taxi to the client office',
  money: { amount: '450.00', currency: 'INR' },
  spentOn: '2026-10-05',
  ...o,
});

describe('buildCreateBody', () => {
  it('turns what was typed into minor units and leaves the INR value to the server', () => {
    const built = buildCreateBody(base({ money: { amount: '1,250.50', currency: 'INR' }, payee: ' City Cabs ' }));
    expect(built).toEqual({
      ok: true,
      body: { scope: 'company', category: 'travel', description: 'Taxi to the client office', payee: 'City Cabs', amountMinor: 125_050, currency: 'INR', spentOn: '2026-10-05', paidFrom: 'admin', receiptMediaIds: [] },
    });
    expect(JSON.stringify(built)).not.toMatch(/inrMinor|paidByAdmin|status/);
  });

  it('sends the project, the task and the rate choice for a foreign project expense, and no payment details for a submission', () => {
    const built = buildCreateBody(
      base({
        scope: 'project',
        project: { id: 'p1', label: 'Site', ref: 'PRJ-0001' },
        task: { id: 't1', label: 'Build', ref: 'PRJ-0001-T001' },
        money: { amount: '100.00', currency: 'USD' },
        fx: { choice: 'manual', manualRate: '84.5', settledInr: '' },
        paidOn: '2026-10-06',
        mode: 'upi',
        receipts: [{ id: 'r1', filename: 'bill.pdf', size: 10 }],
      }),
    );
    expect(built).toMatchObject({ ok: true, body: { scope: 'project', projectId: 'p1', taskId: 't1', amountMinor: 10_000, currency: 'USD', manualRate: 84.5, receiptMediaIds: ['r1'] } });
    expect(built.ok && built.body).not.toHaveProperty('paidOn');
    expect(built.ok && built.body).not.toHaveProperty('mode');
  });

  it('asks for the payment date and mode only when the company paid', () => {
    expect(buildCreateBody(base({ paidFrom: 'company', paidOn: '', mode: '' }))).toEqual({ ok: false, errors: { paidOn: expect.any(String), mode: expect.any(String) } });
    const ok = buildCreateBody(base({ paidFrom: 'company', paidOn: '2026-10-06', mode: 'bank_transfer', transactionRef: ' UTR 1 ' }));
    expect(ok).toMatchObject({ ok: true, body: { paidFrom: 'company', paidOn: '2026-10-06', mode: 'bank_transfer', transactionRef: 'UTR 1' } });
  });

  it('puts each problem beside its field', () => {
    const built = buildCreateBody(base({ description: ' ', category: '', money: { amount: '12,50', currency: 'INR' }, spentOn: '', scope: 'project' }));
    expect(built).toEqual({
      ok: false,
      errors: { description: expect.any(String), category: expect.any(String), amountMinor: expect.any(String), spentOn: expect.any(String), projectId: expect.any(String) },
    });
  });

  it('will not turn an unfinished manual rate into a table lookup', () => {
    const built = buildCreateBody(base({ money: { amount: '10.00', currency: 'USD' }, fx: { choice: 'manual', manualRate: '', settledInr: '' } }));
    expect(built).toMatchObject({ ok: false, errors: { fxRate: expect.any(String) } });
    const bank = buildCreateBody(base({ money: { amount: '10.00', currency: 'USD' }, fx: { choice: 'bank', manualRate: '', settledInr: '' } }));
    expect(bank).toMatchObject({ ok: false, errors: { settledInrMinor: expect.any(String) } });
  });

  it('ignores a leftover rate choice for INR', () => {
    const built = buildCreateBody(base({ fx: { choice: 'manual', manualRate: '', settledInr: '' } }));
    expect(built.ok).toBe(true);
    expect(built.ok && built.body).not.toHaveProperty('manualRate');
  });
});

const dto = (o: Partial<ExpenseDTO> = {}): ExpenseDTO =>
  ({
    id: 'e1', ref: 'EXP-FY27-0001', scope: 'project', status: 'submitted', category: 'travel', description: 'Taxi', payee: null,
    spentOn: '2026-10-05', paidOn: null, amount: { amountMinor: 45_000, currency: 'INR', inrMinor: 45_000 }, paidFrom: 'admin',
    paidBy: { id: 'a1', name: 'Asha' }, project: { id: 'p1', ref: 'PRJ-0001', name: 'Site', clientId: 'c1', clientName: 'Acme', archived: false },
    receiptCount: 2, createdAt: '2026-10-05T00:00:00.000Z', task: { id: 't1', ref: 'PRJ-0001-T001', title: 'Build' },
    fx: { rate: 1, rateOn: '2026-10-05', source: 'identity' }, mode: null, transactionRef: null, approvedBy: null, approvedAt: null,
    rejectReason: null, voidReason: null, recordedBy: 'Asha',
    receipts: [{ id: 'r1', filename: 'bill.pdf', size: 1000 } as never], receiptIds: ['r1', 'hidden'], statusHistory: [], updatedAt: '2026-10-05T00:00:00.000Z',
    can: { edit: true, approve: false, reject: false, markPaid: false, void: true },
    ...o,
  }) as ExpenseDTO;

describe('stateFromExpense and buildPatchBody', () => {
  const initial = stateFromExpense(dto());
  const opts = { paid: false, hiddenReceiptIds: ['hidden'] };

  it('reads the stored expense back into the form', () => {
    expect(initial).toMatchObject({ paidFrom: 'admin', scope: 'project', category: 'travel', money: { amount: '450.00', currency: 'INR' }, project: { id: 'p1', label: 'Site' }, task: { id: 't1' } });
    expect(stateFromExpense(dto({ fx: { rate: 84.5, rateOn: '2026-10-05', source: 'manual' }, amount: { amountMinor: 10_000, currency: 'USD', inrMinor: 845_000 } })).fx).toEqual({ choice: 'manual', manualRate: '84.5', settledInr: '' });
    expect(stateFromExpense(dto({ fx: { rate: 83, rateOn: '2026-10-05', source: 'bank' }, amount: { amountMinor: 10_000, currency: 'USD', inrMinor: 830_000 } })).fx).toEqual({ choice: 'bank', manualRate: '', settledInr: '8300.00' });
  });

  it('sends nothing when nothing changed', () => {
    expect(buildPatchBody(initial, { ...initial }, opts)).toEqual({ ok: true, body: null });
    // typing the same amount differently is not a change
    expect(buildPatchBody(initial, { ...initial, money: { amount: '450', currency: 'INR' } }, opts)).toEqual({ ok: true, body: null });
  });

  it('sends only what changed', () => {
    expect(buildPatchBody(initial, { ...initial, description: 'Taxi to the airport', payee: 'City Cabs' }, opts)).toEqual({ ok: true, body: { description: 'Taxi to the airport', payee: 'City Cabs' } });
    expect(buildPatchBody(stateFromExpense(dto({ payee: 'City Cabs' })), { ...initial, payee: '' }, opts)).toEqual({ ok: true, body: { payee: null } });
  });

  it('sends the money fields together when any of them changes', () => {
    expect(buildPatchBody(initial, { ...initial, money: { amount: '600', currency: 'INR' } }, opts)).toEqual({
      ok: true,
      body: { amountMinor: 60_000, currency: 'INR', spentOn: '2026-10-05' },
    });
    expect(buildPatchBody(initial, { ...initial, spentOn: '2026-10-06' }, opts)).toMatchObject({ ok: true, body: { amountMinor: 45_000, spentOn: '2026-10-06' } });
  });

  it('moves a project expense, clearing the task, and moves it to the company', () => {
    expect(buildPatchBody(initial, { ...initial, project: { id: 'p2', label: 'Other', ref: 'PRJ-0002' }, task: null }, opts)).toEqual({ ok: true, body: { scope: 'project', projectId: 'p2', taskId: null } });
    expect(buildPatchBody(initial, { ...initial, scope: 'company', project: null, task: null }, opts)).toEqual({ ok: true, body: { scope: 'company' } });
  });

  it('keeps receipts the person could not see, and sends payment details only for a paid expense', () => {
    const edited = { ...initial, receipts: [] };
    expect(buildPatchBody(initial, edited, opts)).toEqual({ ok: true, body: { receiptMediaIds: ['hidden'] } });
    const paid = stateFromExpense(dto({ status: 'paid', paidOn: '2026-10-06', mode: 'upi', transactionRef: 'U1' }));
    expect(buildPatchBody(paid, { ...paid, mode: 'cash', transactionRef: '' }, { paid: true, hiddenReceiptIds: [] })).toEqual({ ok: true, body: { mode: 'cash', transactionRef: null } });
    expect(buildPatchBody(paid, { ...paid, paidOn: '' }, { paid: true, hiddenReceiptIds: [] })).toMatchObject({ ok: false, errors: { paidOn: expect.any(String) } });
    expect(buildPatchBody(initial, { ...initial, mode: 'cash' }, opts)).toEqual({ ok: true, body: null });
  });
});
