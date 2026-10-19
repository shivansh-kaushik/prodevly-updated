import { describe, expect, it } from 'vitest';
import { fiscalYearLabel } from '@/lib/dates/fiscal-year';
import { AuditLog, Counter, Media, Project, Task, ThirdParty, ThirdPartyPayout, WorkOrder } from '@/models';
import { getCompanyTotals } from '@/services/dashboards/ledger';
import { archiveThirdParty } from '@/services/third-party.service';
import {
  createPayout,
  getPayout,
  markPayoutPaid,
  searchPayouts,
  updatePayout,
  voidPayout,
} from '@/services/third-party-payout.service';
import { changeWorkOrderStatus, createWorkOrder } from '@/services/work-order.service';
import { setupTestDb } from '@/test/db';
import { makeClient, makeProject, makeTask } from '@/test/domain-factories';
import { setSettings } from '@/test/settings-factories';
import { D, dayDate, dayStr, makeMedia, makeOrder, makeParty, makePayout, makeWorld, rejects, setRate, viewerHolding } from '@/test/third-party-factories';

setupTestDb();

const id = (d: { _id: unknown }) => String(d._id);

async function setup(o: { agreedMinor?: number; currency?: string } = {}) {
  const w = await makeWorld();
  const order = await createWorkOrder(w.sa, { thirdPartyId: id(w.party), projectId: id(w.project), title: 'Build the checkout', amountMinor: o.agreedMinor ?? 1_000_000, currency: o.currency ?? 'INR' });
  return { w, order };
}

/** What the work order SHOULD say, recomputed from its payouts. */
async function truth(workOrderId: string) {
  const rows = await ThirdPartyPayout.find({ workOrderId }).lean();
  const sum = (status: string) => rows.filter((r) => r.status === status).reduce((s, r) => s + r.amount.amountMinor, 0);
  return { paidMinor: sum('paid'), dueMinor: sum('due') };
}
const cached = async (workOrderId: string) => {
  const wo = await WorkOrder.findById(workOrderId).lean();
  return { paidMinor: wo?.paidMinor, dueMinor: wo?.dueMinor };
};

const PAY = { mode: 'bank_transfer', transactionRef: 'UTR-001' };

describe('capabilities', () => {
  it('needs payout:record to record, money:approve to mark paid, money:void to void, payout:view to read; a refusal writes nothing', async () => {
    const { w, order } = await setup();
    const due = (await createPayout(w.sa, { workOrderId: order.id, amountMinor: 100_000 })).payout;
    const audits = await AuditLog.countDocuments({});

    const viewOnly = viewerHolding(w.sa, 'payout:view');
    const approver = viewerHolding(w.sa, 'payout:view', 'money:approve');
    for (const attempt of [
      () => createPayout(w.plain, { workOrderId: order.id, amountMinor: 1 }),
      () => createPayout(viewOnly, { workOrderId: order.id, amountMinor: 1 }),
      () => updatePayout(viewOnly, due.id, { note: 'x' }),
      // a recorder (payout:record) is NOT an approver or a voider
      () => markPayoutPaid(w.recorder, due.id, { paidOn: dayStr(0), ...PAY }),
      () => markPayoutPaid(viewOnly, due.id, { paidOn: dayStr(0), ...PAY }),
      () => voidPayout(w.recorder, due.id, 'Whatever'),
      () => voidPayout(approver, due.id, 'Whatever'),
      () => searchPayouts(w.plain),
      () => getPayout(w.plain, due.id),
    ]) {
      expect((await rejects(attempt())).code).toBe('FORBIDDEN');
    }
    expect(await AuditLog.countDocuments({})).toBe(audits);
    expect((await ThirdPartyPayout.findById(due.id).lean())?.status).toBe('due');
    expect(await cached(order.id)).toEqual({ paidMinor: 0, dueMinor: 100_000 });
    // the right capability does work
    expect((await markPayoutPaid(approver, due.id, { paidOn: dayStr(0), ...PAY })).status).toBe('paid');
    expect((await getPayout(viewOnly, due.id)).status).toBe('paid');
  });
});

