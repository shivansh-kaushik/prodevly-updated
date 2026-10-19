import { describe, expect, it } from 'vitest';
import { companyPaid, outOfPocket } from '@/test/expense-factories';
import { createExpenseSchema, markPaidSchema, parseExpenseFilter, parseRangeParams, rejectExpenseSchema, updateExpenseSchema } from './expense';

const issues = (r: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) =>
  Object.fromEntries((r.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]));

describe('createExpenseSchema', () => {
  it('accepts a company payment and an out-of-pocket submission, defaulting receipts to none', () => {
    expect(createExpenseSchema.parse(companyPaid()).receiptMediaIds).toEqual([]);
    expect(createExpenseSchema.parse(outOfPocket()).paidFrom).toBe('admin');
  });

  it('trims text and upper-cases the currency', () => {
    const v = createExpenseSchema.parse(outOfPocket({ description: '  Taxi  ', currency: ' usd ' as never }));
    expect(v).toMatchObject({ description: 'Taxi', currency: 'USD' });
  });

  it('needs the date paid and the mode for a company payment, and forbids them on a submission', () => {
    expect(Object.keys(issues(createExpenseSchema.safeParse(companyPaid({ paidOn: undefined, mode: undefined }))))).toEqual(['paidOn', 'mode']);
    expect(Object.keys(issues(createExpenseSchema.safeParse(outOfPocket({ paidOn: '2026-10-06', mode: 'upi', transactionRef: 'X' }))))).toEqual(['paidOn', 'mode', 'transactionRef']);
  });

  it('keeps company expenses free of links and project expenses tied to a project', () => {
    const id = 'a'.repeat(24);
    expect(issues(createExpenseSchema.safeParse(outOfPocket({ projectId: id })))).toHaveProperty('scope');
    expect(issues(createExpenseSchema.safeParse(outOfPocket({ taskId: id })))).toHaveProperty('scope');
    expect(issues(createExpenseSchema.safeParse(outOfPocket({ scope: 'project' })))).toHaveProperty('projectId');
    expect(createExpenseSchema.safeParse(outOfPocket({ scope: 'project', taskId: id })).success).toBe(true); // the task names the project
  });

  it('refuses amounts that are not whole, positive minor units', () => {
    for (const amountMinor of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) expect(createExpenseSchema.safeParse(outOfPocket({ amountMinor })).success, String(amountMinor)).toBe(false);
  });

  it('refuses a body that carries an INR value, a status, a payer or any unknown field', () => {
    for (const extra of [{ inrMinor: 1 }, { status: 'approved' }, { paidByAdmin: { id: 'x', name: 'y' } }, { approvedBy: 'x' }, { amount: {} }]) {
      expect(createExpenseSchema.safeParse({ ...outOfPocket(), ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
  });

  it('refuses both a typed rate and a settled INR figure', () => {
    expect(issues(createExpenseSchema.safeParse(outOfPocket({ currency: 'USD', manualRate: 84, settledInrMinor: 100 })))).toHaveProperty('manualRate');
    expect(createExpenseSchema.safeParse(outOfPocket({ currency: 'USD', manualRate: 84.1234567 })).success).toBe(false);
  });

  it('refuses more than ten receipts and ids that are not ids', () => {
    expect(createExpenseSchema.safeParse(outOfPocket({ receiptMediaIds: Array(11).fill('a'.repeat(24)) })).success).toBe(false);
    expect(createExpenseSchema.safeParse(outOfPocket({ receiptMediaIds: ['nope'] })).success).toBe(false);
  });
});

describe('the other action schemas', () => {
  it('update takes only known fields, allows null to clear, and needs at least one', () => {
    expect(updateExpenseSchema.safeParse({}).success).toBe(false);
    expect(updateExpenseSchema.safeParse({ payee: null, taskId: null, projectId: null, transactionRef: null }).success).toBe(true);
    for (const body of [{ status: 'paid' }, { paidFrom: 'company' }, { ref: 'EXP-1' }, { inrMinor: 1 }, { statusHistory: [] }]) expect(updateExpenseSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    expect(issues(updateExpenseSchema.safeParse({ scope: 'company', projectId: 'a'.repeat(24) }))).toHaveProperty('scope');
  });

  it('reject and void need a real reason; mark paid needs a date and a mode, and takes an optional reference', () => {
    expect(rejectExpenseSchema.safeParse({ reason: 'no' }).success).toBe(false);
    expect(rejectExpenseSchema.safeParse({ reason: '   ' }).success).toBe(false);
    expect(rejectExpenseSchema.safeParse({ reason: 'Personal trip' }).success).toBe(true);
    expect(markPaidSchema.safeParse({ paidOn: '2026-10-10', mode: 'upi' }).success).toBe(true);
    expect(markPaidSchema.safeParse({ paidOn: '2026-02-30', mode: 'upi' }).success).toBe(false);
    expect(markPaidSchema.safeParse({ paidOn: '2026-10-10' }).success).toBe(false);
  });
});

describe('parseExpenseFilter and parseRangeParams', () => {
  it('reads known values and ignores everything else', () => {
    expect(parseExpenseFilter({ q: ' taxi ', status: 'settled', scope: 'project', paidFrom: 'admin', category: 'travel', projectId: 'A'.repeat(24), person: 'b'.repeat(24) })).toEqual({
      q: 'taxi', status: 'settled', scope: 'project', paidFrom: 'admin', category: 'travel', projectId: 'a'.repeat(24), personId: 'b'.repeat(24),
    });
    expect(parseExpenseFilter({ status: 'bogus', scope: 'x', paidFrom: 'y', projectId: 'zzz', person: '1' })).toEqual({});
  });

  it('accepts a date range only when both ends are real dates in order', () => {
    expect(parseRangeParams({ from: '2026-04-01', to: '2027-03-31' })).toEqual({ from: new Date('2026-04-01T00:00:00Z'), to: new Date('2027-03-31T00:00:00Z') });
    for (const sp of [{ from: '2026-04-01' }, { from: '2027-01-01', to: '2026-01-01' }, { from: 'nope', to: '2026-01-01' }, { from: '2026-02-30', to: '2026-03-01' }]) expect(parseRangeParams(sp)).toBeUndefined();
  });
});
