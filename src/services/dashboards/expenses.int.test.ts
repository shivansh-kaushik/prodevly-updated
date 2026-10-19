import { describe, expect, it } from 'vitest';
import { getExpensesDashboard, type ExpensesDashboard, type MyExpensesSummary } from '@/services/dashboards/expenses';
import { setupTestDb } from '@/test/db';
import { D, holding, insertExpense, makeExpenseWorld } from '@/test/expense-factories';
import { makeClient, makeProject } from '@/test/domain-factories';
import { makeAdmin, sessionFor } from '@/test/factories';

setupTestDb();

const FY27 = { from: D('2026-04-01'), to: D('2027-03-31') };

const all = async (p: Promise<unknown>) => (await p) as ExpensesDashboard;
const own = async (p: Promise<unknown>) => (await p) as MyExpensesSummary;

describe('the expenses dashboard on an empty database', () => {
  it('renders zeros, a zero-filled month for every month of the period, and empty lists', async () => {
    const w = await makeExpenseWorld();
    const d = await all(getExpensesDashboard(w.superSession, FY27));
    expect(d).toMatchObject({
      scope: 'all',
      range: { from: '2026-04-01', to: '2027-03-31' },
      spent: { count: 0, inrMinor: 0, foreign: [] },
      company: { count: 0, inrMinor: 0 },
      project: { count: 0, inrMinor: 0 },
      awaitingApproval: { count: 0, inrMinor: 0 },
      owedToAdmins: { count: 0, inrMinor: 0, byAdmin: [] },
      byCategory: [],
      byProject: [],
    });
    expect(d.perMonth.categories).toEqual([]);
    expect(d.perMonth.hasOther).toBe(false);
    expect(d.perMonth.rows).toHaveLength(12);
    expect(d.perMonth.rows[0]).toMatchObject({ month: '2026-04', byCategory: {}, other: 0 });
    expect(d.perMonth.rows[11]?.month).toBe('2027-03');
  });
});

