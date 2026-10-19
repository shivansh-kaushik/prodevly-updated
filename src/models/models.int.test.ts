import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  Admin,
  Client,
  ClientPayment,
  Expense,
  FxRate,
  ThirdPartyPayout,
  Settings,
  SETTINGS_ID,
  TeamPayout,
  WorkLog,
  nextSequence,
  type MoneyDoc,
} from '@/models';
import { formatRef, nextFiscalRef, nextRef, nextTaskRef } from '@/services/refs';
import { setupTestDb } from '@/test/db';

setupTestDb();

const oid = () => new Types.ObjectId();
const actor = { id: oid(), name: 'Tester' };
const usd = (amountMinor = 100000): MoneyDoc => ({
  amountMinor, currency: 'USD', fxRate: 83.42, fxDate: new Date('2026-10-01'), fxSource: 'manual', inrMinor: 8342000,
});
const inr = (amountMinor = 50000): MoneyDoc => ({
  amountMinor, currency: 'INR', fxRate: 1, fxDate: new Date('2026-10-01'), fxSource: 'identity', inrMinor: amountMinor,
});

const paymentBase = {
  ref: 'PAY-FY27-0001', clientId: oid(), projectId: oid(), contractEquivalentMinor: 100000,
  receivedOn: new Date('2026-10-01'), mode: 'bank_transfer', recordedBy: actor,
};

/** `validateSync()` skips pre('validate') hooks, which is where cross-field rules live; `validate()` is what save() runs. */
const failures = async (doc: { validate: () => Promise<void> }) => {
  try {
    await doc.validate();
  } catch (e) {
    return (e as { errors: Record<string, unknown> }).errors;
  }
  return undefined;
};

describe('money is whole numbers in the minor unit', () => {
  it('rejects fractional, zero and negative amounts', async () => {
    for (const amountMinor of [1.5, 0, -5]) {
      const errs = await failures(new ClientPayment({ ...paymentBase, amount: { ...usd(), amountMinor } }));
      expect(errs?.['amount.amountMinor'], `amount ${amountMinor}`).toBeDefined();
    }
  });
  it('accepts a normal USD entry with its server-computed INR value', async () => {
    expect(await failures(new ClientPayment({ ...paymentBase, amount: usd() }))).toBeUndefined();
  });
  it('forces INR entries to rate 1 and an INR value equal to the amount', async () => {
    expect((await failures(new ClientPayment({ ...paymentBase, amount: { ...inr(), fxRate: 2 } })))?.['amount.fxRate']).toBeDefined();
    expect((await failures(new ClientPayment({ ...paymentBase, amount: { ...inr(), inrMinor: 1 } })))?.['amount.inrMinor']).toBeDefined();
    expect(await failures(new ClientPayment({ ...paymentBase, amount: inr() }))).toBeUndefined();
  });
  it('rejects an unsupported currency and a non-positive rate', async () => {
    expect((await failures(new ClientPayment({ ...paymentBase, amount: { ...usd(), currency: 'XXX' } })))?.['amount.currency']).toBeDefined();
    expect((await failures(new ClientPayment({ ...paymentBase, amount: { ...usd(), fxRate: 0 } })))?.['amount.fxRate']).toBeDefined();
  });
  it('every payment must name a client and a project', async () => {
    const errs = await failures(new ClientPayment({ ...paymentBase, clientId: undefined, projectId: undefined, amount: usd() }));
    expect(errs?.clientId).toBeDefined();
    expect(errs?.projectId).toBeDefined();
  });
});

describe('expenses', () => {
  const base = {
    ref: 'EXP-FY27-0001', category: 'travel', description: 'Flight to client site', amount: inr(),
    spentOn: new Date('2026-10-01'), recordedBy: actor,
  };
  it('a project expense must name its client and project; a company expense must not link to either', async () => {
    expect((await failures(new Expense({ ...base, scope: 'project' })))?.projectId).toBeDefined();
    expect(await failures(new Expense({ ...base, scope: 'project', clientId: oid(), projectId: oid() }))).toBeUndefined();
    expect((await failures(new Expense({ ...base, scope: 'company', projectId: oid() })))?.scope).toBeDefined();
    expect(await failures(new Expense({ ...base, scope: 'company' }))).toBeUndefined();
  });
  it('an out-of-pocket expense must say which admin paid', async () => {
    expect((await failures(new Expense({ ...base, scope: 'company', paidFrom: 'admin' })))?.paidByAdmin).toBeDefined();
    expect(await failures(new Expense({ ...base, scope: 'company', paidFrom: 'admin', paidByAdmin: actor }))).toBeUndefined();
  });
});

