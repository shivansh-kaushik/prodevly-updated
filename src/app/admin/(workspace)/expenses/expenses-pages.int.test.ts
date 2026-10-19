import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminProviders } from '@/components/admin/api-provider';
import { addDays, formatDateOnly, todayDateOnly } from '@/lib/dates/date-only';
import { approveExpense, createExpense } from '@/services/expense.service';
import { setupTestDb } from '@/test/db';
import { companyPaid, holding, insertExpense, makeExpenseWorld, outOfPocket } from '@/test/expense-factories';
import { makeAdmin, sessionFor } from '@/test/factories';
import type { SessionUser } from '@/types/session';
import NewExpensePage from './new/page';
import ExpensesPage from './page';
import ExpensePage from './[expenseId]/page';
import EditExpensePage from './[expenseId]/edit/page';

setupTestDb();

const guard = vi.hoisted(() => ({ viewer: null as unknown, calls: [] as Array<{ path?: string; capability?: string }> }));

// The real guard reads the session cookie; here the viewer is chosen by the test, and the guard's calls are recorded.
vi.mock('@/lib/auth/page-guard', () => ({
  getCurrentAdmin: async () => ({ admin: guard.viewer, hadCookie: true }),
  requireAdminPage: async (path?: string, options?: { capability?: string }) => {
    guard.calls.push({ path, capability: options?.capability });
    return guard.viewer as SessionUser;
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/admin/expenses',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

beforeEach(() => {
  guard.calls = [];
});

const render = async (page: (p: never) => Promise<React.ReactNode>, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(h(AdminProviders, null, (await page(props as never)) as React.ReactElement));
const list = (searchParams: Record<string, string> = {}) => render(ExpensesPage as never, { searchParams: Promise.resolve(searchParams) });
const detail = (id: string) => render(ExpensePage as never, { params: Promise.resolve({ expenseId: id }) });
const edit = (id: string) => render(EditExpensePage as never, { params: Promise.resolve({ expenseId: id }) });
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/** A date a couple of days back, in the current financial year whenever the test runs. */
const recent = (days = 2) => formatDateOnly(addDays(todayDateOnly(new Date(), 'Asia/Kolkata'), -days));

describe('the guard', () => {
  it('opens the list, new and detail pages for anyone who can submit or view expenses, and hides them from anyone else', async () => {
    const w = await makeExpenseWorld();
    guard.viewer = w.plainSession;
    await list();
    await render(NewExpensePage as never, { searchParams: Promise.resolve({}) });
    expect(guard.calls.map((c) => c.path)).toEqual(['/admin/expenses', '/admin/expenses/new']);

    guard.viewer = holding(w.plainSession);
    await expect(list()).rejects.toThrow('NOT_FOUND');
    await expect(render(NewExpensePage as never, { searchParams: Promise.resolve({}) })).rejects.toThrow('NOT_FOUND');
    await expect(detail(String(w.project._id))).rejects.toThrow('NOT_FOUND');
  });
});

describe('the list page', () => {
  it('shows a superadmin the dashboard, the filters and every expense, with the approval queue flagged', async () => {
    const w = await makeExpenseWorld();
    await insertExpense({ status: 'paid', amountMinor: 123_400, description: 'Design tool seats', spentOn: recent(), project: w.project, category: 'software_subscriptions' });
    await insertExpense({ status: 'submitted', paidBy: w.plain, amountMinor: 45_000, description: 'Taxi to the client office', spentOn: recent() });
    await insertExpense({ status: 'approved', paidBy: w.other, amountMinor: 70_000, description: 'Team lunch', spentOn: recent() });
    await insertExpense({ status: 'rejected', paidBy: w.other, amountMinor: 999_900, description: 'Personal flight', spentOn: recent() });
    guard.viewer = w.superSession;
    const html = await list();
    const t = text(html);
    expect(t).toContain('What the company spends, and what it owes its people');
    for (const label of ['Spent', 'Company overhead', 'Charged to projects', 'Awaiting approval', 'Owed to admins', 'Spend per month', 'Spend by category', 'Spend by project', 'Reimbursements owed per admin']) expect(t).toContain(label);
    expect(t).toContain('₹1,934.00'); // spent: 1,234.00 + 700.00: the approved one counts, the submitted and rejected ones do not
    expect(t).not.toContain('₹11,933.00');
    for (const d of ['Design tool seats', 'Taxi to the client office', 'Team lunch', 'Personal flight']) expect(t).toContain(d);
    expect(t).toContain('Approved and paid, everything that matches');
    expect(html).toContain('pd-margin-flag'); // the submitted one waits for this superadmin
    expect(html).toContain('placeholder="Any project"');
    expect(html).toContain('placeholder="Anyone who paid"');
    expect(html).toContain('href="/admin/expenses/new"');
    expect(t).toContain('New expense');
  });

  it('narrows by the URL: status, person, project and text', async () => {
    const w = await makeExpenseWorld();
    await insertExpense({ status: 'paid', description: 'Domain renewal', spentOn: recent(), project: w.project });
    await insertExpense({ status: 'submitted', paidBy: w.plain, description: 'Taxi fare', spentOn: recent() });
    guard.viewer = w.superSession;
    expect(text(await list({ status: 'submitted' }))).not.toContain('Domain renewal');
    expect(text(await list({ status: 'submitted' }))).toContain('Taxi fare');
    expect(text(await list({ person: String(w.plain._id) }))).not.toContain('Domain renewal');
    const byProject = text(await list({ projectId: String(w.project._id) }));
    expect(byProject).toContain('Domain renewal');
    expect(byProject).not.toContain('Taxi fare');
    expect(text(await list({ q: 'zzz-nothing' }))).toContain('No expenses match');
  });

  it('shows the queues for every date even when the period is another year', async () => {
    const w = await makeExpenseWorld();
    await insertExpense({ status: 'submitted', paidBy: w.plain, description: 'Old taxi fare', spentOn: '2024-01-10' });
    guard.viewer = w.superSession;
    expect(text(await list())).not.toContain('Old taxi fare');
    expect(text(await list({ status: 'submitted' }))).toContain('Old taxi fare');
  });

  it('shows a plain admin only a "my expenses" summary and their own expenses', async () => {
    const w = await makeExpenseWorld();
    await insertExpense({ status: 'approved', paidBy: w.plain, amountMinor: 50_000, description: 'My taxi', spentOn: recent() });
    await insertExpense({ status: 'submitted', paidBy: w.other, amountMinor: 777_000, description: 'Their lunch', spentOn: recent() });
    await insertExpense({ status: 'paid', amountMinor: 888_000, description: 'Company hosting', spentOn: recent() });
    guard.viewer = w.plainSession;
    const html = await list();
    const t = text(html);
    expect(t).toContain('What you have paid out of pocket and asked to be paid back');
    expect(t).toContain('My expenses');
    expect(t).toContain('Waiting to be paid back');
    expect(t).toContain('₹500.00');
    expect(t).toContain('My taxi');
    for (const secret of ['Their lunch', 'Company hosting', '7,770.00', '8,880.00', 'Spend per month', 'Owed to admins']) expect(t).not.toContain(secret);
    expect(html).not.toContain('Anyone who paid');
    expect(t).toContain('Submit an expense');
    expect(html).not.toMatch(/<tr[^>]*pd-margin-flag/); // only an approver's own queue is flagged in the table
  });

  it('shows the empty state with the next step on an empty database', async () => {
    const w = await makeExpenseWorld();
    guard.viewer = w.superSession;
    const t = text(await list());
    expect(t).toContain('No expenses in this period');
    expect(t).toContain('Record the first expense');
    expect(t).toContain('Nothing was spent in this period.');
    expect(t).toContain('Nobody is waiting to be paid back.');
    guard.viewer = w.plainSession;
    expect(text(await list())).toContain('Submit an expense you paid for');
  });
});

describe('the new expense page', () => {
  const open = () => render(NewExpensePage as never, { searchParams: Promise.resolve({}) });

  it('adapts to a plain admin: they can only submit, and the company choice is off', async () => {
    const w = await makeExpenseWorld();
    guard.viewer = w.plainSession;
    const html = await open();
    const t = text(html);
    expect(t).toContain('Submit an expense');
    expect(t).toContain('I paid out of pocket');
    expect(html).toMatch(/<input[^>]*type="radio"[^>]*checked=""[^>]*\/?>/);
    expect(html).toMatch(/type="radio"[^>]*disabled=""/); // "The company paid" is not for them
    expect(t).toContain('Submit for reimbursement');
    expect(t).not.toContain('How it was paid');
    for (const label of ['Charged to', 'Category', 'What was it for?', 'Amount', 'Date spent', 'Receipts']) expect(t).toContain(label);
  });

  it('adapts to a recorder: company paid is the default, and it asks how it was paid', async () => {
    const w = await makeExpenseWorld();
    guard.viewer = w.recorderSession;
    const t = text(await open());
    expect(t).toContain('New expense');
    expect(t).toContain('Record or submit'.slice(0, 0) + 'Record something the company paid, or submit what you paid yourself');
    expect(t).toContain('How it was paid');
    expect(t).toContain('Record expense');
    expect(t).toContain('Bank transfer');
  });

  it('offers the categories and currencies from Settings and no invented ones', async () => {
    const w = await makeExpenseWorld();
    guard.viewer = w.recorderSession;
    const html = await open();
    expect(html).toContain('<option value="software_subscriptions">Software subscriptions</option>');
    expect(html).toContain('<option value="USD">USD</option>');
    expect(html).not.toContain('yachts');
  });
});

describe('the expense page', () => {
  async function submitted() {
    const w = await makeExpenseWorld();
    const e = await createExpense(w.plainSession, outOfPocket({ spentOn: recent(), description: 'Taxi to the client office' }), {});
    return { w, e };
  }

  it('gives the approver approve, reject, edit and void, and shows the trail and the activity', async () => {
    const { w, e } = await submitted();
    guard.viewer = w.superSession;
    const html = await detail(e.id);
    const t = text(html);
    for (const label of ['Approve', 'Reject', 'Edit', 'Void', 'Approval trail', 'Activity', 'Awaiting approval', 'Taxi to the client office', e.ref]) expect(t).toContain(label);
    expect(t).not.toContain('Mark as paid');
    expect(t).toContain(`Paid out of pocket by ${w.plain.name}`);
    expect(t).toContain('submitted for reimbursement'.slice(0, 0) + 'Submitted by');
    expect(t).toContain('Submitted for reimbursement');
    expect(html).toContain(`href="/admin/expenses/${e.id}/edit"`);
  });

  it('gives the submitter edit and withdraw, and no approval', async () => {
    const { w, e } = await submitted();
    guard.viewer = w.plainSession;
    const t = text(await detail(e.id));
    expect(t).toContain('Edit');
    expect(t).toContain('Withdraw');
    for (const no of ['Approve', 'Reject', 'Mark as paid', 'Void']) expect(t).not.toContain(no);
  });

  it('says what we owe once it is approved, and offers mark as paid', async () => {
    const { w, e } = await submitted();
    await approveExpense(w.superSession, e.id);
    guard.viewer = w.superSession;
    const t = text(await detail(e.id));
    expect(t).toContain(`${w.plain.name} is owed ₹450.00`);
    expect(t).toContain('Approved, to be paid');
    expect(t).toContain('Mark as paid');
    guard.viewer = w.plainSession;
    const own = text(await detail(e.id));
    expect(own).toContain('There is nothing you can do to this expense.');
  });

  it('shows the reason on a rejected or voided expense, and says it is in no total', async () => {
    const w = await makeExpenseWorld();
    const rejected = await insertExpense({ status: 'rejected', paidBy: w.plain, spentOn: recent() });
    guard.viewer = w.plainSession;
    const t = text(await detail(String(rejected._id)));
    expect(t).toContain('Rejected: Not a business cost');
    expect(t).toContain('not counted in any total');
  });

  it('shows a foreign amount with its rate and its INR value, and the receipts the viewer may open', async () => {
    const w = await makeExpenseWorld();
    const e = await createExpense(w.recorderSession, companyPaid({ currency: 'USD', amountMinor: 100_000, spentOn: '2026-10-05', paidOn: '2026-10-06' }), {}, new Date('2026-10-12T10:00:00Z'));
    guard.viewer = w.recorderSession;
    const t = text(await detail(e.id));
    expect(t).toContain('1 USD = INR 83.42 (table rate, 1 Oct 2026)');
    expect(t).toContain('$1,000.00');
    expect(t).toContain('₹83,420.00');
    expect(t).toContain('No receipt is attached.');
    expect(t).toContain('Payment');
  });

  it('is a 404 for someone else\'s expense, a malformed id and a missing one', async () => {
    const { w, e } = await submitted();
    guard.viewer = await sessionFor(await makeAdmin());
    await expect(detail(e.id)).rejects.toThrow('NOT_FOUND');
    guard.viewer = w.superSession;
    await expect(detail('not-an-id')).rejects.toThrow('NOT_FOUND');
    await expect(detail('5f3a5f3a5f3a5f3a5f3a5f3a')).rejects.toThrow('NOT_FOUND');
    await expect(edit('not-an-id')).rejects.toThrow('NOT_FOUND');
  });
});

describe('the edit page', () => {
  it('opens the form with what is stored, and sends the submitter back to the expense once it is approved', async () => {
    const w = await makeExpenseWorld();
    const e = await createExpense(w.plainSession, outOfPocket({ spentOn: recent(), description: 'Taxi to the client office', payee: 'City Cabs' }), {});
    guard.viewer = w.plainSession;
    const html = await edit(e.id);
    expect(html).toContain('value="Taxi to the client office"');
    expect(html).toContain('value="City Cabs"');
    expect(html).toContain('value="450.00"');
    expect(text(html)).toContain('Save changes');
    expect(text(html)).toContain(`Paid out of pocket by ${w.plain.name}.`);
    expect(text(html)).not.toContain('Who paid?');

    await approveExpense(w.superSession, e.id);
    await expect(edit(e.id)).rejects.toThrow(`REDIRECT /admin/expenses/${e.id}`);
    guard.viewer = w.recorderSession;
    expect(text(await edit(e.id))).toContain('Save changes'); // a recorder may still edit it
  });

  it('shows the payment fields of a paid expense only to whoever may correct them', async () => {
    const w = await makeExpenseWorld();
    const companyPaidRow = await insertExpense({ status: 'paid', spentOn: recent(4) });
    const reimbursed = await insertExpense({ status: 'paid', paidBy: w.plain, spentOn: recent(4) });
    guard.viewer = w.recorderSession;
    expect(text(await edit(String(companyPaidRow._id)))).toContain('Date paid'); // a recorder corrects what the company paid
    expect(text(await edit(String(reimbursed._id)))).not.toContain('Date paid'); // but not a reimbursement
    guard.viewer = w.superSession;
    expect(text(await edit(String(reimbursed._id)))).toContain('Date paid');
  });
});