describe('create without a work order', () => {
  it('records a DUE payout with the client derived from the project, a reference, the actor and an audit entry with context', async () => {
    const w = await makeWorld();
    const { payout, warnings } = await createPayout(w.recorder, { thirdPartyId: id(w.party), projectId: id(w.project), taskId: id(w.task), amountMinor: 125_050, currency: 'INR', dueOn: dayStr(30), tdsMinor: 12_505, note: 'First milestone' });
    expect(warnings).toEqual([]);
    expect(payout).toMatchObject({
      status: 'due',
      ref: expect.stringMatching(/^TPP-FY\d{2}-0001$/),
      thirdPartyId: id(w.party),
      thirdPartyName: w.party.name,
      workOrderId: null,
      clientId: id(w.client),
      clientName: w.client.name,
      projectId: id(w.project),
      projectRef: w.project.ref,
      taskId: id(w.task),
      taskRef: w.task.ref,
      amount: { amountMinor: 125_050, currency: 'INR', fxRate: 1, fxSource: 'identity', inrMinor: 125_050, fxDate: dayStr(0) }, // the due date is ahead: captured for today
      tdsMinor: 12_505,
      dueOn: dayStr(30),
      paidOn: null,
      note: 'First milestone',
      recordedBy: w.recorder.name,
      paidBy: null,
    });
    const stored = await ThirdPartyPayout.findById(payout.id).lean();
    expect(String(stored?.clientId)).toBe(id(w.client));
    expect(stored?.dueOn?.toISOString()).toBe(`${dayStr(30)}T00:00:00.000Z`);
    const entry = await AuditLog.findOne({ action: 'thirdPartyPayout.create' }).lean();
    expect(entry?.entity).toMatchObject({ type: 'thirdPartyPayout' });
    expect(String(entry?.entity.id)).toBe(payout.id);
    expect(String(entry?.context.clientId)).toBe(id(w.client));
    expect(String(entry?.context.projectId)).toBe(id(w.project));
    expect(String(entry?.context.taskId)).toBe(id(w.task));
  });

  it('defaults the due date to today in the organisation\'s zone', async () => {
    const w = await makeWorld();
    const { payout } = await createPayout(w.sa, { thirdPartyId: id(w.party), projectId: id(w.project), amountMinor: 1000, currency: 'INR' });
    expect(payout.dueOn).toBe(dayStr(0));
  });

  it('computes INR on the server from the rate for the due date, and the client can never send it', async () => {
    const w = await makeWorld();
    await setRate('USD', 83.42, dayStr(-2));
    const { payout } = await createPayout(w.sa, { thirdPartyId: id(w.party), projectId: id(w.project), amountMinor: 100_000, currency: 'USD', dueOn: dayStr(0) });
    expect(payout.amount).toEqual({ amountMinor: 100_000, currency: 'USD', fxRate: 83.42, fxDate: dayStr(-2), fxSource: 'table', inrMinor: 8_342_000 });
    for (const forged of [{ inrMinor: 1 }, { amount: { inrMinor: 1 } }, { fxRate: 1 }, { status: 'paid' }, { paidOn: dayStr(0) }]) {
      expect((await rejects(createPayout(w.sa, { thirdPartyId: id(w.party), projectId: id(w.project), amountMinor: 1000, currency: 'INR', ...forged } as never))).code).toBe('VALIDATION_FAILED');
    }
    expect(await ThirdPartyPayout.countDocuments({})).toBe(1);
  });

  it('captures the rate for today when the due date is still ahead, so a payout due next month is not refused', async () => {
    const w = await makeWorld();
    await setRate('USD', 83, dayStr(-2));
    const base = { thirdPartyId: id(w.party), projectId: id(w.project), amountMinor: 100_000, currency: 'USD' };
    const { payout } = await createPayout(w.sa, { ...base, dueOn: dayStr(30) });
    expect(payout.dueOn).toBe(dayStr(30));
    expect(payout.amount).toMatchObject({ fxRate: 83, fxDate: dayStr(-2), inrMinor: 8_300_000 });
    // the same when the date is edited to another day in the future
    const moved = await updatePayout(w.sa, payout.id, { dueOn: dayStr(60) });
    expect(moved.payout).toMatchObject({ dueOn: dayStr(60), amount: { fxRate: 83, fxDate: dayStr(-2) } });
    // the reference follows the day it was recorded, not the due date
    expect(payout.ref).toMatch(new RegExp(`^TPP-${fiscalYearLabel(new Date(), 4, 'Asia/Kolkata')}-0001$`));
  });

  it('answers FX_RATE_MISSING when there is no usable rate, and with an exact rate or the settled INR it records', async () => {
    const w = await makeWorld();
    const base = { thirdPartyId: id(w.party), projectId: id(w.project), amountMinor: 100_000, currency: 'USD', dueOn: dayStr(0) };
    const missing = await rejects(createPayout(w.sa, base));
    expect(missing.code).toBe('FX_RATE_MISSING');
    expect(await ThirdPartyPayout.countDocuments({})).toBe(0);
    expect((await Counter.find({}).lean()).filter((c) => String(c._id).startsWith('thirdPartyPayout')).every((c) => c.seq === 0)).toBe(true);

    const manual = await createPayout(w.sa, { ...base, manualRate: 84.1 });
    expect(manual.payout.amount).toMatchObject({ fxSource: 'manual', fxRate: 84.1, inrMinor: 8_410_000, fxDate: dayStr(0) });
    const bank = await createPayout(w.sa, { ...base, settledInrMinor: 8_395_000 });
    expect(bank.payout.amount).toMatchObject({ fxSource: 'bank', inrMinor: 8_395_000, fxRate: 83.95 });
    expect((await rejects(createPayout(w.sa, { ...base, manualRate: 84, settledInrMinor: 8_400_000 }))).code).toBe('VALIDATION_FAILED');
  });

  it('refuses ids that disagree (LINK_MISMATCH), cancelled tasks, archived projects and unusable third parties', async () => {
    const w = await makeWorld();
    const base = { thirdPartyId: id(w.party), projectId: id(w.project), amountMinor: 1000, currency: 'INR' };
    const otherClient = await makeClient();
    expect((await rejects(createPayout(w.sa, { ...base, clientId: id(otherClient) }))).code).toBe('LINK_MISMATCH');
    const foreignTask = await makeTask(await makeProject(w.client));
    expect((await rejects(createPayout(w.sa, { ...base, taskId: id(foreignTask) }))).code).toBe('LINK_MISMATCH');
    await Task.updateOne({ _id: w.task._id }, { $set: { status: 'cancelled' } });
    expect((await rejects(createPayout(w.sa, { ...base, taskId: id(w.task) }))).code).toBe('CONFLICT');
    await Project.updateOne({ _id: w.project._id }, { $set: { archivedAt: new Date() } });
    expect((await rejects(createPayout(w.sa, base))).code).toBe('CONFLICT');
    await Project.updateOne({ _id: w.project._id }, { $unset: { archivedAt: 1 } });
    const archived = await makeParty({ archivedAt: new Date() });
    const inactive = await makeParty({ status: 'inactive' });
    expect((await rejects(createPayout(w.sa, { ...base, thirdPartyId: id(archived) }))).fields?.thirdPartyId).toBeDefined();
    expect((await rejects(createPayout(w.sa, { ...base, thirdPartyId: id(inactive) }))).fields?.thirdPartyId).toBeDefined();
    expect((await rejects(createPayout(w.sa, { ...base, projectId: undefined }))).fields?.projectId).toBeDefined();
    expect((await rejects(createPayout(w.sa, { ...base, thirdPartyId: undefined }))).fields?.thirdPartyId).toBeDefined();
    expect((await rejects(createPayout(w.sa, { ...base, currency: undefined }))).fields?.currency).toBeDefined();
    expect((await rejects(createPayout(w.sa, { ...base, amountMinor: 0 }))).code).toBe('VALIDATION_FAILED');
    expect((await rejects(createPayout(w.sa, { ...base, amountMinor: 1.5 }))).code).toBe('VALIDATION_FAILED');
    expect((await rejects(createPayout(w.sa, { ...base, tdsMinor: 2000 }))).fields?.tdsMinor).toMatch(/more than/);
    await setSettings({ enabledCurrencies: ['INR'] });
    expect((await rejects(createPayout(w.sa, { ...base, currency: 'USD' }))).fields?.currency).toMatch(/not turned on/);
    expect(await ThirdPartyPayout.countDocuments({})).toBe(0);
    expect(await Task.countDocuments({ _id: foreignTask._id })).toBe(1);
  });

  it('only accepts private payout attachments that exist', async () => {
    const w = await makeWorld();
    const base = { thirdPartyId: id(w.party), projectId: id(w.project), amountMinor: 1000, currency: 'INR' };
    const good = await makeMedia(w.recorder, { purpose: 'payout' });
    const wrongPurpose = await makeMedia(w.recorder, { purpose: 'expense' });
    const publicImage = await makeMedia(w.recorder, { visibility: 'public' });
    expect((await rejects(createPayout(w.sa, { ...base, attachmentMediaIds: [id(wrongPurpose)] }))).fields?.attachmentMediaIds).toBeDefined();
    expect((await rejects(createPayout(w.sa, { ...base, attachmentMediaIds: [id(publicImage)] }))).fields?.attachmentMediaIds).toBeDefined();
    expect((await rejects(createPayout(w.sa, { ...base, attachmentMediaIds: ['0'.repeat(24)] }))).fields?.attachmentMediaIds).toMatch(/no longer exists/);
    expect(await ThirdPartyPayout.countDocuments({})).toBe(0);
    const { payout } = await createPayout(w.recorder, { ...base, attachmentMediaIds: [id(good), id(good).toUpperCase()] });
    expect(payout.attachmentCount).toBe(1);
    expect(payout.attachments.map((a) => a.id)).toEqual([id(good)]);
    expect((await Media.findById(good._id).lean())?.purpose).toBe('payout');
  });
});

