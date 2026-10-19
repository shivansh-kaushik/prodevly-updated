import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { AuditLog, Expense, FxRate, Project, Task } from '@/models';
import {
  approveExpense,
  createExpense,
  expenseAbilities,
  getExpense,
  getExpenseFilterLabels,
  markExpensePaid,
  rejectExpense,
  searchExpenses,
  updateExpense,
  voidExpense,
} from '@/services/expense.service';
import { setupTestDb } from '@/test/db';
import { companyPaid, D, holding, insertExpense, makeExpenseWorld, NOW, outOfPocket, without } from '@/test/expense-factories';
import { makeAdmin, sessionFor } from '@/test/factories';
import { makeMedia } from '@/test/content-factories';
import { setSettings } from '@/test/settings-factories';

setupTestDb();

const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; fields?: Record<string, string>; message?: string };
  }
  throw new Error('expected the call to be rejected');
};
const id = (d: { _id: Types.ObjectId }) => String(d._id);
const audits = (action: string) => AuditLog.find({ action }).lean();

describe('who may record and who may submit', () => {
  it('lets a recorder record a company-paid expense directly as paid, with who, when and how', async () => {
    const w = await makeExpenseWorld();
    const e = await createExpense(w.recorderSession, companyPaid(), {}, NOW);
    expect(e).toMatchObject({
      ref: 'EXP-FY27-0001',
      status: 'paid',
      paidFrom: 'company',
      paidBy: null,
      scope: 'company',
      project: null,
      paidOn: '2026-10-06',
      mode: 'bank_transfer',
      amount: { amountMinor: 250_000, currency: 'INR', inrMinor: 250_000 },
      recordedBy: w.recorder.name,
    });
    expect(e.statusHistory).toEqual([expect.objectContaining({ from: null, to: 'paid', by: w.recorder.name })]);
    const [entry] = await audits('expense.create');
    expect(entry).toMatchObject({ actor: { name: w.recorder.name }, entity: { type: 'expense', ref: 'EXP-FY27-0001' } });
  });

  it('refuses a company-paid record from a plain admin, and writes nothing', async () => {
    const w = await makeExpenseWorld();
    expect((await rejects(createExpense(w.plainSession, companyPaid(), {}, NOW))).code).toBe('FORBIDDEN');
    expect(await Expense.countDocuments()).toBe(0);
    expect(await AuditLog.countDocuments()).toBe(0);
  });

  it('refuses everything to someone with no expense capability at all', async () => {
    const w = await makeExpenseWorld();
    const nobody = holding(w.plainSession);
    expect((await rejects(createExpense(nobody, outOfPocket(), {}, NOW))).code).toBe('FORBIDDEN');
    expect((await rejects(createExpense(nobody, companyPaid(), {}, NOW))).code).toBe('FORBIDDEN');
    expect((await rejects(searchExpenses(nobody))).code).toBe('FORBIDDEN');
    const e = await insertExpense();
    expect((await rejects(getExpense(nobody, id(e)))).code).toBe('FORBIDDEN');
    expect((await rejects(updateExpense(nobody, id(e), { description: 'Changed it' }))).code).toBe('FORBIDDEN');
    expect((await rejects(voidExpense(nobody, id(e), { reason: 'Because' }))).code).toBe('FORBIDDEN');
  });

  it('submits an out-of-pocket expense as the submitter, never as anyone else', async () => {
    const w = await makeExpenseWorld();
    const e = await createExpense(w.plainSession, outOfPocket(), {}, NOW);
    expect(e).toMatchObject({ status: 'submitted', paidFrom: 'admin', paidBy: { id: id(w.plain), name: w.plain.name }, paidOn: null, mode: null });
    expect(e.statusHistory.map((h) => h.to)).toEqual(['submitted']);
    // A body cannot name another payer, and cannot carry payment details: that is the reimbursement's job.
    expect((await rejects(createExpense(w.plainSession, { ...outOfPocket(), paidByAdmin: { id: id(w.other), name: 'x' } } as never, {}, NOW))).code).toBe('VALIDATION_FAILED');
    const withPayment = await rejects(createExpense(w.plainSession, outOfPocket({ paidOn: '2026-10-06', mode: 'upi', transactionRef: 'X1' }), {}, NOW));
    expect(Object.keys(withPayment.fields ?? {}).sort()).toEqual(['mode', 'paidOn', 'transactionRef']);
    expect(await Expense.countDocuments()).toBe(1);
  });

  it('lets a superadmin submit their own out-of-pocket expense (they are the payer)', async () => {
    const w = await makeExpenseWorld();
    const e = await createExpense(w.superSession, outOfPocket(), {}, NOW);
    expect(e.paidBy?.id).toBe(id(w.superadmin));
    expect(e.status).toBe('submitted');
  });

  it('needs the date paid and the mode for a company-paid expense', async () => {
    const w = await makeExpenseWorld();
    const err = await rejects(createExpense(w.recorderSession, companyPaid({ paidOn: undefined, mode: undefined }), {}, NOW));
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(err.fields ?? {}).sort()).toEqual(['mode', 'paidOn']);
  });

  it('refuses dates in the future and impossible dates', async () => {
    const w = await makeExpenseWorld();
    expect((await rejects(createExpense(w.recorderSession, companyPaid({ spentOn: '2026-10-13', paidOn: '2026-10-12' }), {}, NOW))).fields?.spentOn).toMatch(/future/);
    expect((await rejects(createExpense(w.recorderSession, companyPaid({ paidOn: '2026-10-13' }), {}, NOW))).fields?.paidOn).toMatch(/future/);
    expect((await rejects(createExpense(w.recorderSession, companyPaid({ spentOn: '2026-02-30' }), {}, NOW))).code).toBe('VALIDATION_FAILED');
    // today in the organisation's zone is allowed (India is ahead of UTC)
    expect((await createExpense(w.recorderSession, companyPaid({ spentOn: '2026-10-12', paidOn: '2026-10-12' }), {}, new Date('2026-10-11T20:00:00Z'))).spentOn).toBe('2026-10-12');
  });
});

