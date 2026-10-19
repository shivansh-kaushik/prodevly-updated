import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AdminProviders } from '@/components/admin/api-provider';
import { getThirdPartiesDashboard } from '@/services/dashboards/third-parties';
import { getThirdParty, searchThirdParties } from '@/services/third-party.service';
import { getPayout, searchPayouts } from '@/services/third-party-payout.service';
import { getWorkOrder, searchWorkOrders } from '@/services/work-order.service';
import { setupTestDb } from '@/test/db';
import { makeClient, makeProject } from '@/test/domain-factories';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { D, makeOrder, makeParty, makePayout, setRate } from '@/test/third-party-factories';
import { PayoutCharts, TypePanel } from './dashboard-charts';
import { ThirdPartiesStatBand } from './dashboard-stats';
import { captureText, payoutFormInitial, thirdPartyFormInitial, workOrderFormInitial } from './form-initials';
import { MarkPaidDialog } from './mark-paid-dialog';
import { OpenWorkOrdersTable } from './open-work-orders-table';
import { PaymentNotePanel } from './payment-note-panel';
import { PayoutActions } from './payout-actions';
import { PayoutTable } from './payout-table';
import { SectionNav } from './section-nav';
import { ThirdPartyActions } from './third-party-actions';
import { ThirdPartyForm } from './third-party-form';
import { ThirdPartyTable } from './third-party-table';
import { WorkOrderActions } from './work-order-actions';
import { WorkOrderTable } from './work-order-table';

// The pages run inside Next's router; here the hooks are stubs, so client components can be rendered to markup.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => '/admin/third-parties',
  useSearchParams: () => new URLSearchParams(),
}));

setupTestDb();

const FY27 = { from: D('2026-04-01'), to: D('2027-03-31') };
const NOW = new Date('2026-10-12T10:00:00Z');
// The provider also renders its step-up dialog and the toast region: they are not what these tests look at.
const html = (node: ReactElement) =>
  renderToStaticMarkup(h(AdminProviders, null, node))
    .replace(/<dialog[^>]*>(?:(?!<\/dialog>)[\s\S])*Confirm it is you[\s\S]*?<\/dialog>/, '')
    .replace(/<div role="status" aria-live="polite"[^>]*><\/div>/, '');
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const NOTE = 'HDFC 5010-0099-1234 IFSC HDFC0001234';

async function world() {
  const sa = await sessionFor(await makeSuperadmin());
  const recorder = await sessionFor(await makeAdmin({ grants: ['payout:view', 'payout:record', 'thirdParty:edit'] }));
  const plain = await sessionFor(await makeAdmin());
  const client = await makeClient({ name: 'Acme Robotics' });
  const project = await makeProject(client, { name: 'Checkout redesign' });
  const party = await makeParty({ name: 'Pixel Forge', type: 'agency', paymentNote: NOTE });
  await setRate('USD', 83.42, '2026-10-05');
  const order = await makeOrder(party, project, { title: 'Checkout build', agreedMinor: 500_000, currency: 'USD', paidMinor: 100_000, dueMinor: 100_000, dueOn: D('2026-10-10') });
  await makePayout(party, project, { order, status: 'paid', amountMinor: 100_000, currency: 'USD', paidOn: D('2026-10-05') });
  await makePayout(party, project, { order, status: 'due', amountMinor: 100_000, currency: 'USD', dueOn: D('2026-10-09') });
  await makePayout(party, project, { order, status: 'void', amountMinor: 50_000, currency: 'USD' });
  return { sa, recorder, plain, client, project, party, order };
}