describe('the numbers come from the records', () => {
  async function seeded() {
    const w = await makeExpenseWorld();
    const p1 = w.project;
    const p2 = await makeProject(w.client);
    const rows = {
      a: await insertExpense({ status: 'paid', amountMinor: 100_000, spentOn: '2026-06-10', category: 'software_subscriptions' }),
      b: await insertExpense({ status: 'approved', paidBy: w.plain, amountMinor: 50_000, spentOn: '2026-07-15', category: 'travel', project: p1 }),
      c: await insertExpense({ status: 'paid', amountMinor: 100_000, currency: 'USD', spentOn: '2026-08-05', category: 'hosting_domains' }),
      d: await insertExpense({ status: 'submitted', paidBy: w.plain, amountMinor: 20_000, spentOn: '2026-09-01' }),
      e: await insertExpense({ status: 'approved', paidBy: w.other, amountMinor: 70_000, spentOn: '2026-09-10', category: 'office' }),
      f: await insertExpense({ status: 'rejected', paidBy: w.plain, amountMinor: 900_000, spentOn: '2026-06-12' }),
      g: await insertExpense({ status: 'void', amountMinor: 700_000, spentOn: '2026-06-13' }),
      h: await insertExpense({ status: 'paid', amountMinor: 25_000, spentOn: '2025-06-01' }),
      i: await insertExpense({ status: 'submitted', paidBy: w.plain, amountMinor: 5_000, spentOn: '2025-03-20' }),
      j: await insertExpense({ status: 'paid', amountMinor: 10_000, spentOn: '2026-06-20', category: 'travel', project: p2 }),
    };
    return { w, p1, p2, rows };
  }

  it('totals what is spent in the period: approved and paid, never submitted, rejected or void', async () => {
    const { w } = await seeded();
    const d = await all(getExpensesDashboard(w.superSession, FY27));
    expect(d.spent).toEqual({ count: 5, inrMinor: 8_572_000, foreign: [{ currency: 'USD', nativeMinor: 100_000, inrMinor: 8_342_000 }] });
    // The company against project split adds back up to what is spent.
    expect(d.company).toEqual({ count: 3, inrMinor: 8_512_000 });
    expect(d.project).toEqual({ count: 2, inrMinor: 60_000 });
    expect(d.company.inrMinor + d.project.inrMinor).toBe(d.spent.inrMinor);
  });

  it('counts the queues for every date: awaiting approval, and what we owe our admins', async () => {
    const { w } = await seeded();
    const d = await all(getExpensesDashboard(w.superSession, FY27));
    // d (this year) and i (last year) are both still waiting.
    expect(d.awaitingApproval).toEqual({ count: 2, inrMinor: 25_000 });
    expect(d.owedToAdmins.count).toBe(2);
    expect(d.owedToAdmins.inrMinor).toBe(120_000);
    expect(d.owedToAdmins.byAdmin).toEqual([
      { adminId: String(w.other._id), name: w.other.name, count: 1, inrMinor: 70_000 },
      { adminId: String(w.plain._id), name: w.plain.name, count: 1, inrMinor: 50_000 },
    ]);
    // A different period changes the spend but not the queues.
    const later = await all(getExpensesDashboard(w.superSession, { from: D('2027-01-01'), to: D('2027-01-31') }));
    expect(later.spent.inrMinor).toBe(0);
    expect(later.awaitingApproval).toEqual({ count: 2, inrMinor: 25_000 });
    expect(later.owedToAdmins.inrMinor).toBe(120_000);
  });

  it('splits spend by category and by project, largest first', async () => {
    const { w, p1, p2 } = await seeded();
    const d = await all(getExpensesDashboard(w.superSession, FY27));
    expect(d.byCategory).toEqual([
      { category: 'hosting_domains', count: 1, inrMinor: 8_342_000 },
      { category: 'software_subscriptions', count: 1, inrMinor: 100_000 },
      { category: 'office', count: 1, inrMinor: 70_000 },
      { category: 'travel', count: 2, inrMinor: 60_000 },
    ]);
    expect(d.byProject).toEqual([
      { projectId: String(p1._id), ref: p1.ref, name: p1.name, count: 1, inrMinor: 50_000 },
      { projectId: String(p2._id), ref: p2.ref, name: p2.name, count: 1, inrMinor: 10_000 },
    ]);
  });

  it('spreads spend over the months of the period by category', async () => {
    const { w } = await seeded();
    const d = await all(getExpensesDashboard(w.superSession, FY27));
    expect(d.perMonth.categories).toEqual(['hosting_domains', 'software_subscriptions', 'office', 'travel']);
    expect(d.perMonth.hasOther).toBe(false);
    const month = (m: string) => d.perMonth.rows.find((r) => r.month === m);
    expect(month('2026-06')).toMatchObject({ byCategory: { software_subscriptions: 100_000, travel: 10_000, hosting_domains: 0, office: 0 }, other: 0 });
    expect(month('2026-07')?.byCategory.travel).toBe(50_000);
    expect(month('2026-08')?.byCategory.hosting_domains).toBe(8_342_000);
    expect(month('2026-09')?.byCategory.office).toBe(70_000);
    expect(month('2026-05')?.byCategory).toEqual({ hosting_domains: 0, software_subscriptions: 0, office: 0, travel: 0 });
    // every month of the chart adds up to the spend
    const charted = d.perMonth.rows.reduce((s, r) => s + Object.values(r.byCategory).reduce((a, b) => a + b, 0) + r.other, 0);
    expect(charted).toBe(d.spent.inrMinor);
  });

  it('narrows to a custom period', async () => {
    const { w } = await seeded();
    const june = await all(getExpensesDashboard(w.superSession, { from: D('2026-06-01'), to: D('2026-06-30') }));
    expect(june.spent).toMatchObject({ count: 2, inrMinor: 110_000, foreign: [] });
    expect(june.perMonth.rows).toHaveLength(1);
  });

  it('keeps the top five categories and folds the rest into other', async () => {
    const w = await makeExpenseWorld();
    const categories = ['software_subscriptions', 'hosting_domains', 'hardware', 'travel', 'office', 'marketing', 'fees_taxes'];
    for (const [i, category] of categories.entries()) await insertExpense({ category, amountMinor: (categories.length - i) * 10_000, spentOn: '2026-06-10' });
    const d = await all(getExpensesDashboard(w.superSession, FY27));
    expect(d.perMonth.categories).toEqual(categories.slice(0, 5));
    expect(d.perMonth.hasOther).toBe(true);
    expect(d.perMonth.rows.find((r) => r.month === '2026-06')?.other).toBe(2 * 10_000 + 1 * 10_000);
    expect(d.byCategory).toHaveLength(7);
  });

  it('shows the ten projects with the most spend and no more', async () => {
    const w = await makeExpenseWorld();
    const client = await makeClient();
    for (let i = 1; i <= 11; i++) await insertExpense({ project: await makeProject(client), amountMinor: i * 1_000 });
    const d = await all(getExpensesDashboard(w.superSession, FY27));
    expect(d.byProject).toHaveLength(10);
    expect(d.byProject.map((p) => p.inrMinor)).toEqual([11_000, 10_000, 9_000, 8_000, 7_000, 6_000, 5_000, 4_000, 3_000, 2_000]);
  });

  it('adds up foreign currencies by currency, as a secondary line beside the INR total', async () => {
    const w = await makeExpenseWorld();
    await insertExpense({ currency: 'USD', amountMinor: 100_000 });
    await insertExpense({ currency: 'USD', amountMinor: 50_000 });
    await insertExpense({ currency: 'EUR', amountMinor: 20_000, rate: 90 });
    await insertExpense({ amountMinor: 10_000 });
    const d = await all(getExpensesDashboard(w.superSession, FY27));
    expect(d.spent.foreign).toEqual([
      { currency: 'EUR', nativeMinor: 20_000, inrMinor: 1_800_000 },
      { currency: 'USD', nativeMinor: 150_000, inrMinor: 12_513_000 },
    ]);
    expect(d.spent.inrMinor).toBe(1_800_000 + 12_513_000 + 10_000);
  });
});