describe('visibility: a plain admin sees only their own out-of-pocket expenses', () => {
  async function seeded() {
    const w = await makeExpenseWorld();
    const mine = await createExpense(w.plainSession, outOfPocket({ description: 'My taxi' }), {}, NOW);
    const theirs = await createExpense(w.otherSession, outOfPocket({ description: 'Their lunch' }), {}, NOW);
    const company = await createExpense(w.recorderSession, companyPaid(), {}, NOW);
    return { w, mine, theirs, company };
  }

  it('lists only their own, whatever filters they pass', async () => {
    const { w, mine, theirs } = await seeded();
    const page = await searchExpenses(w.plainSession);
    expect(page.items.map((i) => i.id)).toEqual([mine.id]);
    expect(page.meta.total).toBe(1);
    // Asking for someone else's, or for company-paid ones, changes nothing.
    expect((await searchExpenses(w.plainSession, { personId: id(w.other) })).items.map((i) => i.id)).toEqual([mine.id]);
    expect((await searchExpenses(w.plainSession, { paidFrom: 'company' })).items.map((i) => i.id)).toEqual([mine.id]);
    expect((await searchExpenses(w.plainSession, { q: 'lunch' })).items).toHaveLength(0);
    expect(page.items.some((i) => i.id === theirs.id)).toBe(false);
  });

  it('answers NOT_FOUND for someone else\'s expense and for a company one, on every read and write', async () => {
    const { w, theirs, company } = await seeded();
    for (const other of [theirs.id, company.id]) {
      expect((await rejects(getExpense(w.plainSession, other))).code).toBe('NOT_FOUND');
      expect((await rejects(updateExpense(w.plainSession, other, { description: 'Edited by a stranger' }))).code).toBe('NOT_FOUND');
      expect((await rejects(voidExpense(w.plainSession, other, { reason: 'Not yours to void' }))).code).toBe('NOT_FOUND');
    }
    expect((await Expense.findById(theirs.id).lean())?.status).toBe('submitted');
  });

  it('shows everything to a viewer with expense:view, and filters by person for them', async () => {
    const { w, mine, theirs, company } = await seeded();
    const all = await searchExpenses(w.recorderSession);
    expect(all.items.map((i) => i.id).sort()).toEqual([mine.id, theirs.id, company.id].sort());
    expect((await searchExpenses(w.recorderSession, { personId: id(w.other) })).items.map((i) => i.id)).toEqual([theirs.id]);
    expect((await searchExpenses(w.recorderSession, { paidFrom: 'company' })).items.map((i) => i.id)).toEqual([company.id]);
    expect((await getExpense(w.recorderSession, theirs.id)).description).toBe('Their lunch');
  });

  it('searches text literally, never as a pattern', async () => {
    const w = await makeExpenseWorld();
    await insertExpense({ description: 'Hosting (annual) [prod]' });
    await insertExpense({ description: 'Hostingxannual' });
    expect((await searchExpenses(w.superSession, { q: '(annual)' })).items.map((i) => i.description)).toEqual(['Hosting (annual) [prod]']);
    expect((await searchExpenses(w.superSession, { q: '.*' })).items).toHaveLength(0);
  });

  it('filters by status, scope, category and project, and sums only what is settled', async () => {
    const w = await makeExpenseWorld();
    await insertExpense({ status: 'paid', amountMinor: 100_000, category: 'travel', project: w.project });
    await insertExpense({ status: 'approved', paidBy: w.plain, amountMinor: 50_000 });
    await insertExpense({ status: 'submitted', paidBy: w.plain, amountMinor: 20_000 });
    await insertExpense({ status: 'rejected', paidBy: w.plain, amountMinor: 900_000 });
    await insertExpense({ status: 'void', amountMinor: 700_000 });
    const all = await searchExpenses(w.superSession);
    expect(all.meta.total).toBe(5);
    expect(all.settledInr).toBe(150_000);
    expect((await searchExpenses(w.superSession, { status: 'settled' })).meta.total).toBe(2);
    expect((await searchExpenses(w.superSession, { status: 'rejected' })).items[0]?.status).toBe('rejected');
    expect((await searchExpenses(w.superSession, { scope: 'project' })).meta.total).toBe(1);
    expect((await searchExpenses(w.superSession, { category: 'travel' })).meta.total).toBe(1);
    const byProject = await searchExpenses(w.superSession, { projectId: id(w.project) });
    expect(byProject.items.map((i) => i.project?.id)).toEqual([id(w.project)]);
    expect((await rejects(searchExpenses(w.superSession, { status: 'bogus' as never }))).code).toBe('VALIDATION_FAILED');
  });

  it('applies the period to the spend date, but shows the queues for every date', async () => {
    const w = await makeExpenseWorld();
    await insertExpense({ status: 'paid', spentOn: '2026-05-01' });
    await insertExpense({ status: 'paid', spentOn: '2025-05-01' });
    await insertExpense({ status: 'submitted', paidBy: w.plain, spentOn: '2025-03-20' });
    const range = { from: D('2026-04-01'), to: D('2027-03-31') };
    expect((await searchExpenses(w.superSession, { range })).meta.total).toBe(1);
    expect((await searchExpenses(w.superSession, { range, status: 'submitted' })).meta.total).toBe(1);
    expect((await searchExpenses(w.superSession, { range, status: 'paid' })).meta.total).toBe(1);
  });

  it('pages and sorts', async () => {
    const w = await makeExpenseWorld();
    for (const amountMinor of [300, 100, 200]) await insertExpense({ amountMinor });
    const asc = await searchExpenses(w.superSession, { sort: 'amount', dir: 'asc', pageSize: 2 });
    expect(asc.items.map((i) => i.amount.amountMinor)).toEqual([100, 200]);
    expect(asc.meta).toMatchObject({ total: 3, pages: 2 });
    expect((await searchExpenses(w.superSession, { sort: 'amount', dir: 'asc', pageSize: 2, page: 2 })).items.map((i) => i.amount.amountMinor)).toEqual([300]);
  });

  it('names the project and person behind a filter, for the pickers', async () => {
    const w = await makeExpenseWorld();
    const labels = await getExpenseFilterLabels(w.superSession, { projectId: id(w.project), personId: id(w.plain) });
    expect(labels).toEqual({ project: { id: id(w.project), label: w.project.name, ref: w.project.ref }, person: { id: id(w.plain), label: w.plain.name } });
    expect((await getExpenseFilterLabels(w.plainSession, { personId: id(w.other) })).person).toBeNull();
  });
});