describe('the payment note', () => {
  it('shows only on the panel a superadmin is given, and is nowhere in the directory, the forms or the other tables', async () => {
    const w = await world();
    const sa = await getThirdParty(w.sa, String(w.party._id));
    const recorder = await getThirdParty(w.recorder, String(w.party._id));
    expect(sa.payDetails).toEqual({ note: NOTE });
    expect(recorder.payDetails).toBeNull();

    expect(html(h(PaymentNotePanel, { id: sa.id, note: NOTE, canEdit: true }))).toContain('HDFC 5010-0099-1234');
    const editorForm = html(h(ThirdPartyForm, { initial: thirdPartyFormInitial(recorder), types: ['agency'], currencies: ['INR'], canPayDetails: false }));
    expect(editorForm).not.toContain('HDFC');
    expect(editorForm).not.toContain('Payment details');
    expect(thirdPartyFormInitial(recorder).paymentNote).toBe('');
    const superForm = html(h(ThirdPartyForm, { initial: thirdPartyFormInitial(sa), types: ['agency'], currencies: ['INR'], canPayDetails: true }));
    expect(superForm).toContain('Payment details');
    expect(superForm).toContain('Only superadmins see or change this');

    const list = await searchThirdParties(w.sa);
    const table = html(h(ThirdPartyTable, { items: list.items, params: {}, sort: 'name', dir: 'asc' }));
    expect(table).not.toContain('HDFC');
    const orders = await searchWorkOrders(w.sa);
    const payouts = await searchPayouts(w.sa);
    expect(html(h(WorkOrderTable, { items: orders.items, params: {} }))).not.toContain('HDFC');
    expect(html(h(PayoutTable, { items: payouts.items, params: {} }))).not.toContain('HDFC');
  });

  it('a payment note panel without a note says so and offers to add one only when editable', () => {
    expect(text(html(h(PaymentNotePanel, { id: 'x', note: null, canEdit: true })))).toContain('No payment details saved yet');
    expect(text(html(h(PaymentNotePanel, { id: 'x', note: null, canEdit: true })))).toMatch(/\bAdd\b/);
    expect(text(html(h(PaymentNotePanel, { id: 'x', note: null, canEdit: false })))).not.toMatch(/\bAdd\b/);
  });
});

describe('the dashboard band', () => {
  it('leaves the money tiles out for a viewer without payout:view and shows the type split instead', async () => {
    await world();
    const plain = await sessionFor(await makeAdmin());
    const dash = await getThirdPartiesDashboard(plain, FY27, { now: NOW });
    const band = text(html(h(ThirdPartiesStatBand, { dashboard: dash, periodLabel: 'This financial year' })));
    expect(band).toContain('Active third parties');
    for (const label of ['Paid', 'Due now', 'Open work orders', 'Open work-order balance']) expect(band).not.toContain(label);
    const panel = text(html(h(TypePanel, { dashboard: dash })));
    expect(panel).toContain('Third parties by type');
    expect(panel).toContain('Agency');
  });

  it('shows the five tiles from records for a viewer with payout:view, with the overdue part flagged', async () => {
    const w = await world();
    const dash = await getThirdPartiesDashboard(w.sa, FY27, { now: NOW });
    const band = text(html(h(ThirdPartiesStatBand, { dashboard: dash, periodLabel: 'This financial year' })));
    expect(band).toContain('Active third parties');
    expect(band).toContain('Paid');
    expect(band).toContain('₹83,420.00'); // USD 1,000.00 at 83.42
    expect(band).toContain('Due now');
    expect(band).toContain('1 overdue');
    expect(band).toContain('Open work orders');
    expect(band).toContain('Open work-order balance');
    expect(band).toContain('$1,000.00'); // the native line under Paid
  });

  it('renders the charts and the open-work-orders table, with a balance, an overrun and a missing rate', async () => {
    const w = await world();
    await makeOrder(w.party, w.project, { title: 'Overrun job', agreedMinor: 100_000, paidMinor: 80_000, dueMinor: 50_000 });
    await makeOrder(w.party, w.project, { title: 'Euro job', agreedMinor: 100_000, currency: 'EUR' });
    const dash = await getThirdPartiesDashboard(w.sa, FY27, { now: NOW });
    expect(dash.money).not.toBeNull();
    const charts = text(html(h(PayoutCharts, { money: dash.money!, periodLabel: 'This financial year' })));
    for (const title of ['Paid per month', 'Paid by third party', 'Paid by project', 'Paid by third-party type']) expect(charts).toContain(title);
    const table = text(html(h(OpenWorkOrdersTable, { open: dash.money!.openWorkOrders, canRecord: true })));
    expect(table).toContain('Checkout build');
    expect(table).toContain('$3,000.00'); // balance = agreed 5,000 - paid 1,000 - due 1,000
    expect(table).toContain('Over by');
    expect(table).toContain('Overdue');
    const band = text(html(h(ThirdPartiesStatBand, { dashboard: dash, periodLabel: 'x' })));
    expect(band).toContain('No exchange rate for EUR');
  });

  it('an empty database renders zeros and an empty-state invitation, never an error', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const dash = await getThirdPartiesDashboard(sa, FY27, { now: NOW });
    const band = text(html(h(ThirdPartiesStatBand, { dashboard: dash, periodLabel: 'This financial year' })));
    expect(band).toContain('₹0.00');
    expect(text(html(h(OpenWorkOrdersTable, { open: dash.money!.openWorkOrders, canRecord: true })))).toContain('No open work orders');
    expect(text(html(h(PayoutCharts, { money: dash.money!, periodLabel: 'This financial year' })))).toContain('No records yet');
    expect(text(html(h(OpenWorkOrdersTable, { open: dash.money!.openWorkOrders, canRecord: false })))).not.toContain('Raise a work order');
  });
});

