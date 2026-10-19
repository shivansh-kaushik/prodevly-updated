import { describe, expect, it } from 'vitest';
import {
  MAX_ATTACHMENTS,
  paymentListQuerySchema,
  parsePaymentFilters,
  recordPaymentSchema,
  updatePaymentSchema,
  voidPaymentSchema,
} from './payment';

const ID = '5F3A1B2C3D4E5F6A7B8C9D0E';
const base = { projectId: ID, amountMinor: 125_050, currency: 'inr', receivedOn: '2026-10-01', mode: ' bank_transfer ' };
const failure = (schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } }, value: unknown) => {
  const r = schema.safeParse(value);
  if (r.success) throw new Error('expected a failure');
  return Object.fromEntries((r.error?.issues ?? []).map((i) => [i.path.join('.') || '_', i.message]));
};

describe('recordPaymentSchema', () => {
  it('parses the smallest valid body, lowercases ids, uppercases the currency and trims text', () => {
    const parsed = recordPaymentSchema.parse(base);
    expect(parsed).toMatchObject({ type: 'receipt', projectId: ID.toLowerCase(), currency: 'INR', mode: 'bank_transfer', attachmentMediaIds: [] });
    expect(parsed.transactionRef).toBeUndefined();
  });

  it('turns empty optional text into "not given"', () => {
    const parsed = recordPaymentSchema.parse({ ...base, transactionRef: '', invoiceRef: '  ', note: '' });
    expect(parsed.transactionRef).toBeUndefined();
    expect(parsed.invoiceRef).toBeUndefined();
    expect(parsed.note).toBeUndefined();
  });

  it('refuses anything the browser must not send, rather than ignoring it', () => {
    for (const extra of [{ inrMinor: 5 }, { status: 'void' }, { amount: {} }, { ref: 'x' }, { recordedBy: 'x' }, { fxSource: 'table' }]) {
      expect(recordPaymentSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    }
  });

  it('wants a whole positive amount inside the limit, a real date and a known currency', () => {
    expect(failure(recordPaymentSchema, { ...base, amountMinor: 0 })).toHaveProperty('amountMinor');
    expect(failure(recordPaymentSchema, { ...base, amountMinor: 1.5 })).toHaveProperty('amountMinor');
    expect(failure(recordPaymentSchema, { ...base, amountMinor: 10 ** 13 })).toHaveProperty('amountMinor');
    expect(failure(recordPaymentSchema, { ...base, receivedOn: '2026-02-30' })).toHaveProperty('receivedOn');
    expect(failure(recordPaymentSchema, { ...base, receivedOn: '0202-01-01' })).toHaveProperty('receivedOn');
    expect(failure(recordPaymentSchema, { ...base, currency: 'XXX' })).toHaveProperty('currency');
    expect(failure(recordPaymentSchema, { ...base, mode: '' })).toHaveProperty('mode');
    expect(failure(recordPaymentSchema, { ...base, projectId: 'nope' })).toHaveProperty('projectId');
  });

  it('allows zero TDS and charges, refuses negatives and fractions', () => {
    expect(recordPaymentSchema.parse({ ...base, tdsMinor: 0, chargesMinor: 0 })).toMatchObject({ tdsMinor: 0, chargesMinor: 0 });
    expect(failure(recordPaymentSchema, { ...base, tdsMinor: -1 })).toHaveProperty('tdsMinor');
    expect(failure(recordPaymentSchema, { ...base, chargesMinor: 0.5 })).toHaveProperty('chargesMinor');
  });

  it('takes a rate or the INR that arrived, never both', () => {
    expect(recordPaymentSchema.parse({ ...base, manualRate: 83.42 }).manualRate).toBe(83.42);
    expect(recordPaymentSchema.parse({ ...base, settledInrMinor: 8_342_000 }).settledInrMinor).toBe(8_342_000);
    expect(failure(recordPaymentSchema, { ...base, manualRate: 83, settledInrMinor: 8_300_000 })).toHaveProperty('manualRate');
    expect(failure(recordPaymentSchema, { ...base, manualRate: 83.1234567 })).toHaveProperty('manualRate');
  });

  it('caps the attachments', () => {
    const ids = Array.from({ length: MAX_ATTACHMENTS + 1 }, () => ID);
    expect(failure(recordPaymentSchema, { ...base, attachmentMediaIds: ids })).toHaveProperty('attachmentMediaIds');
  });
});

describe('updatePaymentSchema', () => {
  it('needs something to change and does not take the type', () => {
    expect(failure(updatePaymentSchema, {})).toHaveProperty('_');
    expect(updatePaymentSchema.safeParse({ type: 'refund' }).success).toBe(false);
    expect(updatePaymentSchema.safeParse({ note: 'x' }).success).toBe(true);
  });

  it('clears a field with null or empty text, and leaves an absent one alone', () => {
    const parsed = updatePaymentSchema.parse({ note: '', transactionRef: null, tdsMinor: null, taskId: null, milestoneId: null });
    expect(parsed).toMatchObject({ note: null, transactionRef: null, tdsMinor: null, taskId: null, milestoneId: null });
    expect('invoiceRef' in parsed).toBe(false);
  });

  it('refuses combining the table rate with a rate, or two rates', () => {
    expect(failure(updatePaymentSchema, { useTableRate: true, manualRate: 83 })).toHaveProperty('manualRate');
    expect(failure(updatePaymentSchema, { manualRate: 83, settledInrMinor: 8_300_000 })).toHaveProperty('manualRate');
    expect(updatePaymentSchema.safeParse({ useTableRate: false }).success).toBe(false);
  });
});

describe('voidPaymentSchema', () => {
  it('needs a reason of 3 to 300 characters after trimming', () => {
    expect(voidPaymentSchema.parse({ reason: '  Bounced  ' }).reason).toBe('Bounced');
    expect(failure(voidPaymentSchema, { reason: ' ab ' })).toHaveProperty('reason');
    expect(failure(voidPaymentSchema, { reason: 'x'.repeat(301) })).toHaveProperty('reason');
    expect(failure(voidPaymentSchema, {})).toHaveProperty('reason');
    expect(voidPaymentSchema.safeParse({ reason: 'abc', extra: 1 }).success).toBe(false);
  });
});

describe('the list query and the URL filters', () => {
  it('parses a query string into typed filters and rejects values it does not know', () => {
    const q = paymentListQuerySchema.parse({ status: 'void', type: 'refund', currency: 'usd', page: '2', pageSize: '50', from: '2026-04-01', sort: 'amount', dir: 'asc', projectId: ID });
    expect(q).toMatchObject({ status: 'void', type: 'refund', currency: 'USD', page: 2, pageSize: 50, sort: 'amount', dir: 'asc', projectId: ID.toLowerCase() });
    expect(paymentListQuerySchema.safeParse({ status: 'paid' }).success).toBe(false);
    expect(paymentListQuerySchema.safeParse({ sort: 'inr' }).success).toBe(false);
    expect(paymentListQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
  });

  it('reads page filters defensively: a bad value is dropped, never an error', () => {
    expect(parsePaymentFilters({ client: ID, project: 'zzz', status: 'void', type: 'nope', mode: 'upi', currency: 'usd', q: ' utr ' })).toEqual({
      clientId: ID.toLowerCase(),
      status: 'void',
      mode: 'upi',
      currency: 'USD',
      q: 'utr',
    });
    expect(parsePaymentFilters({ mode: '{"$ne":1}', currency: 'dollars' })).toEqual({});
  });
});