describe('create against a work order', () => {
  it('copies client, project and task, and takes the currency from it', async () => {
    const w = await makeWorld();
    const order = await createWorkOrder(w.sa, { thirdPartyId: id(w.party), projectId: id(w.project), taskId: id(w.task), title: 'Checkout', amountMinor: 1_000_000, currency: 'INR' });
    const { payout } = await createPayout(w.recorder, { workOrderId: order.id, amountMinor: 400_000 });
    expect(payout).toMatchObject({ workOrderId: order.id, workOrderRef: order.ref, thirdPartyId: id(w.party), clientId: id(w.client), projectId: id(w.project), taskId: id(w.task), amount: { currency: 'INR', amountMinor: 400_000 } });
    // restating the same links is fine
    const again = await createPayout(w.recorder, { workOrderId: order.id, thirdPartyId: id(w.party), clientId: id(w.client).toUpperCase(), projectId: id(w.project), taskId: id(w.task), currency: 'INR', amountMinor: 1 });
    expect(again.payout.workOrderId).toBe(order.id);
  });

  it('refuses a different third party, client, project, task (LINK_MISMATCH) or currency (CURRENCY_MISMATCH), and writes nothing', async () => {
    const w = await makeWorld();
    const order = await createWorkOrder(w.sa, { thirdPartyId: id(w.party), projectId: id(w.project), taskId: id(w.task), title: 'Checkout', amountMinor: 1_000_000, currency: 'INR' });
    const otherProject = await makeProject(w.client);
    const otherTask = await makeTask(w.project);
    const base = { workOrderId: order.id, amountMinor: 1000 };
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ thirdPartyId: id(await makeParty()) }, 'LINK_MISMATCH'],
      [{ clientId: id(await makeClient()) }, 'LINK_MISMATCH'],
      [{ projectId: id(otherProject) }, 'LINK_MISMATCH'],
      [{ taskId: id(otherTask) }, 'LINK_MISMATCH'],
      [{ currency: 'USD' }, 'CURRENCY_MISMATCH'],
      [{ currency: 'EUR' }, 'CURRENCY_MISMATCH'],
    ];
    for (const [extra, code] of cases) {
      const err = await rejects(createPayout(w.sa, { ...base, ...extra }));
      expect(err.code, JSON.stringify(extra)).toBe(code);
      expect(err.status).toBe(422);
    }
    expect(await ThirdPartyPayout.countDocuments({})).toBe(0);
    expect(await cached(order.id)).toEqual({ paidMinor: 0, dueMinor: 0 });
    expect(await AuditLog.countDocuments({ action: 'thirdPartyPayout.create' })).toBe(0);
    expect((await rejects(createPayout(w.sa, { workOrderId: String(order.id).replace(/.$/, '0'), amountMinor: 1 }))).fields?.workOrderId).toBeDefined();
  });

  it('matches a foreign work order\'s currency and records the payout in it', async () => {
    const { w, order } = await setup({ currency: 'USD', agreedMinor: 500_000 });
    await setRate('USD', 83, dayStr(-1));
    const { payout } = await createPayout(w.sa, { workOrderId: order.id, amountMinor: 100_000, dueOn: dayStr(0) });
    expect(payout.amount).toMatchObject({ currency: 'USD', fxRate: 83, inrMinor: 8_300_000 });
    expect(await cached(order.id)).toEqual({ paidMinor: 0, dueMinor: 100_000 }); // in the work order's currency, not INR
  });

  it('warns, and does not block, when the payout is above the remaining balance', async () => {
    const { w, order } = await setup({ agreedMinor: 1_000_000 });
    expect((await createPayout(w.sa, { workOrderId: order.id, amountMinor: 700_000 })).warnings).toEqual([]);
    const over = await createPayout(w.sa, { workOrderId: order.id, amountMinor: 400_000 });
    expect(over.warnings).toHaveLength(1);
    expect(over.warnings[0]).toMatch(/₹1,000\.00 more than the ₹10,000\.00 agreed/);
    expect(over.payout.status).toBe('due');
    expect(await cached(order.id)).toEqual({ paidMinor: 0, dueMinor: 1_100_000 });
  });

  it('keeps the task link even when the task was cancelled after the work order was raised, but refuses a closed work order', async () => {
    const w = await makeWorld();
    const order = await createWorkOrder(w.sa, { thirdPartyId: id(w.party), projectId: id(w.project), taskId: id(w.task), title: 'Checkout', amountMinor: 1_000_000, currency: 'INR' });
    await Task.updateOne({ _id: w.task._id }, { $set: { status: 'cancelled' } });
    expect((await createPayout(w.sa, { workOrderId: order.id, amountMinor: 1000 })).payout.taskId).toBe(id(w.task));
    await changeWorkOrderStatus(w.sa, order.id, { status: 'closed' });
    expect((await rejects(createPayout(w.sa, { workOrderId: order.id, amountMinor: 1000 }))).code).toBe('CONFLICT');
    await Project.updateOne({ _id: w.project._id }, { $set: { archivedAt: new Date() } });
    await changeWorkOrderStatus(w.sa, order.id, { status: 'open', note: 'Reopen' });
    expect((await rejects(createPayout(w.sa, { workOrderId: order.id, amountMinor: 1000 }))).code).toBe('CONFLICT'); // archived project
  });
});

