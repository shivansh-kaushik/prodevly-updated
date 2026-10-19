import { describe, expect, it } from 'vitest';
import { TABLE_FX } from '@/components/admin/fx-field-model';
import type { PaymentDTO } from '@/services/client-payment.dto';
import { buildCreateBody, buildEditBody, fxFromPayment, stateFromPayment, type FormContext, type PaymentFormState } from './payment-form-model';

const PROJECT = '5f3a1b2c3d4e5f6a7b8c9d0e';
const base = (o: Partial<PaymentFormState> = {}): PaymentFormState => ({
  type: 'receipt',
  amount: '1,250.50',
  currency: 'INR',
  receivedOn: '2026-10-01',
  mode: 'bank_transfer',
  transactionRef: '',
  invoiceRef: '',
  note: '',
  tds: '',
  charges: '',
  contractEq: '',
  advance: false,
  projectId: PROJECT,
  taskId: null,
  milestoneId: '',
  fx: { ...TABLE_FX },
  attachmentIds: [],
  ...o,
});
const inr: FormContext = { contractCurrency: 'INR' };
const usd: FormContext = { contractCurrency: 'USD' };

const dto = (o: Partial<PaymentDTO> = {}): PaymentDTO => ({
  id: 'p1',
  ref: 'PAY-FY27-0001',
  type: 'receipt',
  status: 'received',
  clientId: 'c1',
  projectId: PROJECT,
  taskId: null,
  milestoneId: null,
  client: { id: 'c1', name: 'Acme' },
  project: { id: PROJECT, ref: 'PRJ-0001', name: 'Checkout' },
  task: null,
  milestone: null,
  amount: { amountMinor: 100_000, currency: 'USD', fxRate: 83.42, fxDate: '2026-10-01', fxSource: 'table', inrMinor: 8_342_000 },
  contractEquivalentMinor: 8_342_000,
  contractCurrency: 'INR',
  tdsMinor: null,
  chargesMinor: null,
  receivedOn: '2026-10-01',
  mode: 'wise',
  transactionRef: 'UTR1',
  invoiceRef: null,
  note: null,
  attachmentMediaIds: [],
  recordedAsAdvance: false,
  voidReason: null,
  voidedBy: null,
  voidedAt: null,
  recordedBy: 'Rita',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  warnings: [],
  ...o,
});

