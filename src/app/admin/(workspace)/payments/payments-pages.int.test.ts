import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminProviders } from '@/components/admin/api-provider';
import { ClientPayment } from '@/models';
import { getPayment, recordPayment, voidPayment } from '@/services/client-payment.service';
import { setupTestDb } from '@/test/db';
import { makeClient } from '@/test/domain-factories';
import type { SessionUser } from '@/types/session';
import { NOW, makeBillableProject, makeFxRate, makeLedgerPayment, makePaymentFile, paymentActors, paymentBody } from '@/test/payment-factories';

/**
 * The pages end to end against a real database: the guard, the URL, the services and the markup. Only the
 * framework edges are stubbed (the session, the router hooks and the browser's API calls).
 */
let signedIn: SessionUser;
let query = '';
const guardCalls: Array<{ returnTo?: string; options?: { capability?: string } }> = [];

vi.mock('@/lib/auth/page-guard', () => ({
  requireAdminPage: async (returnTo?: string, options?: { capability?: string }) => {
    guardCalls.push({ returnTo, options });
    return signedIn;
  },
  getCurrentAdmin: async () => ({ admin: signedIn, hadCookie: true }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  usePathname: () => '/admin/payments',
  useSearchParams: () => new URLSearchParams(query),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import { PaymentForm } from './_components/payment-form';
import PaymentsPage from './page';
import NewPaymentPage from './new/page';
import PaymentPage from './[paymentId]/page';

setupTestDb();

const html = (node: ReactElement) => renderToStaticMarkup(h(AdminProviders, null, node));
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

async function listPage(params: Record<string, string> = {}) {
  query = new URLSearchParams(params).toString();
  return html(await PaymentsPage({ searchParams: Promise.resolve(params) }));
}
async function newPage(params: Record<string, string> = {}) {
  query = new URLSearchParams(params).toString();
  return html(await NewPaymentPage({ searchParams: Promise.resolve(params) }));
}
async function detailPage(id: string) {
  return html(await PaymentPage({ params: Promise.resolve({ paymentId: id }) }));
}

beforeEach(() => {
  guardCalls.length = 0;
  query = '';
});

describe('the ledger page', () => {
  it('asks for payment:view, and shows zeros and an empty state on an empty database', async () => {
    const { sa } = await paymentActors();
    signedIn = sa;
    const markup = await listPage();
    expect(guardCalls).toEqual([{ returnTo: '/admin/payments', options: { capability: 'payment:view' } }]);
    const words = text(markup);
    expect(words).toContain('Client payments');
    expect(words).toContain('No payments yet');
    expect(words).toContain('Record the first payment');
    expect(words).toContain('Nothing outstanding');
    expect(words).toContain('No milestones due');
    expect(words).toMatch(/Received\s+₹0\.00/);
    expect(words).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('shows the figures, the table with its void row, and the outstanding and upcoming panels', async () => {
    const { sa, recorder } = await paymentActors();
    await makeFxRate('USD', 83.42, '2026-10-01');
    const { project } = await makeBillableProject({
      pricingModel: 'milestone',
      amountMinor: 500_000_000,
      milestones: [{ title: 'Design sign-off', amountMinor: 100_000_000, status: 'invoiced', dueOn: '2026-10-20' }],
    });
    const made = await recordPayment(recorder, paymentBody(project, { amountMinor: 100_000, currency: 'USD', transactionRef: 'WISE-123', mode: 'wise', tdsMinor: 10_000 }), {}, NOW);
    const gone = await recordPayment(recorder, paymentBody(project, { amountMinor: 9_000_000, receivedOn: '2026-10-02' }), {}, NOW);
    await voidPayment(sa, gone.id, { reason: 'Entered on the wrong project' });
    await recordPayment(recorder, paymentBody(project, { type: 'refund', amountMinor: 1_000_000, receivedOn: '2026-10-03' }), {}, NOW);

    signedIn = sa;
    const words = text(await listPage());
    expect(words).toContain(made.ref);
    expect(words).toContain(gone.ref);
    expect(words).toMatch(/Void/);
    expect(words).toContain('WISE-123');
    expect(words).toContain('Wise');
    // received: USD 1,000.00 at 83.42 = 83,420.00, less a refund of 10,000.00
    expect(words).toContain('₹73,420.00');
    expect(words).toContain('$1,000.00');
    expect(words).toContain('Outstanding by project');
    expect(words).toContain('Checkout redesign');
    expect(words).toContain('Upcoming milestones');
    expect(words).toContain('Design sign-off');
    expect(words).toContain('Record payment');
    expect(words).toContain('1 void entry is listed but not counted');
    expect(words).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('hides "Record payment" from someone who may only view, and narrows by a filter in the URL', async () => {
    const { viewer, recorder } = await paymentActors();
    const { project, client } = await makeBillableProject();
    const other = await makeBillableProject({ client: await makeClient({ name: 'Other Co' }) });
    await recordPayment(recorder, paymentBody(project, { note: 'mine' }), {}, NOW);
    await recordPayment(recorder, paymentBody(other.project), {}, NOW);
    signedIn = viewer;
    const all = text(await listPage());
    expect(all).not.toContain('Record payment');
    expect(all).toContain(`Showing 1-2 of 2 payments`);
    const narrowed = text(await listPage({ client: String(client._id) }));
    expect(narrowed).toContain('Showing 1-1 of 1 payments');
    expect(narrowed).toContain('Show every client and project');
    const none = text(await listPage({ status: 'void' }));
    expect(none).toContain('No payments match');
    expect(none).toContain('Clear filters');
  });

  it('shows an old period with nothing in it as "no payments in this period", not as an empty ledger', async () => {
    const { sa } = await paymentActors();
    const { project } = await makeBillableProject();
    await makeLedgerPayment(project, { amountMinor: 1_000_000, receivedOn: '2025-01-01' });
    signedIn = sa;
    expect(text(await listPage())).toContain('No payments in this period');
  });

  it('ignores a filter it does not understand instead of failing', async () => {
    const { sa } = await paymentActors();
    signedIn = sa;
    const words = text(await listPage({ status: 'bogus', client: 'nope', currency: 'dollars', sort: 'inr', page: '-4' }));
    expect(words).toContain('Client payments');
  });
});

describe('the record page', () => {
  it('asks for payment:record and renders the form with Settings options and the date capped at today', async () => {
    const { recorder } = await paymentActors();
    signedIn = recorder;
    const markup = await newPage();
    expect(guardCalls).toEqual([{ returnTo: '/admin/payments/new', options: { capability: 'payment:record' } }]);
    const words = text(markup);
    expect(words).toContain('Record payment');
    expect(words).toContain('Bank transfer');
    expect(words).toContain('Wise');
    expect(words).toContain('Transaction reference');
    expect(words).toContain('TDS deducted by the client');
    expect(words).toContain('Attachments');
    expect(words).not.toContain('Record as advance'); // not a superadmin
    expect(markup).toMatch(/type="date"[^>]*max="\d{4}-\d{2}-\d{2}"/);
  });

  it('offers the advance tick to a superadmin, and starts from the project in the link', async () => {
    const { sa } = await paymentActors();
    const { project } = await makeBillableProject({ currency: 'USD', amountMinor: 1_000_000 });
    signedIn = sa;
    const markup = await newPage({ projectId: String(project._id) });
    const words = text(markup);
    expect(words).toContain('Record as advance');
    expect(markup).toContain('value="Checkout redesign"');
    expect(words).toContain('Billable $10,000.00');
    expect(words).toContain('$10,000.00 outstanding');
  });

  it('opens for a project that does not exist without failing', async () => {
    const { sa } = await paymentActors();
    signedIn = sa;
    expect(text(await newPage({ projectId: '5f3a1b2c3d4e5f6a7b8c9d0e' }))).toContain('Record payment');
  });
});

describe('the payment page', () => {
  async function entry() {
    const actors = await paymentActors();
    await makeFxRate('USD', 83.42, '2026-10-01');
    const { project } = await makeBillableProject({ client: await makeClient({ name: 'Acme Robotics' }) });
    const file = await makePaymentFile({ id: actors.recorder.id, name: actors.recorder.name });
    const made = await recordPayment(
      actors.recorder,
      paymentBody(project, { amountMinor: 100_000, currency: 'USD', transactionRef: 'UTR-77', invoiceRef: 'INV-9', note: 'Second instalment', tdsMinor: 5_000, attachmentMediaIds: [String(file._id)] }),
      {},
      NOW,
    );
    return { ...actors, made, project };
  }

  it('asks for payment:view and shows the amount, the rate it was captured at, the details and the files', async () => {
    const w = await entry();
    signedIn = w.sa;
    const words = text(await detailPage(w.made.id));
    expect(guardCalls).toEqual([{ returnTo: '/admin/payments', options: { capability: 'payment:view' } }]);
    expect(words).toContain(w.made.ref);
    expect(words).toContain('Received from');
    expect(words).toContain('Acme Robotics');
    expect(words).toContain('USD 1,000.00 = INR 83,420.00 at 83.42 (table, 1 Oct 2026)');
    expect(words).toContain('₹83,420.00 in INR');
    expect(words).toContain('UTR-77');
    expect(words).toContain('INV-9');
    expect(words).toContain('Second instalment');
    expect(words).toContain('$50.00'); // TDS in the entry currency
    expect(words).toContain('remittance.pdf');
    expect(words).toContain('Counts as ₹83,420.00 toward the INR contract'); // another currency than the contract says so
    expect(words).toContain('Rita Recorder created payment'); // the activity feed
  });

  it('offers Edit to a recorder and Edit and Void to a superadmin, and neither to a viewer', async () => {
    const w = await entry();
    signedIn = w.sa;
    const sa = text(await detailPage(w.made.id));
    expect(sa).toContain('Void payment');
    expect(sa).toContain(`Edit ${w.made.ref}`);
    signedIn = w.recorder;
    const recorder = text(await detailPage(w.made.id));
    expect(recorder).toContain(`Edit ${w.made.ref}`);
    expect(recorder).not.toContain('Void payment');
    signedIn = w.viewer;
    const viewer = text(await detailPage(w.made.id));
    expect(viewer).not.toContain(`Edit ${w.made.ref}`);
    expect(viewer).not.toContain('Void payment');
    expect(viewer).toContain('remittance.pdf'); // a viewer may open the files
  });

  it('shows a void entry with its reason, and no way to change it again', async () => {
    const w = await entry();
    await voidPayment(w.sa, w.made.id, { reason: 'Cheque bounced' });
    signedIn = w.sa;
    const words = text(await detailPage(w.made.id));
    expect(words).toContain('This payment is void');
    expect(words).toContain('Cheque bounced');
    expect(words).toContain('Sara Super');
    expect(words).not.toContain('Void payment');
    expect(words).not.toContain(`Edit ${w.made.ref}`);
  });

  it('shows a refund as a negative amount', async () => {
    const { recorder, sa } = await paymentActors();
    const { project } = await makeBillableProject();
    await recordPayment(recorder, paymentBody(project, { amountMinor: 5_000_000 }), {}, NOW);
    const refund = await recordPayment(recorder, paymentBody(project, { type: 'refund', amountMinor: 1_000_000 }), {}, NOW);
    signedIn = sa;
    const words = text(await detailPage(refund.id));
    expect(words).toContain('Amount refunded');
    expect(words).toContain('-₹10,000.00');
  });

  it('answers not found for an id that is malformed or unknown', async () => {
    const { sa } = await paymentActors();
    signedIn = sa;
    await expect(detailPage('not-an-id')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(detailPage('5f3a1b2c3d4e5f6a7b8c9d0e')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(await ClientPayment.countDocuments({})).toBe(0);
  });

  it('is built from the record, never from a draft: every figure comes from the stored entry', async () => {
    const w = await entry();
    const stored = await ClientPayment.findById(w.made.id).lean();
    signedIn = w.viewer;
    const words = text(await detailPage(w.made.id));
    expect(words).toContain(`${(stored!.amount.inrMinor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  });
});


describe('the edit form', () => {
  const settings = { currencies: ['INR', 'USD', 'EUR'], modes: ['bank_transfer', 'wise'], today: '2026-10-12' };

  it('starts from the stored entry: amount, currency, date, references, files and the rate it was made at', async () => {
    const { recorder } = await paymentActors();
    await makeFxRate('USD', 83.42, '2026-10-01');
    const { project } = await makeBillableProject();
    const file = await makePaymentFile({ id: recorder.id, name: recorder.name });
    const made = await recordPayment(
      recorder,
      paymentBody(project, { amountMinor: 100_000, currency: 'USD', manualRate: 84.1, mode: 'wise', transactionRef: 'UTR-5', tdsMinor: 2_500, attachmentMediaIds: [String(file._id)] }),
      {},
      NOW,
    );
    const stored = await getPayment(recorder, made.id);
    const markup = html(h(PaymentForm, { settings, canAdvance: false, lookups: { clients: true, projects: true, tasks: true }, initial: stored, attachments: [{ id: String(file._id), filename: 'remittance.pdf', url: `/media/${String(file._id)}/remittance.pdf`, mime: 'application/pdf', size: 1234, width: null, height: null, alt: null, visibility: 'private', purpose: 'payment', uploadedBy: 'Rita', createdAt: '2026-10-01T00:00:00.000Z' }] }));
    const words = text(markup);
    expect(words).toContain('Save changes');
    expect(words).toContain('Checkout redesign'); // the project is shown, not picked: it cannot move from here
    expect(words).toContain('void it and record it again');
    expect(words).toContain('remittance.pdf');
    expect(words).not.toContain('Record as advance');
    expect(markup).toContain('value="1000.00"');
    expect(markup).toContain('value="UTR-5"');
    expect(markup).toContain('value="84.1"'); // the exact rate typed by hand is what the field shows
    expect(markup).toContain('value="25.00"'); // TDS, in the entry currency
    expect(markup).toContain('value="2026-10-01"');
    expect(markup).toMatch(/<option value="wise" selected/);
  });

  it('keeps a mode that Settings no longer lists, so the entry can still be saved', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    const made = await recordPayment(recorder, paymentBody(project), {}, NOW);
    await ClientPayment.updateOne({ _id: made.id }, { $set: { mode: 'barter' } });
    const stored = await getPayment(recorder, made.id);
    expect(html(h(PaymentForm, { settings, canAdvance: false, lookups: { clients: true, projects: true, tasks: false }, initial: stored }))).toMatch(/<option value="barter" selected/);
  });

  it('is usable without lookups: a person who cannot look projects up is told so, not shown a broken picker', async () => {
    const { recorder } = await paymentActors();
    signedIn = recorder;
    const words = text(html(h(PaymentForm, { settings, canAdvance: false, lookups: { clients: false, projects: false, tasks: false } })));
    expect(words).toContain('You need access to projects to pick one.');
    expect(words).not.toContain('Search tasks');
  });
});