describe('cached work-order sums', () => {
  it('stay correct through create, edit, mark paid and void', async () => {
    const { w, order } = await setup({ agreedMinor: 2_000_000 });
    expect(await cached(order.id)).toEqual({ paidMinor: 0, dueMinor: 0 });
    const a = (await createPayout(w.sa, { workOrderId: order.id, amountMinor: 300_000 })).payout;
    const b = (await createPayout(w.sa, { workOrderId: order.id, amountMinor: 500_000 })).payout;
    expect(await cached(order.id)).toEqual({ paidMinor: 0, dueMinor: 800_000 });

    await updatePayout(w.sa, a.id, { amountMinor: 350_000 });
    expect(await cached(order.id)).toEqual({ paidMinor: 0, dueMinor: 850_000 });

    await markPayoutPaid(w.sa, a.id, { paidOn: dayStr(0), ...PAY });
    expect(await cached(order.id)).toEqual({ paidMinor: 350_000, dueMinor: 500_000 });

    await voidPayout(w.sa, b.id, 'Entered twice');
    expect(await cached(order.id)).toEqual({ paidMinor: 350_000, dueMinor: 0 });

    await voidPayout(w.sa, a.id, 'Paid by mistake'); // a PAID payout can be voided too
    expect(await cached(order.id)).toEqual({ paidMinor: 0, dueMinor: 0 });
    expect(await cached(order.id)).toEqual(await truth(order.id));

    const dto = (await createWorkOrder(w.sa, { thirdPartyId: id(w.party), projectId: id(w.project), title: 'Untouched', amountMinor: 1000, currency: 'INR' }));
    expect(await cached(dto.id)).toEqual({ paidMinor: 0, dueMinor: 0 }); // other work orders are untouched

    // each change that moved a sum says so in the audit entry
    const entries = await AuditLog.find({ action: /^thirdPartyPayout\./ }).sort({ at: 1 }).lean();
    expect(entries.map((e) => e.action)).toEqual(['thirdPartyPayout.create', 'thirdPartyPayout.create', 'thirdPartyPayout.update', 'thirdPartyPayout.mark_paid', 'thirdPartyPayout.void', 'thirdPartyPayout.void']);
    expect(entries[3]?.changes).toEqual(expect.arrayContaining([{ path: 'workOrder.paidMinor', before: 0, after: 350_000 }, { path: 'workOrder.dueMinor', before: 850_000, after: 500_000 }]));
  });

  it('stay correct under concurrent payouts on the same work order', async () => {
    const { w, order } = await setup({ agreedMinor: 5_000_000 });
    const amounts = [100_000, 200_000, 300_000, 400_000, 500_000, 600_000];
    const results = await Promise.all(amounts.map((amountMinor) => createPayout(w.sa, { workOrderId: order.id, amountMinor })));
    expect(new Set(results.map((r) => r.payout.ref)).size).toBe(amounts.length);
    expect(await cached(order.id)).toEqual({ paidMinor: 0, dueMinor: 2_100_000 });
    expect(await cached(order.id)).toEqual(await truth(order.id));

    // and while several are paid and voided at the same time
    const [p1, p2, p3, p4] = results.map((r) => r.payout.id);
    await Promise.all([
      markPayoutPaid(w.sa, p1!, { paidOn: dayStr(0), ...PAY }),
      markPayoutPaid(w.sa, p2!, { paidOn: dayStr(0), ...PAY }),
      voidPayout(w.sa, p3!, 'Duplicate'),
      updatePayout(w.sa, p4!, { amountMinor: 450_000 }),
      createPayout(w.sa, { workOrderId: order.id, amountMinor: 10_000 }),
    ]);
    expect(await cached(order.id)).toEqual(await truth(order.id));
    expect(await cached(order.id)).toEqual({ paidMinor: 300_000, dueMinor: 500_000 + 450_000 + 600_000 + 10_000 });
  });

  it('a mark-paid racing a void on one payout leaves one consistent outcome', async () => {
    const { w, order } = await setup();
    const { payout } = await createPayout(w.sa, { workOrderId: order.id, amountMinor: 250_000 });
    await Promise.allSettled([markPayoutPaid(w.sa, payout.id, { paidOn: dayStr(0), ...PAY }), voidPayout(w.sa, payout.id, 'Raced')]);
    const final = await ThirdPartyPayout.findById(payout.id).lean();
    expect(final?.status).toBe('void'); // void is allowed from due and from paid, so it is always the end state
    expect(await cached(order.id)).toEqual({ paidMinor: 0, dueMinor: 0 });
  });
});