describe('team payout allocations', () => {
  const base = {
    ref: 'TMP-FY27-0001', adminId: oid(), adminName: 'Dev', basis: 'salary',
    periodFrom: new Date('2026-09-01'), periodTo: new Date('2026-09-30'), recordedBy: actor,
  };
  const alloc = (inrMinor: number) => ({ clientId: oid(), projectId: oid(), amountMinor: inrMinor, inrMinor });
  it('cannot allocate more than the payout, in INR', async () => {
    const over = new TeamPayout({ ...base, amount: inr(100000), allocations: [alloc(60000), alloc(50000)] });
    expect((await failures(over))?.allocations).toBeDefined();
    const exact = new TeamPayout({ ...base, amount: inr(100000), allocations: [alloc(60000), alloc(40000)] });
    expect(await failures(exact)).toBeUndefined();
    const under = new TeamPayout({ ...base, amount: inr(100000), allocations: [alloc(30000)], unallocatedInrMinor: 70000 });
    expect(await failures(under)).toBeUndefined();
  });
});

describe('uniqueness enforced by the database', () => {
  const adminBase = { name: 'Same Person', passwordHash: 'x'.repeat(60) };
  it('admin emails are unique, case-insensitively', async () => {
    await Admin.create({ ...adminBase, email: 'Same@Example.com' });
    await expect(Admin.create({ ...adminBase, email: 'same@example.com' })).rejects.toMatchObject({ code: 11000 });
  });
  it('there can be only one internal client, but any number of normal ones', async () => {
    await Client.create({ ref: 'CL-0001', name: 'ProDevly (internal)', isInternal: true });
    await expect(Client.create({ ref: 'CL-0002', name: 'Second internal', isInternal: true })).rejects.toMatchObject({ code: 11000 });
    await Client.create({ ref: 'CL-0003', name: 'Acme' });
    await Client.create({ ref: 'CL-0004', name: 'Beta' });
    expect(await Client.countDocuments({})).toBe(3);
  });
  it('references are unique', async () => {
    await Client.create({ ref: 'CL-0001', name: 'Alpha Ltd' });
    await expect(Client.create({ ref: 'CL-0001', name: 'Beta Ltd' })).rejects.toMatchObject({ code: 11000 });
  });
});

describe('settings', () => {
  it('defaults to the Indian financial year and INR, and INR can never be disabled', async () => {
    await Settings.updateOne({ _id: SETTINGS_ID }, { $setOnInsert: {} }, { upsert: true, setDefaultsOnInsert: true });
    const s = await Settings.findById(SETTINGS_ID).lean();
    expect(s).toMatchObject({ fyStartMonth: 4, baseCurrency: 'INR', timezone: 'Asia/Kolkata', workLogEditWindowDays: 7 });
    expect(s?.enabledCurrencies).toContain('INR');
    expect((await failures(new Settings({ enabledCurrencies: ['USD'] })))?.enabledCurrencies).toBeDefined();
  });
});