describe('the tables', () => {
  it('tags void and overdue payouts, strikes the void amount and shows the native amount over the INR value', async () => {
    const w = await world();
    const payouts = await searchPayouts(w.sa, { sort: 'ref', dir: 'asc' });
    const out = html(h(PayoutTable, { items: payouts.items, params: {}, sort: 'ref', dir: 'asc' }));
    const copy = text(out);
    expect(copy).toContain('Void');
    expect(copy).toContain('Overdue');
    expect(copy).toContain('Paid');
    expect(copy).toContain('$1,000.00');
    expect(copy).toContain('₹83,420.00');
    expect(out).toContain('line-through');
    expect(out.split('line-through').length - 1).toBe(1); // only the void row
    expect(copy).toContain('Checkout build');
    // inside a work order's own page the work-order column goes
    expect(text(html(h(PayoutTable, { items: payouts.items, params: {}, showWorkOrder: false, linkThirdParty: false })))).toContain('Project');
  });

  it('the work-order table shows the balance and flags an overrun and an overdue date', async () => {
    const w = await world();
    await makeOrder(w.party, w.project, { title: 'Overrun job', agreedMinor: 100_000, paidMinor: 80_000, dueMinor: 50_000 });
    const orders = await searchWorkOrders(w.sa, { sort: 'ref', dir: 'asc' });
    const copy = text(html(h(WorkOrderTable, { items: orders.items, params: {}, sort: 'ref', dir: 'asc' })));
    expect(copy).toContain('$3,000.00');
    expect(copy).toContain('Over by');
    expect(copy).toContain('Overdue');
    expect(copy).toContain('Acme Robotics');
  });

  it('the directory shows money columns only when the rows carry money', async () => {
    const w = await world();
    const withMoney = html(h(ThirdPartyTable, { items: (await searchThirdParties(w.sa)).items, params: {}, sort: 'name', dir: 'asc' }));
    expect(text(withMoney)).toContain('Open orders');
    const without = html(h(ThirdPartyTable, { items: (await searchThirdParties(w.plain)).items, params: {}, sort: 'name', dir: 'asc' }));
    expect(text(without)).not.toContain('Open orders');
    expect(text(without)).not.toContain('Paid');
    expect(text(without)).toContain('Pixel Forge');
  });

  it('the section nav shows Work orders and Payouts only to viewers who may read money', () => {
    expect(text(html(h(SectionNav, { active: 'directory', showMoney: true })))).toMatch(/Directory.*Work orders.*Payouts/);
    expect(html(h(SectionNav, { active: 'directory', showMoney: false }))).toBe('');
  });
});