describe('mark paid', () => {
  it('records the paid date, mode and reference, the payer, and locks the entry', async () => {
    const { w, order } = await setup();
    const { payout } = await createPayout(w.recorder, { workOrderId: order.id, amountMinor: 250_000, dueOn: dayStr(-3) });
    const paid = await markPayoutPaid(w.sa, payout.id, { paidOn: dayStr(-1), mode: 'upi', transactionRef: '  UTR123  ' });
    expect(paid).toMatchObject({ status: 'paid', paidOn: dayStr(-1), mode: 'upi', transactionRef: 'UTR123', paidBy: w.sa.name, recordedBy: w.recorder.name, amount: { amountMinor: 250_000, currency: 'INR', inrMinor: 250_000, fxDate: dayStr(-1) } });
    // a paid payout is final until voided
    expect((await rejects(updatePayout(w.sa, payout.id, { note: 'Late edit' }))).code).toBe('ENTRY_LOCKED');
    expect((await rejects(markPayoutPaid(w.sa, payout.id, { paidOn: dayStr(0), ...PAY }))).code).toBe('CONFLICT');
  });

  it('RE-CAPTURES the exchange rate for the paid date and keeps the due-date capture in the audit entry', async () => {
    const w = await makeWorld();
    await setRate('USD', 83, dayStr(-3));
    await setRate('USD', 85, dayStr(-1));
    const { payout } = await createPayout(w.sa, { thirdPartyId: id(w.party), projectId: id(w.project), amountMinor: 100_000, currency: 'USD', dueOn: dayStr(-3) });
    expect(payout.amount).toMatchObject({ fxRate: 83, inrMinor: 8_300_000, fxDate: dayStr(-3) });

    const paid = await markPayoutPaid(w.sa, payout.id, { paidOn: dayStr(-1), ...PAY });
    expect(paid.amount).toEqual({ amountMinor: 100_000, currency: 'USD', fxRate: 85, fxDate: dayStr(-1), fxSource: 'table', inrMinor: 8_500_000 });
    const entry = await AuditLog.findOne({ action: 'thirdPartyPayout.mark_paid' }).lean();
    const change = (path: string) => entry?.changes.find((c) => c.path === path);
    expect(change('fxRate')).toEqual({ path: 'fxRate', before: 83, after: 85 });
    expect(change('inrMinor')).toEqual({ path: 'inrMinor', before: 8_300_000, after: 8_500_000 });
    expect(change('fxDate')).toEqual({ path: 'fxDate', before: dayStr(-3), after: dayStr(-1) });
    expect(change('status')).toEqual({ path: 'status', before: 'due', after: 'paid' });
    expect(change('paidOn')).toMatchObject({ after: dayStr(-1) });
    expect(change('amountMinor')).toBeUndefined(); // the amount never moves
  });

  it('takes the exact rate the bank used, or the INR that really left, instead of the table', async () => {
    const w = await makeWorld();
    await setRate('USD', 83, dayStr(-3));
    const make = async () => (await createPayout(w.sa, { thirdPartyId: id(w.party), projectId: id(w.project), amountMinor: 100_000, currency: 'USD', dueOn: dayStr(-3) })).payout.id;
    const manual = await markPayoutPaid(w.sa, await make(), { paidOn: dayStr(-1), ...PAY, manualRate: 84.25 });
    expect(manual.amount).toMatchObject({ fxSource: 'manual', fxRate: 84.25, inrMinor: 8_425_000 });
    const bank = await markPayoutPaid(w.sa, await make(), { paidOn: dayStr(-1), ...PAY, settledInrMinor: 8_390_000 });
    expect(bank.amount).toMatchObject({ fxSource: 'bank', inrMinor: 8_390_000, fxRate: 83.9 });
    expect((await rejects(markPayoutPaid(w.sa, await make(), { paidOn: dayStr(-1), ...PAY, manualRate: 84, settledInrMinor: 8_400_000 }))).code).toBe('VALIDATION_FAILED');
  });

  it('answers FX_RATE_MISSING when the paid date has no usable rate, and leaves the payout due', async () => {
    const w = await makeWorld();
    await setRate('USD', 83, dayStr(-20));
    const { payout } = await createPayout(w.sa, { thirdPartyId: id(w.party), projectId: id(w.project), amountMinor: 100_000, currency: 'USD', dueOn: dayStr(-18) });
    const err = await rejects(markPayoutPaid(w.sa, payout.id, { paidOn: dayStr(0), ...PAY }));
    expect(err.code).toBe('FX_RATE_MISSING');
    const stored = await ThirdPartyPayout.findById(payout.id).lean();
    expect(stored?.status).toBe('due');
    expect(stored?.amount.fxRate).toBe(83);
    expect(await AuditLog.countDocuments({ action: 'thirdPartyPayout.mark_paid' })).toBe(0);
  });

  it('validates the paid date, the mode and the reference', async () => {
    const { w, order } = await setup();
    const { payout } = await createPayout(w.sa, { workOrderId: order.id, amountMinor: 1000 });
    expect((await rejects(markPayoutPaid(w.sa, payout.id, { paidOn: dayStr(1), ...PAY }))).fields?.paidOn).toMatch(/future/);
    expect((await rejects(markPayoutPaid(w.sa, payout.id, { paidOn: '2026-02-30', ...PAY }))).code).toBe('VALIDATION_FAILED');
    expect((await rejects(markPayoutPaid(w.sa, payout.id, { paidOn: dayStr(0), mode: 'barter', transactionRef: 'x1' }))).fields?.mode).toBeDefined();
    expect((await rejects(markPayoutPaid(w.sa, payout.id, { paidOn: dayStr(0), mode: 'bank_transfer' }))).fields?.transactionRef).toBeDefined();
    expect((await ThirdPartyPayout.findById(payout.id).lean())?.status).toBe('due');
    // cash has no reference
    const cash = await markPayoutPaid(w.sa, payout.id, { paidOn: dayStr(0), mode: 'cash' });
    expect(cash).toMatchObject({ status: 'paid', mode: 'cash', transactionRef: null });
  });

  it('adds a transfer confirmation while marking paid, keeping what was attached, and refuses files that are not payout attachments', async () => {
    const { w, order } = await setup();
    const first = await makeMedia(w.recorder, { purpose: 'payout' });
    const proof = await makeMedia(w.sa, { purpose: 'payout' });
    const foreign = await makeMedia(w.sa, { purpose: 'payment' });
    const { payout } = await createPayout(w.recorder, { workOrderId: order.id, amountMinor: 1000, attachmentMediaIds: [id(first)] });
    expect((await rejects(markPayoutPaid(w.sa, payout.id, { paidOn: dayStr(0), ...PAY, attachmentMediaIds: [id(foreign)] }))).fields?.attachmentMediaIds).toBeDefined();
    expect((await ThirdPartyPayout.findById(payout.id).lean())?.status).toBe('due');
    const paid = await markPayoutPaid(w.sa, payout.id, { paidOn: dayStr(0), ...PAY, attachmentMediaIds: [id(proof), id(first)] });
    expect(paid.attachments.map((a) => a.id).sort()).toEqual([id(first), id(proof)].sort());
  });

  it('cannot pay a voided payout, and an unknown id is not found', async () => {
    const { w, order } = await setup();
    const { payout } = await createPayout(w.sa, { workOrderId: order.id, amountMinor: 1000 });
    await voidPayout(w.sa, payout.id, 'Wrong vendor');
    expect((await rejects(markPayoutPaid(w.sa, payout.id, { paidOn: dayStr(0), ...PAY }))).code).toBe('CONFLICT');
    expect((await rejects(markPayoutPaid(w.sa, 'nope', { paidOn: dayStr(0), ...PAY }))).code).toBe('NOT_FOUND');
  });
});