describe('buildCreateBody', () => {
  it('turns typed text into integer minor units and sends no INR value', () => {
    const built = buildCreateBody(base(), inr);
    expect(built).toEqual({
      ok: true,
      body: { type: 'receipt', projectId: PROJECT, amountMinor: 125_050, currency: 'INR', receivedOn: '2026-10-01', mode: 'bank_transfer', attachmentMediaIds: [] },
    });
    expect(JSON.stringify(built)).not.toMatch(/inrMinor/);
  });

  it('leaves out every optional field that is empty, and trims the text that is not', () => {
    const body = (buildCreateBody(base({ transactionRef: ' UTR9 ', note: '   ', tds: '', charges: '0', taskId: null }), inr) as { body: Record<string, unknown> }).body;
    expect(body).toMatchObject({ transactionRef: 'UTR9' });
    for (const key of ['note', 'invoiceRef', 'tdsMinor', 'chargesMinor', 'taskId', 'milestoneId', 'recordAsAdvance', 'contractEquivalentMinor', 'manualRate', 'settledInrMinor']) expect(body).not.toHaveProperty(key);
  });

  it('sends TDS, charges, links and the advance tick when given', () => {
    const body = (buildCreateBody(base({ tds: '100.00', charges: '5', taskId: 't1', milestoneId: 'm1', advance: true, attachmentIds: ['a1'] }), inr) as { body: Record<string, unknown> }).body;
    expect(body).toMatchObject({ tdsMinor: 10_000, chargesMinor: 500, taskId: 't1', milestoneId: 'm1', recordAsAdvance: true, attachmentMediaIds: ['a1'] });
  });

  it('reports an amount that is not an amount, a decimal comma, too many decimals and a missing one', () => {
    for (const amount of ['', 'abc', '12,50', '1.234', '-5', '0']) {
      const built = buildCreateBody(base({ amount }), inr);
      expect(built.ok).toBe(false);
      expect((built as { errors: Record<string, string> }).errors).toHaveProperty('amountMinor');
    }
  });

  it('needs a project, a date and a mode', () => {
    const built = buildCreateBody(base({ projectId: null, receivedOn: '', mode: '' }), inr);
    expect((built as { errors: Record<string, string> }).errors).toEqual({ projectId: expect.any(String), receivedOn: expect.any(String), mode: expect.any(String) });
  });

  it('sends nothing about the rate for INR, and the exact rate or the INR that arrived when chosen for another currency', () => {
    expect((buildCreateBody(base({ fx: { choice: 'manual', manualRate: '84', settledInr: '' } }), inr) as { body: object }).body).not.toHaveProperty('manualRate');
    const table = (buildCreateBody(base({ currency: 'USD' }), usd) as { body: object }).body;
    expect(table).not.toHaveProperty('manualRate');
    expect(table).not.toHaveProperty('settledInrMinor');
    expect((buildCreateBody(base({ currency: 'USD', fx: { choice: 'manual', manualRate: '84.1', settledInr: '' } }), usd) as { body: object }).body).toMatchObject({ manualRate: 84.1 });
    expect((buildCreateBody(base({ currency: 'USD', fx: { choice: 'bank', manualRate: '', settledInr: '83,420.00' } }), usd) as { body: object }).body).toMatchObject({ settledInrMinor: 8_342_000 });
  });

  it('refuses an incomplete rate rather than quietly using the table', () => {
    const built = buildCreateBody(base({ currency: 'USD', fx: { choice: 'manual', manualRate: '', settledInr: '' } }), usd);
    expect((built as { errors: Record<string, string> }).errors).toHaveProperty('fxRate');
    const bank = buildCreateBody(base({ currency: 'USD', fx: { choice: 'bank', manualRate: '', settledInr: 'x' } }), usd);
    expect((bank as { errors: Record<string, string> }).errors).toHaveProperty('settledInrMinor');
  });

  it('sends a contract equivalent only for another currency than the contract, in the contract currency\'s minor unit', () => {
    const other = (buildCreateBody(base({ currency: 'USD', amount: '1000', contractEq: '99,500' }), { contractCurrency: 'EUR' }) as { body: object }).body;
    expect(other).toMatchObject({ contractEquivalentMinor: 9_950_000 });
    const same = (buildCreateBody(base({ currency: 'USD', contractEq: '5' }), usd) as { body: object }).body;
    expect(same).not.toHaveProperty('contractEquivalentMinor');
    expect((buildCreateBody(base({ currency: 'USD', contractEq: 'abc' }), { contractCurrency: 'EUR' }) as { errors: object }).errors).toHaveProperty('contractEquivalentMinor');
  });
});