describe('reference numbers', () => {
  it('formats them', () => {
    expect(formatRef('CL', 7)).toBe('CL-0007');
    expect(formatRef('PAY', 1, 'FY27')).toBe('PAY-FY27-0001');
  });
  it('hands out unique, gap-free numbers under heavy concurrency', async () => {
    const seqs = await Promise.all(Array.from({ length: 40 }, () => nextSequence('load-test')));
    expect(new Set(seqs).size).toBe(40);
    expect(Math.min(...seqs)).toBe(1);
    expect(Math.max(...seqs)).toBe(40);
  });
  it('counts per kind, per financial year and per project', async () => {
    expect(await nextRef('client')).toBe('CL-0001');
    expect(await nextRef('client')).toBe('CL-0002');
    expect(await nextRef('project')).toBe('PRJ-0001');
    expect(await nextFiscalRef('payment', new Date('2027-02-01T00:00:00Z'))).toBe('PAY-FY27-0001');
    expect(await nextFiscalRef('payment', new Date('2027-02-02T00:00:00Z'))).toBe('PAY-FY27-0002');
    expect(await nextFiscalRef('payment', new Date('2027-04-02T00:00:00Z'))).toBe('PAY-FY28-0001'); // restarts in April
    expect(await nextTaskRef('PRJ-0042')).toBe('PRJ-0042-T001');
    expect(await nextTaskRef('PRJ-0042')).toBe('PRJ-0042-T002');
    expect(await nextTaskRef('PRJ-0043')).toBe('PRJ-0043-T001');
  });
});

describe('a money entry must agree with itself', () => {
  const payment = (amount: Partial<MoneyDoc>, base: MoneyDoc = usd()) =>
    new ClientPayment({ ...paymentBase, amount: { ...base, ...amount } });

  it('INR must use the identity source', async () => {
    expect((await failures(payment({ fxSource: 'table' }, inr())))?.['amount.fxSource']).toBeDefined();
    expect((await failures(payment({}, inr())))).toBeUndefined();
  });
  it('a foreign currency cannot claim the identity source', async () => {
    expect((await failures(payment({ fxSource: 'identity' })))?.['amount.fxSource']).toBeDefined();
  });
  it('a rate has at most 6 decimals', async () => {
    expect((await failures(payment({ fxRate: 83.4200001 })))?.['amount.fxRate']).toBeDefined();
    expect(await failures(payment({ fxRate: 83.42 }))).toBeUndefined();
  });
  it('the INR value must be amount x rate for table and manual sources', async () => {
    expect((await failures(payment({ inrMinor: 8342001 })))?.['amount.inrMinor']).toBeDefined();
    expect((await failures(payment({ fxSource: 'table', inrMinor: 5 })))?.['amount.inrMinor']).toBeDefined();
    expect(await failures(payment({ fxSource: 'table' }))).toBeUndefined();
  });
  it('a bank-settled figure may differ a little, not by orders of magnitude', async () => {
    expect(await failures(payment({ fxSource: 'bank', inrMinor: 8342000 + 150000 }))).toBeUndefined();
    expect((await failures(payment({ fxSource: 'bank', inrMinor: 8342000 * 100 })))?.['amount.inrMinor']).toBeDefined();
  });
});

describe('work log bounds', () => {
  const log = (o: Record<string, unknown>) =>
    new WorkLog({ adminId: oid(), adminName: 'Tester', taskId: oid(), projectId: oid(), clientId: oid(), workedOn: new Date('2026-10-01'), minutes: 60, note: 'Built the form', billable: true, ...o });
  it('allows 5 to 720 whole minutes', async () => {
    expect(await failures(log({ minutes: 5 }))).toBeUndefined();
    expect(await failures(log({ minutes: 720 }))).toBeUndefined();
    for (const minutes of [4, 721, 0, -30, 12.5]) expect((await failures(log({ minutes })))?.minutes, `${minutes}`).toBeDefined();
  });
  it('needs a real note', async () => {
    expect((await failures(log({ note: 'ab' })))?.note).toBeDefined();
    expect((await failures(log({ note: '' })))?.note).toBeDefined();
  });
});