describe('void', () => {
  it('needs a reason, records who and why, and cannot happen twice', async () => {
    const { w, order } = await setup();
    const { payout } = await createPayout(w.sa, { workOrderId: order.id, amountMinor: 1000 });
    expect((await rejects(voidPayout(w.sa, payout.id, ''))).fields?.reason).toBeDefined();
    expect((await rejects(voidPayout(w.sa, payout.id, 'x'))).code).toBe('VALIDATION_FAILED');
    expect((await ThirdPartyPayout.findById(payout.id).lean())?.status).toBe('due');
    const voided = await voidPayout(w.sa, payout.id, { reason: 'Entered against the wrong work order' });
    expect(voided).toMatchObject({ status: 'void', voidReason: 'Entered against the wrong work order', voidedBy: w.sa.name });
    expect((await rejects(voidPayout(w.sa, payout.id, 'Again'))).code).toBe('CONFLICT');
    const entry = await AuditLog.findOne({ action: 'thirdPartyPayout.void' }).lean();
    expect(entry?.summary).toBe('Entered against the wrong work order');
    expect(entry?.changes[0]).toEqual({ path: 'status', before: 'due', after: 'void' });
    // a void payout is excluded from every list filter that means money, and cannot be edited
    expect((await rejects(updatePayout(w.sa, payout.id, { note: 'x' }))).code).toBe('ENTRY_LOCKED');
  });
});