describe('buildEditBody', () => {
  const initial = stateFromPayment(dto());

  it('rebuilds the form from an entry exactly, so an untouched form changes nothing', () => {
    expect(initial).toMatchObject({ amount: '1000.00', currency: 'USD', mode: 'wise', transactionRef: 'UTR1', contractEq: '83420.00', fx: TABLE_FX, projectId: PROJECT });
    expect(buildEditBody(initial, initial, inr)).toEqual({ ok: true, body: {} });
  });

  it('sends only what changed, and clears a field with null', () => {
    const built = buildEditBody({ ...initial, note: 'Remittance advice', transactionRef: '', mode: 'upi' }, initial, inr);
    expect(built).toEqual({ ok: true, body: { note: 'Remittance advice', transactionRef: null, mode: 'upi' } });
  });

  it('sends the new amount and date, and lets the server recompute for a table-rate entry', () => {
    const built = buildEditBody({ ...initial, amount: '2000', receivedOn: '2026-10-05' }, initial, inr);
    expect(built).toEqual({ ok: true, body: { amountMinor: 200_000, receivedOn: '2026-10-05' } });
  });

  it('sends the rate again whenever the money changed on an entry made with a rate typed by hand', () => {
    const manual = stateFromPayment(dto({ amount: { amountMinor: 100_000, currency: 'USD', fxRate: 84.1, fxDate: '2026-10-01', fxSource: 'manual', inrMinor: 8_410_000 } }));
    expect(manual.fx).toEqual({ choice: 'manual', manualRate: '84.1', settledInr: '' });
    expect(buildEditBody({ ...manual, amount: '2000' }, manual, inr)).toEqual({ ok: true, body: { amountMinor: 200_000, manualRate: 84.1 } });
    expect(buildEditBody({ ...manual, fx: { ...manual.fx, manualRate: '85' } }, manual, inr)).toEqual({ ok: true, body: { manualRate: 85 } });
    expect(buildEditBody({ ...manual, note: 'x' }, manual, inr)).toEqual({ ok: true, body: { note: 'x' } });
  });

  it('asks for the table rate only when the person switched back to it', () => {
    const bank = stateFromPayment(dto({ amount: { amountMinor: 100_000, currency: 'USD', fxRate: 83, fxDate: '2026-10-01', fxSource: 'bank', inrMinor: 8_300_000 } }));
    expect(bank.fx).toEqual({ choice: 'bank', manualRate: '', settledInr: '83000.00' });
    expect(buildEditBody({ ...bank, fx: { ...TABLE_FX } }, bank, inr)).toEqual({ ok: true, body: { useTableRate: true } });
  });

  it('handles a change of currency, taking the new currency\'s rate choice with it', () => {
    const inrEntry = stateFromPayment(dto({ amount: { amountMinor: 100_000, currency: 'INR', fxRate: 1, fxDate: '2026-10-01', fxSource: 'identity', inrMinor: 100_000 }, contractEquivalentMinor: 100_000 }));
    const built = buildEditBody({ ...inrEntry, currency: 'USD' }, inrEntry, inr);
    expect(built).toEqual({ ok: true, body: { amountMinor: 100_000, currency: 'USD' } });
    expect(buildEditBody({ ...inrEntry, currency: 'EUR', fx: { choice: 'manual', manualRate: '90', settledInr: '' } }, inrEntry, inr)).toEqual({ ok: true, body: { amountMinor: 100_000, currency: 'EUR', manualRate: 90 } });
  });

  it('sends links and files when they changed, and the advance tick only with a change', () => {
    const built = buildEditBody({ ...initial, taskId: 't9', milestoneId: 'm9', attachmentIds: ['a1', 'a2'], advance: true }, initial, inr);
    expect(built).toEqual({ ok: true, body: { taskId: 't9', milestoneId: 'm9', attachmentMediaIds: ['a1', 'a2'], recordAsAdvance: true } });
    expect(buildEditBody({ ...initial, advance: true }, initial, inr)).toEqual({ ok: true, body: {} });
    const linked = stateFromPayment(dto({ task: { id: 't1', ref: 'T', title: 'x' }, milestone: { id: 'm1', title: 'y' } }));
    expect(buildEditBody({ ...linked, taskId: null, milestoneId: '' }, linked, inr)).toEqual({ ok: true, body: { taskId: null, milestoneId: null } });
  });

  it('corrects TDS and charges in the entry currency, and clears them', () => {
    const withTds = stateFromPayment(dto({ tdsMinor: 10_000, chargesMinor: 500 }));
    expect(withTds).toMatchObject({ tds: '100.00', charges: '5.00' });
    expect(buildEditBody({ ...withTds, tds: '', charges: '6' }, withTds, inr)).toEqual({ ok: true, body: { tdsMinor: null, chargesMinor: 600 } });
  });

  it('shows the INR that arrived as the entry was stored', () => {
    expect(fxFromPayment({ amountMinor: 1, currency: 'USD', fxRate: 83, fxDate: '2026-10-01', fxSource: 'bank', inrMinor: 8_300_000 })).toEqual({ choice: 'bank', manualRate: '', settledInr: '83000.00' });
  });
});