describe('the approval flow', () => {
  it('submitted -> approved -> paid, with the trail, the audit entries and the reimbursement details', async () => {
    const w = await makeExpenseWorld();
    const sub = await createExpense(w.plainSession, outOfPocket(), {}, NOW);

    const approved = await approveExpense(w.superSession, sub.id, {}, NOW);
    expect(approved).toMatchObject({ status: 'approved', approvedBy: w.superadmin.name });
    expect(approved.approvedAt).toBe(NOW.toISOString());

    const paid = await markExpensePaid(w.superSession, sub.id, { paidOn: '2026-10-10', mode: 'upi', transactionRef: 'UTR-998877' }, {}, NOW);
    expect(paid).toMatchObject({ status: 'paid', paidOn: '2026-10-10', mode: 'upi', transactionRef: 'UTR-998877' });
    expect(paid.statusHistory.map((h) => [h.from, h.to, h.by])).toEqual([
      [null, 'submitted', w.plain.name],
      ['submitted', 'approved', w.superadmin.name],
      ['approved', 'paid', w.superadmin.name],
    ]);
    expect((await audits('expense.approve'))[0]?.summary).toMatch(new RegExp(`we now owe ${w.plain.name}`));
    expect((await audits('expense.mark_paid'))[0]?.changes.map((c) => c.path)).toEqual(['status', 'paidOn', 'mode', 'transactionRef']);
  });

  it('records a reimbursement made in cash with no reference', async () => {
    const w = await makeExpenseWorld();
    const sub = await createExpense(w.plainSession, outOfPocket(), {}, NOW);
    await approveExpense(w.superSession, sub.id, {}, NOW);
    const paid = await markExpensePaid(w.superSession, sub.id, { paidOn: '2026-10-11', mode: 'cash' }, {}, NOW);
    expect(paid).toMatchObject({ status: 'paid', mode: 'cash', transactionRef: null });
  });

  it('rejects with a reason, which stays on record and out of every total', async () => {
    const w = await makeExpenseWorld();
    const sub = await createExpense(w.plainSession, outOfPocket(), {}, NOW);
    expect((await rejects(rejectExpense(w.superSession, sub.id, { reason: ' ' }))).fields?.reason).toBeDefined();
    const rejected = await rejectExpense(w.superSession, sub.id, { reason: 'Personal trip' }, {}, NOW);
    expect(rejected).toMatchObject({ status: 'rejected', rejectReason: 'Personal trip' });
    expect(rejected.statusHistory.at(-1)).toMatchObject({ to: 'rejected', note: 'Personal trip' });
    expect((await searchExpenses(w.superSession, { status: 'settled' })).settledInr).toBe(0);
    expect((await searchExpenses(w.plainSession)).items[0]?.status).toBe('rejected'); // the submitter can still see why
  });

  it('refuses every illegal move with a CONFLICT and changes nothing', async () => {
    const w = await makeExpenseWorld();
    const make = async (status: 'submitted' | 'approved' | 'paid' | 'rejected' | 'void') => id(await insertExpense({ status, paidBy: w.plain }));
    const [submitted, approved, paid, rejected, voided] = [await make('submitted'), await make('approved'), await make('paid'), await make('rejected'), await make('void')];
    const mark = { paidOn: '2026-10-10', mode: 'upi' };
    const reason = { reason: 'Not allowed' };

    const illegal: Array<[string, () => Promise<unknown>]> = [
      ['approve approved', () => approveExpense(w.superSession, approved)],
      ['approve paid', () => approveExpense(w.superSession, paid)],
      ['approve rejected', () => approveExpense(w.superSession, rejected)],
      ['approve void', () => approveExpense(w.superSession, voided)],
      ['reject approved', () => rejectExpense(w.superSession, approved, reason)],
      ['reject paid', () => rejectExpense(w.superSession, paid, reason)],
      ['reject rejected', () => rejectExpense(w.superSession, rejected, reason)],
      ['mark paid submitted', () => markExpensePaid(w.superSession, submitted, mark)],
      ['mark paid paid', () => markExpensePaid(w.superSession, paid, mark)],
      ['mark paid rejected', () => markExpensePaid(w.superSession, rejected, mark)],
      ['mark paid void', () => markExpensePaid(w.superSession, voided, mark)],
      ['void void', () => voidExpense(w.superSession, voided, reason)],
      ['void rejected', () => voidExpense(w.superSession, rejected, reason)],
      ['edit rejected', () => updateExpense(w.superSession, rejected, { description: 'Edited later' })],
      ['edit void', () => updateExpense(w.superSession, voided, { description: 'Edited later' })],
    ];
    for (const [name, attempt] of illegal) expect((await rejects(attempt())).code, name).toBe('CONFLICT');
    expect(await AuditLog.countDocuments()).toBe(0);
    expect((await Expense.findById(approved).lean())?.status).toBe('approved');
  });

  it('refuses a second decision on the same expense even when two arrive at once', async () => {
    const w = await makeExpenseWorld();
    const sub = await createExpense(w.plainSession, outOfPocket(), {}, NOW);
    const results = await Promise.allSettled([approveExpense(w.superSession, sub.id, {}, NOW), rejectExpense(w.superSession, sub.id, { reason: 'Changed my mind' }, {}, NOW)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const after = await Expense.findById(sub.id).lean();
    expect(['approved', 'rejected']).toContain(after?.status);
    expect(after?.statusHistory).toHaveLength(2);
  });

  it('checks the reimbursement: not in the future, not before the spend, and a mode from Settings', async () => {
    const w = await makeExpenseWorld();
    const sub = await createExpense(w.plainSession, outOfPocket({ spentOn: '2026-10-05' }), {}, NOW);
    await approveExpense(w.superSession, sub.id, {}, NOW);
    expect((await rejects(markExpensePaid(w.superSession, sub.id, { paidOn: '2026-10-13', mode: 'upi' }, {}, NOW))).fields?.paidOn).toMatch(/future/);
    expect((await rejects(markExpensePaid(w.superSession, sub.id, { paidOn: '2026-10-04', mode: 'upi' }, {}, NOW))).fields?.paidOn).toMatch(/before/);
    expect((await rejects(markExpensePaid(w.superSession, sub.id, { paidOn: '2026-10-10', mode: 'barter' }, {}, NOW))).fields?.mode).toMatch(/Settings/);
    expect((await Expense.findById(sub.id).lean())?.status).toBe('approved');
  });

  it('keeps the money as captured at the spend date when it is reimbursed', async () => {
    const w = await makeExpenseWorld();
    const sub = await createExpense(w.plainSession, outOfPocket({ currency: 'USD', amountMinor: 10_000 }), {}, NOW);
    await approveExpense(w.superSession, sub.id, {}, NOW);
    await FxRate.create({ currency: 'USD', rateOn: D('2026-10-10'), rate: 90, source: 'manual', enteredBy: { id: null, name: 'Test' } });
    const paid = await markExpensePaid(w.superSession, sub.id, { paidOn: '2026-10-11', mode: 'wise' }, {}, NOW);
    expect(paid.amount.inrMinor).toBe(834_200);
    expect(paid.fx).toMatchObject({ rate: 83.42, source: 'table' });
  });
});

describe('who may approve, reject, pay and void', () => {
  it('needs money:approve to approve, reject or mark paid: plain admins and recorders are refused', async () => {
    const w = await makeExpenseWorld();
    const submitted = id(await insertExpense({ status: 'submitted', paidBy: w.plain }));
    const approved = id(await insertExpense({ status: 'approved', paidBy: w.plain }));
    for (const viewer of [w.plainSession, w.recorderSession, without(w.superSession, 'money:approve')]) {
      expect((await rejects(approveExpense(viewer, submitted))).code).toBe('FORBIDDEN');
      expect((await rejects(rejectExpense(viewer, submitted, { reason: 'No' + ' thanks' }))).code).toBe('FORBIDDEN');
      expect((await rejects(markExpensePaid(viewer, approved, { paidOn: '2026-10-10', mode: 'upi' }))).code).toBe('FORBIDDEN');
    }
    expect((await Expense.findById(submitted).lean())?.status).toBe('submitted');
    expect((await Expense.findById(approved).lean())?.status).toBe('approved');
    expect(await AuditLog.countDocuments()).toBe(0);
  });

  it('lets a submitter withdraw their own expense while it is submitted, and no later', async () => {
    const w = await makeExpenseWorld();
    const sub = await createExpense(w.plainSession, outOfPocket(), {}, NOW);
    const voided = await voidExpense(w.plainSession, sub.id, { reason: 'Entered by mistake' }, {}, NOW);
    expect(voided).toMatchObject({ status: 'void', voidReason: 'Entered by mistake' });

    const approved = await insertExpense({ status: 'approved', paidBy: w.plain });
    const err = await rejects(voidExpense(w.plainSession, id(approved), { reason: 'Changed my mind' }));
    expect(err.code).toBe('FORBIDDEN');
    expect((await Expense.findById(approved._id).lean())?.status).toBe('approved');
  });

  it('needs money:void for anything other than a withdrawal, and a reason', async () => {
    const w = await makeExpenseWorld();
    const paid = id(await insertExpense({ status: 'paid' }));
    expect((await rejects(voidExpense(w.recorderSession, paid, { reason: 'Wrong entry' }))).code).toBe('FORBIDDEN');
    expect((await rejects(voidExpense(w.superSession, paid, { reason: '' }))).fields?.reason).toBeDefined();
    const voided = await voidExpense(w.superSession, paid, { reason: 'Recorded twice' }, {}, NOW);
    expect(voided.status).toBe('void');
    expect((await audits('expense.void'))[0]).toMatchObject({ summary: 'Recorded twice', changes: [{ path: 'status', before: 'paid', after: 'void' }] });
  });

  it('lets a superadmin void every live status, and a voided expense leaves the totals', async () => {
    const w = await makeExpenseWorld();
    for (const status of ['submitted', 'approved', 'paid'] as const) {
      const e = await insertExpense({ status, paidBy: w.plain, amountMinor: 10_000 });
      expect((await voidExpense(w.superSession, id(e), { reason: 'Entered twice' }, {}, NOW)).status).toBe('void');
    }
    expect((await searchExpenses(w.superSession)).settledInr).toBe(0);
  });

  it('computes what each viewer may do, for the buttons on the page', async () => {
    const w = await makeExpenseWorld();
    const mine = await insertExpense({ status: 'submitted', paidBy: w.plain });
    const approved = await insertExpense({ status: 'approved', paidBy: w.plain });
    expect(expenseAbilities(w.plainSession, mine)).toEqual({ edit: true, editPayment: false, approve: false, reject: false, markPaid: false, void: true });
    expect(expenseAbilities(w.plainSession, approved)).toEqual({ edit: false, editPayment: false, approve: false, reject: false, markPaid: false, void: false });
    expect(expenseAbilities(w.recorderSession, approved)).toEqual({ edit: true, editPayment: false, approve: false, reject: false, markPaid: false, void: false });
    expect(expenseAbilities(w.superSession, mine)).toEqual({ edit: true, editPayment: false, approve: true, reject: true, markPaid: false, void: true });
    expect(expenseAbilities(w.superSession, approved)).toEqual({ edit: true, editPayment: false, approve: false, reject: false, markPaid: true, void: true });
    expect((await getExpense(w.superSession, id(mine))).can.approve).toBe(true);
  });
});

describe('scope and links', () => {
  it('derives the client from the project, and the project from the task', async () => {
    const w = await makeExpenseWorld();
    const byProject = await createExpense(w.recorderSession, companyPaid({ scope: 'project', projectId: id(w.project) }), {}, NOW);
    expect(byProject).toMatchObject({ scope: 'project', project: { id: id(w.project), clientId: id(w.client) }, task: null });
    const saved = await Expense.findById(byProject.id).lean();
    expect(String(saved?.clientId)).toBe(id(w.client));

    const byTask = await createExpense(w.recorderSession, companyPaid({ scope: 'project', taskId: id(w.task) }), {}, NOW);
    expect(byTask).toMatchObject({ project: { id: id(w.project) }, task: { id: id(w.task), ref: w.task.ref } });
    expect(String((await Expense.findById(byTask.id).lean())?.clientId)).toBe(id(w.client));
  });

  it('answers LINK_MISMATCH when the ids disagree, and writes nothing', async () => {
    const w = await makeExpenseWorld();
    const mismatches = [
      companyPaid({ scope: 'project', projectId: id(w.project), clientId: id(w.otherClient) }),
      companyPaid({ scope: 'project', projectId: id(w.project), taskId: id(w.otherTask) }),
      companyPaid({ scope: 'project', taskId: id(w.task), projectId: id(w.otherProject) }),
    ];
    for (const input of mismatches) expect((await rejects(createExpense(w.recorderSession, input, {}, NOW))).code).toBe('LINK_MISMATCH');
    expect(await Expense.countDocuments()).toBe(0);
    expect(await AuditLog.countDocuments()).toBe(0);
  });

  it('keeps a company expense free of any client, project or task, and a project expense tied to a project', async () => {
    const w = await makeExpenseWorld();
    for (const extra of [{ projectId: id(w.project) }, { taskId: id(w.task) }, { clientId: id(w.client) }]) {
      const err = await rejects(createExpense(w.recorderSession, companyPaid(extra), {}, NOW));
      expect(err.code).toBe('VALIDATION_FAILED');
      expect(err.fields?.scope).toMatch(/company expense/);
    }
    expect((await rejects(createExpense(w.recorderSession, companyPaid({ scope: 'project' }), {}, NOW))).fields?.projectId).toBeDefined();
    expect((await rejects(createExpense(w.recorderSession, companyPaid({ scope: 'project', projectId: String(new Types.ObjectId()) }), {}, NOW))).fields?.projectId).toMatch(/does not exist/);
    expect((await rejects(createExpense(w.recorderSession, companyPaid({ scope: 'project', taskId: String(new Types.ObjectId()) }), {}, NOW))).fields?.taskId).toMatch(/does not exist/);
  });

  it('will not charge a new expense to an archived project or a cancelled task', async () => {
    const w = await makeExpenseWorld();
    await Task.updateOne({ _id: w.task._id }, { $set: { status: 'cancelled' } });
    expect((await rejects(createExpense(w.recorderSession, companyPaid({ scope: 'project', taskId: id(w.task) }), {}, NOW))).code).toBe('CONFLICT');
    await Project.updateOne({ _id: w.project._id }, { $set: { archivedAt: new Date() } });
    expect((await rejects(createExpense(w.recorderSession, companyPaid({ scope: 'project', projectId: id(w.project) }), {}, NOW))).code).toBe('CONFLICT');
    expect(await Expense.countDocuments()).toBe(0);
  });

  it('touches the task inside the transaction, so a concurrent change of it conflicts', async () => {
    const w = await makeExpenseWorld();
    const before = (await Task.findById(w.task._id).lean())?.updatedAt as Date;
    await new Promise((r) => setTimeout(r, 15));
    await createExpense(w.recorderSession, companyPaid({ scope: 'project', projectId: id(w.project), taskId: id(w.task) }), {}, NOW);
    const after = (await Task.findById(w.task._id).lean())?.updatedAt as Date;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  it('keeps a task that already carries an expense from being moved to another project', async () => {
    const w = await makeExpenseWorld();
    await createExpense(w.recorderSession, companyPaid({ scope: 'project', taskId: id(w.task) }), {}, NOW);
    const { updateTask } = await import('@/services/task.service');
    expect((await rejects(updateTask(w.superSession, id(w.task), { projectId: id(w.otherProject) }))).code).toBe('HAS_LINKED_RECORDS');
  });

  it('moves an expense between project and company, re-deriving the links', async () => {
    const w = await makeExpenseWorld();
    const sub = await createExpense(w.plainSession, outOfPocket({ scope: 'project', projectId: id(w.project), taskId: id(w.task) }), {}, NOW);
    // The task belongs to the first project: moving the expense to another project without dropping the task is a mismatch.
    expect((await rejects(updateExpense(w.plainSession, sub.id, { projectId: id(w.otherProject) }, {}, NOW))).code).toBe('LINK_MISMATCH');
    const moved = await updateExpense(w.plainSession, sub.id, { projectId: id(w.otherProject), taskId: null }, {}, NOW);
    expect(moved).toMatchObject({ project: { id: id(w.otherProject), clientId: id(w.otherClient) }, task: null });
    const company = await updateExpense(w.plainSession, sub.id, { scope: 'company' }, {}, NOW);
    expect(company).toMatchObject({ scope: 'company', project: null, task: null });
    const saved = await Expense.findById(sub.id).lean();
    expect([saved?.clientId, saved?.projectId, saved?.taskId]).toEqual([undefined, undefined, undefined]);
  });
});

describe('category and payment mode come from Settings', () => {
  it('refuses a category that is not in the list, and takes one the list now holds', async () => {
    const w = await makeExpenseWorld();
    expect((await rejects(createExpense(w.recorderSession, companyPaid({ category: 'yachts' }), {}, NOW))).fields?.category).toMatch(/Settings/);
    await setSettings({ expenseCategories: ['yachts', 'other'] });
    expect((await createExpense(w.recorderSession, companyPaid({ category: 'yachts' }), {}, NOW)).category).toBe('yachts');
    expect((await rejects(createExpense(w.recorderSession, companyPaid({ category: 'travel' }), {}, NOW))).fields?.category).toBeDefined();
  });

  it('refuses a payment mode that is not in the list', async () => {
    const w = await makeExpenseWorld();
    expect((await rejects(createExpense(w.recorderSession, companyPaid({ mode: 'barter' }), {}, NOW))).fields?.mode).toMatch(/Settings/);
  });

  it('does not re-check an unchanged category, so an old expense stays editable after the list changes', async () => {
    const w = await makeExpenseWorld();
    const sub = await createExpense(w.plainSession, outOfPocket({ category: 'travel' }), {}, NOW);
    await setSettings({ expenseCategories: ['other'] });
    expect((await updateExpense(w.plainSession, sub.id, { description: 'Taxi, corrected' }, {}, NOW)).description).toBe('Taxi, corrected');
    expect((await rejects(updateExpense(w.plainSession, sub.id, { category: 'meals' }, {}, NOW))).fields?.category).toBeDefined();
  });
});

describe('the exchange rate is captured at the spend date', () => {
  it('stores INR as identity, and a foreign amount at the table rate with the INR computed on the server', async () => {
    const w = await makeExpenseWorld();
    const inr = await createExpense(w.recorderSession, companyPaid({ amountMinor: 123_456 }), {}, NOW);
    expect(inr.fx).toMatchObject({ rate: 1, source: 'identity' });
    const usd = await createExpense(w.recorderSession, companyPaid({ currency: 'USD', amountMinor: 100_000 }), {}, NOW);
    expect(usd.amount).toEqual({ amountMinor: 100_000, currency: 'USD', inrMinor: 8_342_000 });
    expect(usd.fx).toEqual({ rate: 83.42, rateOn: '2026-10-01', source: 'table' });
  });

  it('never takes an INR figure from the request, and refuses unknown fields', async () => {
    const w = await makeExpenseWorld();
    const err = await rejects(createExpense(w.recorderSession, { ...companyPaid({ currency: 'USD' }), amount: { inrMinor: 1 } } as never, {}, NOW));
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(await Expense.countDocuments()).toBe(0);
  });

  it('takes the exact rate the bank used, or the INR that arrived', async () => {
    const w = await makeExpenseWorld();
    const manual = await createExpense(w.recorderSession, companyPaid({ currency: 'USD', amountMinor: 100_000, manualRate: 84.5 }), {}, NOW);
    expect(manual).toMatchObject({ amount: { inrMinor: 8_450_000 }, fx: { rate: 84.5, source: 'manual' } });
    const bank = await createExpense(w.recorderSession, companyPaid({ currency: 'USD', amountMinor: 100_000, settledInrMinor: 8_300_000 }), {}, NOW);
    expect(bank).toMatchObject({ amount: { inrMinor: 8_300_000 }, fx: { rate: 83, source: 'bank' } });
    const both = await rejects(createExpense(w.recorderSession, companyPaid({ currency: 'USD', manualRate: 84, settledInrMinor: 8_000_000 }), {}, NOW));
    expect(both.fields?.manualRate).toBeDefined();
  });

  it('answers FX_RATE_MISSING when the table has no usable rate for the date, and for a disabled currency', async () => {
    const w = await makeExpenseWorld();
    const eur = await rejects(createExpense(w.recorderSession, companyPaid({ currency: 'EUR' }), {}, NOW));
    expect(eur.code).toBe('FX_RATE_MISSING');
    await FxRate.deleteMany({});
    await FxRate.create({ currency: 'USD', rateOn: D('2026-09-01'), rate: 80, source: 'manual', enteredBy: { id: null, name: 'Test' } });
    expect((await rejects(createExpense(w.recorderSession, companyPaid({ currency: 'USD' }), {}, NOW))).code).toBe('FX_RATE_MISSING');
    await setSettings({ enabledCurrencies: ['INR'] });
    expect((await rejects(createExpense(w.recorderSession, companyPaid({ currency: 'USD', manualRate: 84 }), {}, NOW))).fields?.currency).toMatch(/not turned on/);
    expect(await Expense.countDocuments()).toBe(0);
  });

  it('re-resolves the rate when the amount, currency or date changes, and keeps a hand-typed rate', async () => {
    const w = await makeExpenseWorld();
    const table = await createExpense(w.plainSession, outOfPocket({ currency: 'USD', amountMinor: 10_000 }), {}, NOW);
    const bigger = await updateExpense(w.plainSession, table.id, { amountMinor: 20_000 }, {}, NOW);
    expect(bigger.amount).toMatchObject({ amountMinor: 20_000, inrMinor: 1_668_400 });
    const toInr = await updateExpense(w.plainSession, table.id, { currency: 'INR', amountMinor: 5_000 }, {}, NOW);
    expect(toInr).toMatchObject({ amount: { currency: 'INR', inrMinor: 5_000 }, fx: { rate: 1, source: 'identity' } });

    const manual = await createExpense(w.plainSession, outOfPocket({ currency: 'USD', amountMinor: 10_000, manualRate: 85 }), {}, NOW);
    const kept = await updateExpense(w.plainSession, manual.id, { amountMinor: 30_000 }, {}, NOW);
    expect(kept).toMatchObject({ amount: { inrMinor: 2_550_000 }, fx: { rate: 85, source: 'manual' } });
    const moved = await updateExpense(w.plainSession, manual.id, { spentOn: '2026-10-06' }, {}, NOW);
    expect(moved.fx).toMatchObject({ rate: 85, source: 'manual' });
  });

  it('asks for the INR that arrived again when a bank-settled amount changes, and keeps it when only the date does', async () => {
    const w = await makeExpenseWorld();
    const bank = await createExpense(w.plainSession, outOfPocket({ currency: 'USD', amountMinor: 10_000, settledInrMinor: 830_000 }), {}, NOW);
    expect((await rejects(updateExpense(w.plainSession, bank.id, { amountMinor: 20_000 }, {}, NOW))).fields?.settledInrMinor).toBeDefined();
    expect((await updateExpense(w.plainSession, bank.id, { spentOn: '2026-10-06' }, {}, NOW)).amount.inrMinor).toBe(830_000);
    expect((await updateExpense(w.plainSession, bank.id, { amountMinor: 20_000, settledInrMinor: 1_660_000 }, {}, NOW)).amount.inrMinor).toBe(1_660_000);
  });
});

describe('receipts are private media, verified inside the transaction', () => {
  const receipt = (uploader: { _id: Types.ObjectId; name: string }, o: Parameters<typeof makeMedia>[0] = {}) =>
    makeMedia({ visibility: 'private', purpose: 'expense', uploader: { id: uploader._id, name: uploader.name }, ...o });

  it('attaches the submitter\'s own expense receipts, and shows them back to the submitter and to a viewer of all expenses', async () => {
    const w = await makeExpenseWorld();
    const file = await receipt(w.plain);
    const sub = await createExpense(w.plainSession, outOfPocket({ receiptMediaIds: [id(file)] }), {}, NOW);
    expect(sub.receiptCount).toBe(1);
    expect(sub.receipts.map((r) => r.id)).toEqual([id(file)]);
    expect((await getExpense(w.recorderSession, sub.id)).receipts).toHaveLength(1);
  });

  it('refuses a receipt that is public, for another purpose, missing, or someone else\'s upload, and writes nothing', async () => {
    const w = await makeExpenseWorld();
    const bad = [
      (await makeMedia({ visibility: 'public' }))._id,
      (await receipt(w.plain, { purpose: 'payment' }))._id,
      new Types.ObjectId(),
      (await receipt(w.other))._id,
    ];
    for (const media of bad) {
      const err = await rejects(createExpense(w.plainSession, outOfPocket({ receiptMediaIds: [String(media)] }), {}, NOW));
      expect(err.code).toBe('VALIDATION_FAILED');
      expect(err.fields?.receiptMediaIds).toBeDefined();
    }
    expect(await Expense.countDocuments()).toBe(0);
    expect(await AuditLog.countDocuments()).toBe(0);
  });

  it('lets a recorder attach any expense receipt, and rolls the whole write back when one receipt is bad', async () => {
    const w = await makeExpenseWorld();
    const good = await receipt(w.other);
    expect((await createExpense(w.recorderSession, companyPaid({ receiptMediaIds: [id(good)] }), {}, NOW)).receiptCount).toBe(1);
    const err = await rejects(createExpense(w.recorderSession, companyPaid({ receiptMediaIds: [id(good), String(new Types.ObjectId())] }), {}, NOW));
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(await Expense.countDocuments()).toBe(1);
    // The failed attempt took no reference number either: the next record is the second.
    expect((await createExpense(w.recorderSession, companyPaid(), {}, NOW)).ref).toBe('EXP-FY27-0002');
  });

  it('replaces receipts on an edit, checking only the new ones', async () => {
    const w = await makeExpenseWorld();
    const first = await receipt(w.plain);
    const second = await receipt(w.plain);
    const sub = await createExpense(w.plainSession, outOfPocket({ receiptMediaIds: [id(first)] }), {}, NOW);
    const edited = await updateExpense(w.plainSession, sub.id, { receiptMediaIds: [id(first), id(second)] }, {}, NOW);
    expect(edited.receipts.map((r) => r.id).sort()).toEqual([id(first), id(second)].sort());
    expect((await updateExpense(w.plainSession, sub.id, { receiptMediaIds: [] }, {}, NOW)).receiptCount).toBe(0);
    expect((await rejects(updateExpense(w.plainSession, sub.id, { receiptMediaIds: [id(await receipt(w.other))] }, {}, NOW))).fields?.receiptMediaIds).toBeDefined();
  });

  it('does not show a receipt the viewer cannot open', async () => {
    const w = await makeExpenseWorld();
    const file = await receipt(w.other);
    const e = await insertExpense({ paidBy: w.plain, status: 'submitted', receiptMediaIds: [file._id] });
    const seen = await getExpense(w.plainSession, id(e));
    expect(seen.receiptCount).toBe(1);
    expect(seen.receipts).toEqual([]);
  });
});

describe('editing', () => {
  it('lets a submitter edit their own submitted expense, with before and after in the audit log', async () => {
    const w = await makeExpenseWorld();
    const sub = await createExpense(w.plainSession, outOfPocket(), {}, NOW);
    const edited = await updateExpense(w.plainSession, sub.id, { description: 'Taxi to the airport', amountMinor: 60_000, payee: 'City Cabs' }, {}, NOW);
    expect(edited).toMatchObject({ description: 'Taxi to the airport', payee: 'City Cabs', amount: { amountMinor: 60_000, inrMinor: 60_000 } });
    const [entry] = await audits('expense.update');
    expect(entry?.changes).toEqual(
      expect.arrayContaining([
        { path: 'description', before: 'Taxi to the client office', after: 'Taxi to the airport' },
        { path: 'amount.amountMinor', before: 45_000, after: 60_000 },
        { path: 'amount.inrMinor', before: 45_000, after: 60_000 },
        { path: 'payee', before: null, after: 'City Cabs' },
      ]),
    );
  });

  it('writes nothing when nothing changes', async () => {
    const w = await makeExpenseWorld();
    const sub = await createExpense(w.plainSession, outOfPocket(), {}, NOW);
    const before = await Expense.findById(sub.id).lean();
    await updateExpense(w.plainSession, sub.id, { description: sub.description, amountMinor: sub.amount.amountMinor }, {}, NOW);
    expect(await AuditLog.countDocuments({ action: 'expense.update' })).toBe(0);
    expect((await Expense.findById(sub.id).lean())?.updatedAt).toEqual(before?.updatedAt);
    expect((await rejects(updateExpense(w.plainSession, sub.id, {}, {}, NOW))).code).toBe('VALIDATION_FAILED');
  });

  it('stops a submitter editing once the expense is approved, but lets a recorder, who recomputes the money', async () => {
    const w = await makeExpenseWorld();
    const sub = await createExpense(w.plainSession, outOfPocket({ currency: 'USD', amountMinor: 10_000 }), {}, NOW);
    await approveExpense(w.superSession, sub.id, {}, NOW);
    expect((await rejects(updateExpense(w.plainSession, sub.id, { description: 'Edited after approval' }, {}, NOW))).code).toBe('FORBIDDEN');
    const edited = await updateExpense(w.recorderSession, sub.id, { amountMinor: 12_000 }, {}, NOW);
    expect(edited).toMatchObject({ status: 'approved', amount: { amountMinor: 12_000, inrMinor: 1_001_040 } });
  });

  it('lets a recorder edit someone else\'s submitted expense, and a paid expense\'s payment details', async () => {
    const w = await makeExpenseWorld();
    const sub = await createExpense(w.plainSession, outOfPocket(), {}, NOW);
    expect((await updateExpense(w.recorderSession, sub.id, { category: 'office' }, {}, NOW)).category).toBe('office');
    // payment details exist only once it is paid
    expect((await rejects(updateExpense(w.recorderSession, sub.id, { mode: 'upi' }, {}, NOW))).fields?.mode).toBeDefined();
    const paid = await createExpense(w.recorderSession, companyPaid(), {}, NOW);
    const edited = await updateExpense(w.recorderSession, paid.id, { mode: 'cheque', transactionRef: 'CHQ 0042', paidOn: '2026-10-07' }, {}, NOW);
    expect(edited).toMatchObject({ mode: 'cheque', transactionRef: 'CHQ 0042', paidOn: '2026-10-07' });
    expect((await rejects(updateExpense(w.recorderSession, paid.id, { mode: 'barter' }, {}, NOW))).fields?.mode).toBeDefined();
    // a plain admin who submitted it cannot touch payment details even if it were paid
    const own = await insertExpense({ status: 'paid', paidBy: w.plain });
    expect((await rejects(updateExpense(w.plainSession, id(own), { mode: 'upi' }, {}, NOW))).code).toBe('FORBIDDEN');
  });

  it('leaves the payment details of a reimbursement to whoever may pay it back, not to a recorder', async () => {
    const w = await makeExpenseWorld();
    const reimbursed = id(await insertExpense({ status: 'paid', paidBy: w.plain }));
    expect((await rejects(updateExpense(w.recorderSession, reimbursed, { mode: 'cash' }, {}, NOW))).code).toBe('FORBIDDEN');
    expect((await getExpense(w.recorderSession, reimbursed)).can.editPayment).toBe(false);
    expect((await getExpense(w.superSession, reimbursed)).can.editPayment).toBe(true);
    expect((await updateExpense(w.superSession, reimbursed, { mode: 'cash', transactionRef: 'Receipt 7' }, {}, NOW))).toMatchObject({ mode: 'cash', transactionRef: 'Receipt 7' });
    // a recorder may still correct the description of it
    expect((await updateExpense(w.recorderSession, reimbursed, { description: 'Corrected wording' }, {}, NOW)).description).toBe('Corrected wording');
  });

  it('will not date a reimbursement before the spend', async () => {
    const w = await makeExpenseWorld();
    const own = await insertExpense({ status: 'paid', paidBy: w.plain, spentOn: '2026-10-05' });
    expect((await rejects(updateExpense(w.recorderSession, id(own), { spentOn: '2026-10-09' }, {}, NOW))).fields?.spentOn).toMatch(/reimbursement/);
  });
});

describe('amounts and references', () => {
  it('answers a 422, not a crash, for an amount too large to convert', async () => {
    const w = await makeExpenseWorld();
    const err = await rejects(createExpense(w.recorderSession, companyPaid({ currency: 'USD', amountMinor: Number.MAX_SAFE_INTEGER }), {}, NOW));
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields?.amountMinor).toBeDefined();
    expect(await Expense.countDocuments()).toBe(0);
  });

  it('numbers expenses recorded at the same moment without a clash, and restarts the number each financial year', async () => {
    const w = await makeExpenseWorld();
    const made = await Promise.all(Array.from({ length: 5 }, () => createExpense(w.recorderSession, companyPaid(), {}, NOW)));
    expect(made.map((e) => e.ref).sort()).toEqual(['EXP-FY27-0001', 'EXP-FY27-0002', 'EXP-FY27-0003', 'EXP-FY27-0004', 'EXP-FY27-0005']);
    const lastYear = await createExpense(w.recorderSession, companyPaid({ spentOn: '2026-03-20', paidOn: '2026-03-21' }), {}, NOW);
    expect(lastYear.ref).toBe('EXP-FY26-0001');
  });
});

describe('every change is audited in the same transaction', () => {
  it('writes one entry per action with the project in context, and none for a refused one', async () => {
    const w = await makeExpenseWorld();
    const sub = await createExpense(w.plainSession, outOfPocket({ scope: 'project', projectId: id(w.project), taskId: id(w.task) }), {}, NOW);
    await approveExpense(w.superSession, sub.id, { requestId: 'req-1' }, NOW);
    await markExpensePaid(w.superSession, sub.id, { paidOn: '2026-10-10', mode: 'upi' }, {}, NOW);
    await voidExpense(w.superSession, sub.id, { reason: 'Duplicate of EXP-2' }, {}, NOW);
    const entries = await AuditLog.find({ 'entity.id': new Types.ObjectId(sub.id) }).sort({ at: 1 }).lean();
    expect(entries.map((e) => e.action)).toEqual(['expense.create', 'expense.approve', 'expense.mark_paid', 'expense.void']);
    expect(String(entries[0]?.context?.projectId)).toBe(id(w.project));
    expect(String(entries[0]?.context?.taskId)).toBe(id(w.task));
    expect(entries[1]?.requestId).toBe('req-1');

    await rejects(approveExpense(w.superSession, sub.id));
    expect(await AuditLog.countDocuments()).toBe(4);
  });

  it('answers NOT_FOUND for a malformed or unknown id', async () => {
    const w = await makeExpenseWorld();
    for (const run of [(v: string) => getExpense(w.superSession, v), (v: string) => approveExpense(w.superSession, v), (v: string) => voidExpense(w.superSession, v, { reason: 'Nothing here' })]) {
      expect((await rejects(run('nope'))).code).toBe('NOT_FOUND');
      expect((await rejects(run(String(new Types.ObjectId())))).code).toBe('NOT_FOUND');
    }
  });

  it('refuses ids in the other spelling of an id as the same record, not as a different one', async () => {
    const w = await makeExpenseWorld();
    const sub = await createExpense(w.plainSession, outOfPocket(), {}, NOW);
    expect((await getExpense(w.plainSession, sub.id.toUpperCase())).id).toBe(sub.id);
    const stranger = await sessionFor(await makeAdmin());
    expect((await rejects(getExpense(stranger, sub.id.toUpperCase()))).code).toBe('NOT_FOUND');
  });
});