describe('edit while due', () => {
  it('recomputes INR for a new amount, date or currency, and audits the diff', async () => {
    const w = await makeWorld();
    await setRate('USD', 83, dayStr(-5));
    await setRate('USD', 84, dayStr(-1));
    const { payout } = await createPayout(w.recorder, { thirdPartyId: id(w.party), projectId: id(w.project), amountMinor: 100_000, currency: 'USD', dueOn: dayStr(-5) });
    const amount = await updatePayout(w.recorder, payout.id, { amountMinor: 200_000, note: 'Second half' });
    expect(amount.payout.amount).toMatchObject({ amountMinor: 200_000, fxRate: 83, inrMinor: 16_600_000 });
    const date = await updatePayout(w.recorder, payout.id, { dueOn: dayStr(-1) });
    expect(date.payout.amount).toMatchObject({ fxRate: 84, inrMinor: 16_800_000, fxDate: dayStr(-1) });
    expect(date.payout.dueOn).toBe(dayStr(-1));
    const inr = await updatePayout(w.recorder, payout.id, { currency: 'INR' });
    expect(inr.payout.amount).toMatchObject({ currency: 'INR', fxRate: 1, fxSource: 'identity', inrMinor: 200_000 });
    const entry = await AuditLog.findOne({ action: 'thirdPartyPayout.update', 'changes.path': 'amountMinor' }).lean();
    expect(entry?.changes).toEqual(expect.arrayContaining([{ path: 'amountMinor', before: 100_000, after: 200_000 }, { path: 'note', before: null, after: 'Second half' }]));
  });

  it('keeps a rate typed by hand or applied by the bank when the same currency is edited', async () => {
    const w = await makeWorld();
    const base = { thirdPartyId: id(w.party), projectId: id(w.project), currency: 'USD', dueOn: dayStr(-2) };
    const manual = (await createPayout(w.sa, { ...base, amountMinor: 100_000, manualRate: 84.5 })).payout;
    const edited = await updatePayout(w.sa, manual.id, { amountMinor: 200_000 });
    expect(edited.payout.amount).toMatchObject({ fxSource: 'manual', fxRate: 84.5, inrMinor: 16_900_000 });

    const bank = (await createPayout(w.sa, { ...base, amountMinor: 100_000, settledInrMinor: 8_390_000 })).payout;
    const editedBank = await updatePayout(w.sa, bank.id, { amountMinor: 200_000 });
    expect(editedBank.payout.amount).toMatchObject({ fxRate: 83.9, inrMinor: 16_780_000 }); // the rate the bank gave is kept
    // a new exact rate replaces it
    const fixed = await updatePayout(w.sa, bank.id, { manualRate: 85 });
    expect(fixed.payout.amount).toMatchObject({ fxSource: 'manual', fxRate: 85, inrMinor: 17_000_000 });
    // no table rate exists for this currency, so a table lookup after a currency change is FX_RATE_MISSING
    expect((await rejects(updatePayout(w.sa, bank.id, { currency: 'EUR' }))).code).toBe('FX_RATE_MISSING');
  });

  it('refuses a currency that is not the work order\'s, and cannot move the links', async () => {
    const { w, order } = await setup();
    const { payout } = await createPayout(w.sa, { workOrderId: order.id, amountMinor: 1000 });
    expect((await rejects(updatePayout(w.sa, payout.id, { currency: 'USD' }))).code).toBe('CURRENCY_MISMATCH');
    for (const forged of [{ projectId: id(w.project) }, { clientId: id(w.client) }, { workOrderId: order.id }, { thirdPartyId: id(w.party) }, { status: 'paid' }, { inrMinor: 1 }]) {
      expect((await rejects(updatePayout(w.sa, payout.id, forged as never))).code, JSON.stringify(forged)).toBe('VALIDATION_FAILED');
    }
    const otherTask = await makeTask(w.project);
    expect((await rejects(updatePayout(w.sa, payout.id, { taskId: id(otherTask) }))).code).toBe('LINK_MISMATCH'); // a work order decides the task
    expect((await rejects(updatePayout(w.sa, payout.id, {}))).code).toBe('VALIDATION_FAILED');
  });

  it('edits the task of a payout without a work order, validates TDS and replaces attachments', async () => {
    const w = await makeWorld();
    const { payout } = await createPayout(w.sa, { thirdPartyId: id(w.party), projectId: id(w.project), amountMinor: 100_000, currency: 'INR' });
    const set = await updatePayout(w.sa, payout.id, { taskId: id(w.task), tdsMinor: 10_000 });
    expect(set.payout).toMatchObject({ taskId: id(w.task), tdsMinor: 10_000 });
    expect((await rejects(updatePayout(w.sa, payout.id, { tdsMinor: 100_001 }))).fields?.tdsMinor).toBeDefined();
    expect((await rejects(updatePayout(w.sa, payout.id, { amountMinor: 5_000 }))).fields?.tdsMinor).toBeDefined(); // the amount fell below the TDS
    const foreign = await makeTask(await makeProject(w.client));
    expect((await rejects(updatePayout(w.sa, payout.id, { taskId: id(foreign) }))).code).toBe('LINK_MISMATCH');
    const file = await makeMedia(w.sa, { purpose: 'payout' });
    expect((await updatePayout(w.sa, payout.id, { attachmentMediaIds: [id(file)] })).payout.attachmentCount).toBe(1);
    expect((await updatePayout(w.sa, payout.id, { attachmentMediaIds: [], taskId: null, tdsMinor: null, note: null })).payout).toMatchObject({ attachmentCount: 0, taskId: null, tdsMinor: null, note: null });
    expect((await rejects(updatePayout(w.sa, payout.id, { attachmentMediaIds: [id(await makeMedia(w.sa, { purpose: 'payment' }))] }))).fields?.attachmentMediaIds).toBeDefined();
  });

  it('a save that changes nothing writes nothing', async () => {
    const w = await makeWorld();
    const { payout } = await createPayout(w.sa, { thirdPartyId: id(w.party), projectId: id(w.project), amountMinor: 100_000, currency: 'INR', note: 'Same' });
    const audits = await AuditLog.countDocuments({});
    const same = await updatePayout(w.sa, payout.id, { amountMinor: 100_000, note: 'Same' });
    expect(same.payout.updatedAt).toBe(payout.updatedAt);
    expect(await AuditLog.countDocuments({})).toBe(audits);
  });
});