describe('status-dependent fields', () => {
  const expense = (o: Record<string, unknown>) =>
    new Expense({ ref: 'EXP-FY27-0001', scope: 'company', category: 'Tools', description: 'Hosting bill', amount: inr(), spentOn: new Date('2026-10-01'), paidFrom: 'company', recordedBy: actor, ...o });
  const teamPayout = (o: Record<string, unknown>) =>
    new TeamPayout({
      ref: 'TMP-FY27-0001', adminId: oid(), adminName: 'Dev', basis: 'hours', periodFrom: new Date('2026-09-01'), periodTo: new Date('2026-09-30'),
      amount: usd(), recordedBy: actor, ...o,
    });
  const thirdPartyPayout = (o: Record<string, unknown>) =>
    new ThirdPartyPayout({
      ref: 'TPP-FY27-0001', thirdPartyId: oid(), thirdPartyName: 'Studio', clientId: oid(), projectId: oid(), amount: inr(), recordedBy: actor, ...o,
    });

  it('a void payment, payout or expense must say why', async () => {
    expect((await failures(new ClientPayment({ ...paymentBase, amount: inr(), status: 'void' })))?.voidReason).toBeDefined();
    expect(await failures(new ClientPayment({ ...paymentBase, amount: inr(), status: 'void', voidReason: 'Entered twice' }))).toBeUndefined();
    expect((await failures(expense({ status: 'void' })))?.voidReason).toBeDefined();
    expect((await failures(teamPayout({ status: 'void' })))?.voidReason).toBeDefined();
    expect((await failures(thirdPartyPayout({ status: 'void' })))?.voidReason).toBeDefined();
  });
  it('a paid payout or expense needs a paid date, a rejected expense a reason', async () => {
    expect((await failures(expense({ status: 'paid' })))?.paidOn).toBeDefined();
    expect(await failures(expense({ status: 'paid', paidOn: new Date('2026-10-02') }))).toBeUndefined();
    expect((await failures(expense({ status: 'rejected' })))?.rejectReason).toBeDefined();
    expect((await failures(teamPayout({ status: 'paid' })))?.paidOn).toBeDefined();
    expect((await failures(thirdPartyPayout({ status: 'paid' })))?.paidOn).toBeDefined();
  });
  it('a team payout period cannot end before it starts', async () => {
    expect((await failures(teamPayout({ periodFrom: new Date('2026-10-01'), periodTo: new Date('2026-09-01') })))?.periodTo).toBeDefined();
  });
  it('the unallocated remainder is derived from the allocations, never trusted', async () => {
    const proj = oid();
    const doc = teamPayout({
      unallocatedInrMinor: 999_999_999,
      allocations: [{ clientId: oid(), projectId: proj, amountMinor: 40000, inrMinor: 3336800 }],
    });
    expect(await failures(doc)).toBeUndefined();
    expect(doc.unallocatedInrMinor).toBe(8342000 - 3336800);
  });
  it('allocations are also bounded in the payout\'s own currency', async () => {
    const errs = await failures(teamPayout({ allocations: [{ clientId: oid(), projectId: oid(), amountMinor: 100001, inrMinor: 1 }] }));
    expect(errs?.allocations).toBeDefined();
  });
});

describe('date-only fields are UTC midnight', () => {
  it('rejects a time of day, accepts a calendar date', async () => {
    expect((await failures(new FxRate({ currency: 'USD', rateOn: new Date('2026-10-01T09:00:00Z'), rate: 83.4 })))?.rateOn).toBeDefined();
    expect(await failures(new FxRate({ currency: 'USD', rateOn: new Date('2026-10-01'), rate: 83.4 }))).toBeUndefined();
    expect((await failures(new ClientPayment({ ...paymentBase, amount: inr(), receivedOn: new Date('2026-10-01T13:45:00Z') })))?.receivedOn).toBeDefined();
  });
  it('so two rates for one currency and day cannot both exist', async () => {
    await FxRate.create({ currency: 'USD', rateOn: new Date('2026-10-01'), rate: 83.4 });
    await expect(FxRate.create({ currency: 'USD', rateOn: new Date('2026-10-01'), rate: 83.5 })).rejects.toThrow(/duplicate key/i);
  });
});

describe('admin grants', () => {
  it('only accept what a superadmin may grant', async () => {
    const base = { name: 'Neha Verma', email: 'neha@example.com', passwordHash: 'x'.repeat(60), role: 'admin' };
    expect((await failures(new Admin({ ...base, grants: ['admin:manage'] })))?.['grants.0']).toBeDefined();
    expect((await failures(new Admin({ ...base, grants: ['money:approve'] })))?.['grants.0']).toBeDefined();
    expect(await failures(new Admin({ ...base, grants: ['payment:view', 'content:publish'] }))).toBeUndefined();
  });
});

