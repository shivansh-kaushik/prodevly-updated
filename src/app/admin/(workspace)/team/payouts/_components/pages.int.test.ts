import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Capability } from '@/config/capabilities';
import { markTeamPayoutPaid, voidTeamPayout } from '@/services/team-payout.service';
import type { SessionUser } from '@/types/session';
import { holding, logTime, makeAdmin, makePayoutWorld, NOW, recordPayout, sessionFor, setupTestDb, usdRate, type PayoutWorld } from '@/test/team-payout-factories';
import PersonPage from '../../[adminId]/page';
import PayoutPage from '../[payoutId]/page';
import EditPayoutPage from '../[payoutId]/edit/page';
import TeamPayoutsPage from '../page';
import NewPayoutPage from '../new/page';

setupTestDb();

/**
 * The pages, run for real against the test database with the session and the router stubbed. `requireAdminPage` is replaced
 * by a copy of its rule (a missing capability is a 404; a missing session never happens here), and `notFound()` / `redirect()`
 * throw a marker, so a test can say "this viewer gets a 404".
 */
let viewer: SessionUser | null = null;

vi.mock('@/lib/auth/page-guard', () => ({
  requireAdminPage: async (_returnTo?: string, options: { capability?: Capability } = {}) => {
    if (!viewer) throw new Error('no viewer set');
    if (options.capability && !viewer.capabilities.has(options.capability)) throw new Error('NEXT_NOT_FOUND');
    return viewer;
  },
  getCurrentAdmin: async () => ({ admin: viewer, hadCookie: true }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/team/payouts',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/admin/api-provider', () => ({ useAdminApi: () => ({ call: vi.fn() }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ show: vi.fn() }) }));

const as = (v: SessionUser) => {
  viewer = v;
};
const html = async (page: unknown): Promise<string> => renderToStaticMarkup(page as never);
const gets404 = async (run: () => Promise<unknown>) => expect(run()).rejects.toThrow('NEXT_NOT_FOUND');
const PAID = { paidOn: '2026-05-10', mode: 'bank_transfer', transactionRef: 'UTR-001' };

const payoutPage = (id: string) => PayoutPage({ params: Promise.resolve({ payoutId: id }) });
const personPage = (id: string, sp: Record<string, string> = {}) => PersonPage({ params: Promise.resolve({ adminId: id }), searchParams: Promise.resolve(sp) });

/** One person, with a paid USD payout split across two projects, a due INR payout and a void one. */
async function seed(): Promise<{ w: PayoutWorld; paid: Awaited<ReturnType<typeof recordPayout>>; due: Awaited<ReturnType<typeof recordPayout>> }> {
  const w = await makePayoutWorld();
  await usdRate(80, '2026-05-04');
  await usdRate(84, '2026-05-09');
  await logTime(w, 0, '2026-04-10', 120);
  const ids = w.projects.map((p) => String(p._id));
  const paid = await recordPayout(w, { currency: 'USD', amountMinor: 100_000, note: 'INTERNAL-NOTE', allocations: [{ projectId: ids[0]!, amountMinor: 60_000 }, { projectId: ids[1]!, amountMinor: 40_000 }] });
  await markTeamPayoutPaid(w.sa, paid.id, PAID, {}, NOW);
  const due = await recordPayout(w, { periodFrom: '2026-09-01', periodTo: '2026-09-30', dueOn: '2026-09-05', amountMinor: 4_500_000 });
  const gone = await recordPayout(w, { periodFrom: '2026-07-01', periodTo: '2026-07-31', dueOn: '2026-07-05', amountMinor: 1_000_000 });
  await voidTeamPayout(w.sa, gone.id, { reason: 'Entered twice' }, {}, NOW);
  return { w, paid, due };
}

describe('the payouts list page', () => {
  it('shows the totals band, the rows and the filters to a superadmin', async () => {
    const { w, paid, due } = await seed();
    as(w.sa);
    const fy = await html(await TeamPayoutsPage({ searchParams: Promise.resolve({}) }));
    expect(fy).toContain('Team payouts');
    expect(fy).toContain('Paid, This financial year');
    expect(fy).toContain('₹84,000.00'); // USD 1,000 at the paid-date rate of 84
    expect(fy).toContain('$1,000.00'); // the native amount, as the second line
    expect(fy).toContain('Due in this period');
    expect(fy).toContain('₹45,000.00'); // the due INR payout
    expect(fy).toContain('Owed now');
    expect(fy).toContain(paid.ref);
    expect(fy).toContain(due.ref);
    expect(fy).toContain('Asha Rao');
    expect(fy).toContain('Record a payout');
    expect(fy).toContain('Overdue'); // due on 5 Sep, today is later
    expect(fy).toMatch(/Paid 10 May 2026/);
    expect(fy).not.toMatch(/NaN|Infinity|undefined/);
    expect(fy).not.toContain('Entered twice'); // the void reason is not on a list
    expect(fy).toContain('Void'); // the void payout is listed, tagged
  });

  it('filters by status and person, and says so when nothing matches', async () => {
    const { w, due } = await seed();
    as(w.sa);
    const dueOnly = await html(await TeamPayoutsPage({ searchParams: Promise.resolve({ status: 'due' }) }));
    expect(dueOnly).toContain(due.ref);
    expect(dueOnly).not.toContain('Paid 10 May 2026');
    const other = await makePayoutWorld();
    const none = await html(await TeamPayoutsPage({ searchParams: Promise.resolve({ adminId: String(other.person._id) }) }));
    expect(none).toContain('No payouts match');
    expect(none).toContain('Clear filters');
    expect(none).toContain('value="Asha Rao"'); // the person filter shows who is chosen
  });

  it('is empty-safe: zeros and an invitation, no NaN', async () => {
    const w = await makePayoutWorld();
    as(w.sa);
    const out = await html(await TeamPayoutsPage({ searchParams: Promise.resolve({}) }));
    expect(out).toContain('No payouts in this period');
    expect(out).toContain('Nothing paid in this period');
    expect(out).toContain('Nothing waiting');
    expect(out).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('is a 404 for anyone without team:payView', async () => {
    const w = await makePayoutWorld();
    await gets404(async () => {
      as(w.personSession);
      return TeamPayoutsPage({ searchParams: Promise.resolve({}) });
    });
    await gets404(async () => {
      as(await sessionFor(await makeAdmin()));
      return TeamPayoutsPage({ searchParams: Promise.resolve({}) });
    });
  });
});

describe('the payout page', () => {
  it('gives a superadmin the facts, the split with its totals, the proposal, the lock and the actions for a due payout', async () => {
    const { w, due } = await seed();
    as(w.sa);
    const out = await html(await payoutPage(due.id));
    expect(out).toContain(due.ref);
    expect(out).toMatch(/Edit<\/a>/);
    expect(out).toMatch(/Mark paid<\/button>/);
    expect(out).toMatch(/Void<\/button>/);
    expect(out).toContain('Marking this paid will lock');
    expect(out).toContain('Not charged to any project'); // no split recorded on this one
    expect(out).toContain('What was proposed'); // monthly salary proposal stored with it
    expect(out).toContain('Overdue');
    expect(out).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('shows a paid foreign payout with its rate, its allocations in both currencies and no actions but void', async () => {
    const { w, paid } = await seed();
    as(w.sa);
    const out = await html(await payoutPage(paid.id));
    expect(out).toContain('$1,000.00');
    expect(out).toContain('USD 1,000.00 = INR 84,000.00 at 84 (table rate, 9 May 2026)');
    expect(out).toContain('Share in INR');
    expect(out).toContain(w.projects[0]!.name);
    expect(out).toContain('Company overhead');
    expect(out).toContain('INTERNAL-NOTE');
    expect(out).toContain('UTR-001');
    expect(out).toContain('1 of Asha Rao&#x27;s time entry dated');
    expect(out).toContain('is locked by this payout');
    expect(out).not.toMatch(/Mark paid<\/button>/);
    expect(out).not.toMatch(/Edit<\/a>/);
    expect(out).toMatch(/Void<\/button>/);
  });

  it('gives the person the plain version of their own payout: no split, no note, no actions, no activity', async () => {
    const { w, paid } = await seed();
    as(w.personSession);
    const out = await html(await payoutPage(paid.id));
    expect(out).toContain(paid.ref);
    expect(out).toContain('UTR-001');
    expect(out).toContain('$1,000.00');
    for (const secret of ['INTERNAL-NOTE', 'Charged to projects', 'Activity', 'What was proposed', 'Void', 'Mark paid', w.projects[0]!.name, w.superadmin.name]) {
      expect(out, secret).not.toContain(secret);
    }
    expect(out).toContain('You');
  });

  it('is a 404 for a colleague, for a malformed id and for an unknown one', async () => {
    const { w, paid } = await seed();
    await gets404(async () => {
      as(await sessionFor(await makeAdmin()));
      return payoutPage(paid.id);
    });
    as(w.sa);
    await gets404(() => payoutPage('nope'));
    await gets404(() => payoutPage('5f3a9c0b1d2e4f6a8b7c9d0e'));
  });

  it('a void payout offers nothing to do and says it locks no time', async () => {
    const { w } = await seed();
    as(w.sa);
    const { items } = await (await import('@/services/team-payout.service')).searchTeamPayouts(w.sa, { status: 'void' });
    const out = await html(await payoutPage(items[0]!.id));
    expect(out).toContain('This payout is void, so it locks no time.');
    expect(out).toContain('Entered twice');
    expect(out).not.toMatch(/Void<\/button>/);
    expect(out).not.toMatch(/Mark paid<\/button>/);
  });
});

describe('recording and editing', () => {
  it('opens the form for a superadmin with the person from the link, and is a 404 for everyone else', async () => {
    const w = await makePayoutWorld();
    as(w.sa);
    const out = await html(await NewPayoutPage({ searchParams: Promise.resolve({ adminId: String(w.person._id) }) }));
    expect(out).toContain('Record a payout');
    expect(out).toContain('value="Asha Rao"');
    expect(out).toContain('Record payout');
    expect(out).toContain('Charge to projects');
    expect(out).toContain('What the pay profile proposes'); // the proposal panel, loading in the browser
    await gets404(async () => {
      as(w.personSession);
      return NewPayoutPage({ searchParams: Promise.resolve({}) });
    });
  });

  it('defaults to last month for the period and to today for the due date', async () => {
    const w = await makePayoutWorld();
    as(w.sa);
    const out = await html(await NewPayoutPage({ searchParams: Promise.resolve({}) }));
    const now = new Date();
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
    expect(out).toContain(`value="${first}"`);
  });

  it('edits a due payout from its stored values, and sends a paid one back to its page', async () => {
    const { w, due, paid } = await seed();
    as(w.sa);
    const out = await html(await EditPayoutPage({ params: Promise.resolve({ payoutId: due.id }) }));
    expect(out).toContain(`Edit ${due.ref}`);
    expect(out).toContain('value="45000.00"');
    expect(out).toContain('Save changes');
    expect(out).toContain('value="2026-09-05"');
    await expect(EditPayoutPage({ params: Promise.resolve({ payoutId: paid.id }) })).rejects.toThrow(`NEXT_REDIRECT:/admin/team/payouts/${paid.id}`);
    await gets404(async () => {
      as(w.personSession);
      return EditPayoutPage({ params: Promise.resolve({ payoutId: due.id }) });
    });
  });
});

describe('the person page', () => {
  it('shows a person their own numbers, and a Pay tab with how they are paid and their payouts, and no pay editor', async () => {
    const { w, due } = await seed();
    as(w.personSession);
    const overview = await html(await personPage(String(w.person._id)));
    expect(overview).toContain('Asha Rao');
    expect(overview).toContain('My numbers');
    expect(overview).toContain('Hours this week');
    expect(overview).toContain('>Pay<');
    expect(overview).not.toContain('Record a payout');

    const pay = await html(await personPage(String(w.person._id), { tab: 'pay' }));
    expect(pay).toContain('How I am paid');
    expect(pay).toContain('₹50,000.00 per month');
    expect(pay).toContain('My payouts');
    expect(pay).toContain(due.ref);
    expect(pay).not.toContain('Save pay profile'); // never your own
    expect(pay).not.toContain('Record a payout');
    expect(pay).not.toContain('All payouts for');
    expect(pay).not.toContain('Earlier terms');
  });

  it('shows a superadmin anyone\'s page, with the pay editor, the history and the way to record a payout', async () => {
    const { w } = await seed();
    as(w.sa);
    const overview = await html(await personPage(String(w.person._id)));
    expect(overview).toContain('Asha Rao&#x27;s numbers');
    expect(overview).toContain('Record a payout');
    const pay = await html(await personPage(String(w.person._id), { tab: 'pay' }));
    expect(pay).toContain('Save pay profile');
    expect(pay).toContain('Payouts');
    expect(pay).toContain('All payouts for Asha Rao');
    expect(pay).toContain('Record a payout');
    // a superadmin's own page: no pay editor for yourself
    const own = await html(await personPage(String(w.superadmin._id), { tab: 'pay' }));
    expect(own).not.toContain('Save pay profile');
    expect(own).toContain('No payouts yet');
  });

  it('is a 404 for a colleague, for someone who may not read other people\'s activity, and for an unknown or malformed person', async () => {
    const { w } = await seed();
    await gets404(async () => {
      as(await sessionFor(await makeAdmin()));
      return personPage(String(w.person._id));
    });
    await gets404(async () => {
      as(holding(w.sa, 'team:view', 'team:payView', 'teamPayout:record')); // pay access without audit:viewAll is not enough to open someone
      return personPage(String(w.person._id));
    });
    as(w.sa);
    await gets404(() => personPage('nope'));
    await gets404(() => personPage('5f3a9c0b1d2e4f6a8b7c9d0e'));
  });

  it('hides the Pay tab, and falls back to the overview, from someone who opens a page without pay access', async () => {
    const { w } = await seed();
    as(holding(w.sa, 'team:view', 'audit:viewAll'));
    const out = await html(await personPage(String(w.person._id), { tab: 'pay' }));
    expect(out).not.toContain('>Pay<');
    expect(out).not.toContain('How they are paid');
    expect(out).toContain('Hours this week');
  });

  it('needs team:view', async () => {
    const { w } = await seed();
    await gets404(async () => {
      as(holding(w.sa, 'audit:viewAll'));
      return personPage(String(w.person._id));
    });
  });

  it('createElement is available to the renderer (sanity)', () => {
    expect(renderToStaticMarkup(createElement('p', null, 'ok'))).toBe('<p>ok</p>');
  });
});