describe('search and read', () => {
  it('filters by status, overdue, third party, work order, project and client, and matches text literally', async () => {
    const w = await makeWorld();
    const other = await makeParty({ name: 'Beta.Works' });
    const projectB = await makeProject(await makeClient({ name: 'Other Client' }));
    const order = await makeOrder(w.party, w.project);
    const late = await makePayout(w.party, w.project, { dueOn: dayDate(-5), order, status: 'due' });
    const soon = await makePayout(w.party, w.project, { dueOn: dayDate(5), status: 'due' });
    const paid = await makePayout(other, projectB, { status: 'paid', paidOn: dayDate(-1) });
    await makePayout(other, projectB, { status: 'void' });

    expect((await searchPayouts(w.sa)).meta.total).toBe(4);
    expect((await searchPayouts(w.sa, { status: 'due' })).meta.total).toBe(2);
    expect((await searchPayouts(w.sa, { overdue: true })).items.map((i) => i.id)).toEqual([id(late)]);
    expect((await searchPayouts(w.sa, { overdue: true, status: 'paid' })).items.map((i) => i.id)).toEqual([id(paid)]); // overdue is ignored next to another status
    expect((await searchPayouts(w.sa, { thirdPartyId: id(other) })).meta.total).toBe(2);
    expect((await searchPayouts(w.sa, { workOrderId: id(order) })).items.map((i) => i.id)).toEqual([id(late)]);
    expect((await searchPayouts(w.sa, { projectId: id(projectB) })).meta.total).toBe(2);
    expect((await searchPayouts(w.sa, { clientId: id(w.client) })).meta.total).toBe(2);
    expect((await searchPayouts(w.sa, { q: '.*' })).items).toHaveLength(0);
    expect((await searchPayouts(w.sa, { q: 'beta.works' })).meta.total).toBe(2);
    expect((await searchPayouts(w.sa, { q: paid.ref })).items.map((i) => i.id)).toEqual([id(paid)]);

    const byDue = await searchPayouts(w.sa, { status: 'due', sort: 'dueOn', dir: 'asc' });
    expect(byDue.items.map((i) => i.id)).toEqual([id(late), id(soon)]);
    const items = (await searchPayouts(w.sa, { status: 'due', sort: 'dueOn', dir: 'asc' })).items;
    expect(items[0]).toMatchObject({ overdue: true, workOrderRef: order.ref, projectName: w.project.name, clientName: w.client.name });
    expect(items[1]?.overdue).toBe(false);
    const page = await searchPayouts(w.sa, { pageSize: 3, page: 2 });
    expect(page.items).toHaveLength(1);
    expect((await getPayout(w.sa, id(paid))).paidOn).toBe(dayStr(-1));
    expect((await rejects(getPayout(w.sa, 'nope'))).code).toBe('NOT_FOUND');
  });

  it('never returns Mongoose documents or raw ids', async () => {
    const { w, order } = await setup();
    await createPayout(w.sa, { workOrderId: order.id, amountMinor: 1000 });
    const json = JSON.stringify([await searchPayouts(w.sa), await getPayout(w.sa, (await searchPayouts(w.sa)).items[0]!.id)]);
    expect(json).not.toMatch(/"_id"|"__v"|"\$oid"|paymentNote/);
  });
});

describe('the ledger and the third party', () => {
  it('a payout counts in company totals only while it is paid: due and void are left out', async () => {
    const { w, order } = await setup();
    const range = { from: D(dayStr(-30)), to: D(dayStr(0)) };
    const { payout } = await createPayout(w.sa, { workOrderId: order.id, amountMinor: 400_000 });
    expect((await getCompanyTotals(range)).thirdPartyInr).toBe(0);
    await markPayoutPaid(w.sa, payout.id, { paidOn: dayStr(-2), ...PAY });
    expect((await getCompanyTotals(range)).thirdPartyInr).toBe(400_000);
    await voidPayout(w.sa, payout.id, 'Paid twice');
    expect((await getCompanyTotals(range)).thirdPartyInr).toBe(0);
  });

  it('an archived third party can no longer be paid, and archiving waits for due payouts', async () => {
    const { w, order } = await setup();
    const { payout } = await createPayout(w.sa, { workOrderId: order.id, amountMinor: 1000 });
    expect((await rejects(archiveThirdParty(w.sa, id(w.party)))).code).toBe('CONFLICT');
    await markPayoutPaid(w.sa, payout.id, { paidOn: dayStr(0), ...PAY });
    await changeWorkOrderStatus(w.sa, order.id, { status: 'closed' });
    await archiveThirdParty(w.sa, id(w.party));
    expect((await rejects(createPayout(w.sa, { thirdPartyId: id(w.party), projectId: id(w.project), amountMinor: 1, currency: 'INR' }))).fields?.thirdPartyId).toBeDefined();
    expect((await ThirdParty.findById(w.party._id).lean())?.archivedAt).toBeDefined();
  });
});