describe('who sees what', () => {
  it('gives a viewer of all expenses, including a recorder, the full dashboard', async () => {
    const w = await makeExpenseWorld();
    await insertExpense({ amountMinor: 10_000 });
    expect((await getExpensesDashboard(w.recorderSession, FY27)).scope).toBe('all');
    expect((await getExpensesDashboard(holding(w.plainSession, 'expense:view'), FY27)).scope).toBe('all');
  });

  it('gives a plain admin only a summary of their own out-of-pocket expenses', async () => {
    const w = await makeExpenseWorld();
    await insertExpense({ status: 'submitted', paidBy: w.plain, amountMinor: 20_000 });
    await insertExpense({ status: 'submitted', paidBy: w.plain, amountMinor: 5_000, spentOn: '2025-03-20' });
    await insertExpense({ status: 'approved', paidBy: w.plain, amountMinor: 50_000 });
    await insertExpense({ status: 'paid', paidBy: w.plain, amountMinor: 30_000, spentOn: '2026-06-01' });
    await insertExpense({ status: 'paid', paidBy: w.plain, amountMinor: 99_000, spentOn: '2025-06-01' });
    await insertExpense({ status: 'rejected', paidBy: w.plain, amountMinor: 900_000, spentOn: '2026-06-12' });
    await insertExpense({ status: 'submitted', paidBy: w.other, amountMinor: 777_000 }); // someone else's
    await insertExpense({ status: 'paid', amountMinor: 888_000 }); // company-paid
    const d = await own(getExpensesDashboard(w.plainSession, FY27));
    expect(d).toEqual({
      scope: 'own',
      range: { from: '2026-04-01', to: '2027-03-31' },
      awaitingApproval: { count: 2, inrMinor: 25_000 },
      toBePaid: { count: 1, inrMinor: 50_000 },
      paidInPeriod: { count: 1, inrMinor: 30_000 },
      rejectedInPeriod: { count: 1 },
    });
    expect(JSON.stringify(d)).not.toMatch(/777000|888000/);
  });

  it('shows a plain admin zeros, not someone else\'s numbers, when they have submitted nothing', async () => {
    const w = await makeExpenseWorld();
    await insertExpense({ status: 'submitted', paidBy: w.other, amountMinor: 20_000 });
    const d = await own(getExpensesDashboard(w.plainSession, FY27));
    expect(d).toMatchObject({ awaitingApproval: { count: 0, inrMinor: 0 }, toBePaid: { count: 0 }, paidInPeriod: { count: 0 }, rejectedInPeriod: { count: 0 } });
  });

  it('refuses a viewer who may neither submit nor view expenses', async () => {
    const nobody = holding(await sessionFor(await makeAdmin()));
    await expect(getExpensesDashboard(nobody, FY27)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