describe('who is offered which action', () => {
  const base = { payout: { id: 'p1', ref: 'TPP-FY27-0001', thirdPartyName: 'Pixel Forge', amountMinor: 100_000, currency: 'INR', capture: '' }, currencies: ['INR'], modes: ['bank_transfer'], today: '2026-10-12' };
  const form = { id: 'p1', amountMinor: 100_000, currency: 'INR', dueOn: '2026-10-12', tdsMinor: null, note: '', thirdPartyName: 'Pixel Forge', projectName: 'P', workOrder: null, projectId: 'x', task: null, attachments: [], capture: '' };
  const render = (status: 'due' | 'paid' | 'void', can: { edit: boolean; approve: boolean; void: boolean }) => text(html(h(PayoutActions, { ...base, status, form, can })));

  it('offers Mark paid to approvers, Edit to recorders while due, and Void to voiders until it is void', () => {
    const all = { edit: true, approve: true, void: true };
    const due = render('due', all);
    expect(due).toContain('Mark paid');
    expect(due).toContain('Edit');
    expect(due).toContain('Void');
    const paid = render('paid', all);
    expect(paid).not.toContain('Mark paid');
    expect(paid).not.toContain('Edit');
    expect(paid).toContain('Void');
    expect(render('void', all)).toBe('');
    // a recorder: edit only
    const recorder = render('due', { edit: true, approve: false, void: false });
    expect(recorder).toContain('Edit');
    expect(recorder).not.toContain('Mark paid');
    expect(recorder).not.toContain('Void');
    expect(render('due', { edit: false, approve: false, void: false })).toBe('');
  });

  it('the work-order actions offer a status change, and Edit only while it is open or delivered; none without payout:record', () => {
    const order = { id: 'w1', title: 'Checkout build' };
    const initial = { id: 'w1', title: 'Checkout build', scope: '', amountMinor: 1, currency: 'INR', dueOn: '', projectId: 'x', task: null, hasPayouts: false };
    const view = (status: 'open' | 'closed', canEdit: boolean) => text(html(h(WorkOrderActions, { order: { ...order, status }, form: initial, currencies: ['INR'], canEdit })));
    expect(view('open', true)).toContain('Change status');
    expect(view('open', true)).toContain('Edit');
    expect(view('closed', true)).not.toContain('Edit');
    expect(view('open', false)).toBe('');
  });

  it('the third-party actions offer Restore for an archived record and Edit and Archive otherwise', () => {
    const initial = { id: 't1', name: 'Pixel Forge', type: 'agency', skills: [], contactName: '', email: '', phone: '', country: '', defaultCurrency: '', gstin: '', notes: '', status: 'active' as const, paymentNote: '' };
    const live = text(html(h(ThirdPartyActions, { form: initial, name: 'Pixel Forge', archived: false, types: ['agency'], currencies: ['INR'], canPayDetails: false })));
    expect(live).toContain('Edit');
    expect(live).toContain('Archive');
    const archived = text(html(h(ThirdPartyActions, { form: initial, name: 'Pixel Forge', archived: true, types: ['agency'], currencies: ['INR'], canPayDetails: false })));
    expect(archived).toContain('Restore');
    expect(archived).not.toContain('Archive');
  });
});

describe('the mark-paid dialog', () => {
  const payout = { id: 'p1', ref: 'TPP-FY27-0001', thirdPartyName: 'Pixel Forge', amountMinor: 100_000, currency: 'USD', capture: '1 USD = INR 83 (table, 3 Oct 2026)' };

  it('asks for the day, the mode and the reference, and for a foreign amount explains the re-capture and shows the rate field', () => {
    const out = text(html(h(MarkPaidDialog, { open: true, onClose: () => {}, payout, modes: ['bank_transfer', 'cash'], today: '2026-10-12' })));
    expect(out).toContain('Paid on');
    expect(out).toContain('Transaction reference');
    expect(out).toContain('Bank transfer');
    expect(out).toContain('captured again for the paid date');
    expect(out).toContain('1 USD = INR 83 (table, 3 Oct 2026)');
    expect(out).toContain('Exchange rate');
  });

  it('for INR there is no rate field and no re-capture talk', () => {
    const out = text(html(h(MarkPaidDialog, { open: true, onClose: () => {}, payout: { ...payout, currency: 'INR', capture: '' }, modes: ['bank_transfer'], today: '2026-10-12' })));
    expect(out).not.toContain('Exchange rate');
    expect(out).not.toContain('captured again');
  });
});

describe('form initials', () => {
  it('turn plain DTOs into what the edit forms start from', async () => {
    const w = await world();
    const order = await getWorkOrder(w.sa, String(w.order._id));
    expect(workOrderFormInitial(order, true)).toMatchObject({ id: order.id, title: 'Checkout build', amountMinor: 500_000, currency: 'USD', hasPayouts: true, task: null });
    const [due] = (await searchPayouts(w.sa, { status: 'due' })).items;
    const dto = await getPayout(w.sa, due!.id);
    const initial = payoutFormInitial(dto);
    expect(initial).toMatchObject({ id: dto.id, amountMinor: 100_000, currency: 'USD', workOrder: { id: order.id, ref: order.ref }, projectName: 'Checkout redesign' });
    expect(initial.capture).toMatch(/^1 USD = INR 83\.42 \(table, /);
    expect(captureText(dto)).toBe(initial.capture);
  });
});
