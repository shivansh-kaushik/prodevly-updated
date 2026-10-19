import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { AuditLog, Client, ClientPayment, Lead, TeamPayout, WorkLog } from '@/models';
import { setupTestDb } from '@/test/db';
import { FY, HOSTILE_CLIENT, HOSTILE_TASK, holding, makeExportAudit, makeExportWorld, parseCsv, without, type ExportWorld } from '@/test/export-factories';
import { makeLead } from '@/test/lead-factories';
import { exportSection } from '../export.service';
import type { ExportSectionId } from './types';

setupTestDb();

/** Runs one export and reads the file back the way a spreadsheet would. */
async function run(viewer: ExportWorld['sa'], section: ExportSectionId, sp: Record<string, string> = {}, options: { cap?: number } = {}) {
  const result = await exportSection(viewer, section, sp, { requestId: 'req-test' }, options);
  return { ...result, file: parseCsv(result.csv) };
}

const names = (file: ReturnType<typeof parseCsv>, column: string) => file.records.map((r) => r[column]);

describe('clients', () => {
  it('lists every client with readable columns, never an id', async () => {
    const w = await makeExportWorld();
    const { file, rows, total, truncated, filename } = await run(w.sa, 'clients');
    expect(file.header).toEqual(['Reference', 'Name', 'Kind', 'Status', 'Country', 'Billing currency', 'Primary contact', 'Contact email', 'Account owner', 'Projects', 'Archived', 'Updated on']);
    expect(rows).toBe(3);
    expect(total).toBe(3);
    expect(truncated).toBe(false);
    expect(filename).toMatch(/^prodevly-clients-\d{4}-\d{2}-\d{2}\.csv$/);

    const acme = file.records.find((r) => r.Name === 'Acme Studio')!;
    expect(acme).toMatchObject({ Kind: 'Company', Status: 'Active', Country: 'India', 'Billing currency': 'INR', 'Primary contact': 'Anita Rao', 'Contact email': 'anita@acme.test', 'Account owner': 'Dev Person', Projects: '1', Archived: 'No' });
    expect(acme.Reference).toMatch(/^CL-\d{4}$/);
    expect(acme['Updated on']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(file.text).not.toMatch(/[a-f0-9]{24}/);
  });

  it('keeps a comma and quotes in a name intact, and neutralises a formula in a name', async () => {
    const w = await makeExportWorld();
    const { file, csv } = await run(w.sa, 'clients');
    expect(names(file, 'Name')).toContain('Beta, "Global" Ltd');
    expect(names(file, 'Name')).toContain(`'${HOSTILE_CLIENT}`);
    // Nothing in the column reads as a formula to a spreadsheet.
    expect(names(file, 'Name').every((n) => !/^[=+\-@]/.test(n ?? ''))).toBe(true);
    expect(csv).toContain('"Beta, ""Global"" Ltd"');
  });

  it('applies the list page filters: status, kind, country, search, archived and sort', async () => {
    const w = await makeExportWorld();
    expect(names((await run(w.sa, 'clients', { status: 'active' })).file, 'Name')).toEqual(['Acme Studio']);
    expect(names((await run(w.sa, 'clients', { country: 'us' })).file, 'Name')).toEqual(['Beta, "Global" Ltd']);
    expect(names((await run(w.sa, 'clients', { q: 'acme' })).file, 'Name')).toEqual(['Acme Studio']);
    expect((await run(w.sa, 'clients', { kind: 'individual' })).rows).toBe(0);
    // A search is matched literally: a regex metacharacter finds nothing instead of everything.
    expect((await run(w.sa, 'clients', { q: '.*' })).rows).toBe(0);
    expect(names((await run(w.sa, 'clients', { sort: 'name', dir: 'asc' })).file, 'Name')[0]).toBe(`'${HOSTILE_CLIENT}`);

    await Client.updateOne({ _id: w.beta._id }, { archivedAt: new Date() });
    expect(names((await run(w.sa, 'clients')).file, 'Name')).not.toContain('Beta, "Global" Ltd');
    expect(names((await run(w.sa, 'clients', { archived: 'only' })).file, 'Name')).toEqual(['Beta, "Global" Ltd']);
    expect((await run(w.sa, 'clients', { archived: 'include' })).rows).toBe(3);
    expect((await run(w.sa, 'clients', { archived: 'include' })).file.records.find((r) => r.Name?.startsWith('Beta'))?.Archived).toBe('Yes');
  });

  it('ignores page and junk parameters, as the page does, and returns all rows', async () => {
    const w = await makeExportWorld();
    expect((await run(w.sa, 'clients', { page: '9', status: 'not-a-status', sort: 'password', dir: 'sideways' })).rows).toBe(3);
  });
});

describe('projects', () => {
  it('carries the contract columns for a viewer who may see money', async () => {
    const w = await makeExportWorld();
    const { file } = await run(w.sa, 'projects');
    expect(file.header.slice(-3)).toEqual(['Pricing model', 'Contract amount', 'Contract currency']);
    const site = file.records.find((r) => r.Name === 'Acme website')!;
    expect(site).toMatchObject({ Client: 'Acme Studio', Status: 'Active', Health: 'On track', 'Project lead': 'Dev Person', Deadline: '2026-12-15', 'Pricing model': 'Fixed', 'Contract amount': '10000.00', 'Contract currency': 'INR' });
    const app = file.records.find((r) => r.Name === 'Beta app')!;
    expect(app).toMatchObject({ 'Contract amount': '5000.00', 'Contract currency': 'USD', Status: 'In review', Health: 'At risk' });
  });

  it('leaves the money columns out entirely without payment:view, and no contract figure leaks anywhere', async () => {
    const w = await makeExportWorld();
    const viewer = without(w.sa, 'payment:view');
    const { file } = await run(viewer, 'projects');
    expect(file.header).not.toContain('Contract amount');
    expect(file.header).not.toContain('Pricing model');
    expect(file.header).not.toContain('Contract currency');
    expect(file.header).toHaveLength(15);
    expect(file.rows.every((r) => r.length === 15)).toBe(true);
    expect(file.text).not.toContain('10000.00');
    expect(file.text).not.toContain('5000.00');
    expect(file.records).toHaveLength(2);
  });

  it('applies status, health and client filters', async () => {
    const w = await makeExportWorld();
    expect(names((await run(w.sa, 'projects', { status: 'in_review' })).file, 'Name')).toEqual(['Beta app']);
    expect(names((await run(w.sa, 'projects', { health: 'on_track' })).file, 'Name')).toEqual(['Acme website']);
    expect(names((await run(w.sa, 'projects', { client: String(w.beta._id) })).file, 'Name')).toEqual(['Beta app']);
    expect((await run(w.sa, 'projects', { client: 'not-an-id' })).rows).toBe(2);
  });
});

describe('tasks', () => {
  it('lists tasks with their project, client, hours and assignees', async () => {
    const w = await makeExportWorld();
    const { file } = await run(w.sa, 'tasks');
    expect(file.header).toEqual(['Reference', 'Title', 'Project reference', 'Project', 'Client', 'Status', 'Priority', 'Due on', 'Overdue', 'Estimate (hours)', 'Logged (hours)', 'Assigned to', 'Archived', 'Updated on']);
    const home = file.records.find((r) => r.Title === 'Build the home page')!;
    expect(home).toMatchObject({ Project: 'Acme website', Client: 'Acme Studio', Status: 'In progress', Priority: 'High', 'Due on': '2026-11-01', 'Estimate (hours)': '8.00', 'Logged (hours)': '1.50', 'Assigned to': 'Dev Person' });
    expect(home['Project reference']).toMatch(/^PRJ-\d{4}$/);
    expect(home.Reference).toMatch(/^PRJ-\d{4}-T\d{3}$/);
  });

  it('neutralises a formula in a title', async () => {
    const w = await makeExportWorld();
    expect(names((await run(w.sa, 'tasks')).file, 'Title')).toContain(`'${HOSTILE_TASK}`);
  });

  it('applies the list filters, including "assigned to me" for the viewer', async () => {
    const w = await makeExportWorld();
    expect(names((await run(w.sa, 'tasks', { priority: 'high' })).file, 'Title')).toEqual(['Build the home page']);
    expect(names((await run(w.sa, 'tasks', { status: 'open' })).file, 'Title')).toHaveLength(2);
    expect(names((await run(w.sa, 'tasks', { projectId: String(w.app._id) })).file, 'Title')).toEqual([`'${HOSTILE_TASK}`]);
    expect(names((await run(w.sa, 'tasks', { assignee: 'unassigned' })).file, 'Title')).toEqual([`'${HOSTILE_TASK}`]);
    const asDev = { ...holding(w.devSession, 'export:data', 'task:view'), stepUpValid: true };
    expect(names((await run(asDev, 'tasks', { assignee: 'me' })).file, 'Title')).toEqual(['Build the home page']);
    expect((await run(w.sa, 'tasks', { q: 'home' })).rows).toBe(1);
  });
});

describe('work logs', () => {
  it('lists the financial year by default and states hours with two decimals', async () => {
    const w = await makeExportWorld();
    const { file, rows } = await run(w.sa, 'work-logs', { ...FY });
    expect(rows).toBe(2);
    expect(file.header).toEqual(['Worked on', 'Person', 'Task reference', 'Task', 'Project reference', 'Project', 'Client', 'Minutes', 'Hours', 'Billable', 'Locked by a payout', 'Work done', 'Logged on']);
    const billable = file.records.find((r) => r.Billable === 'Yes')!;
    expect(billable).toMatchObject({ 'Worked on': '2026-10-05', Person: 'Dev Person', Task: 'Build the home page', Project: 'Acme website', Client: 'Acme Studio', Minutes: '90', Hours: '1.50', 'Locked by a payout': 'No' });
  });

  it('follows the period, the billable filter and the person filter', async () => {
    const w = await makeExportWorld();
    expect((await run(w.sa, 'work-logs', { period: 'custom', from: '2025-01-01', to: '2027-03-31' })).rows).toBe(3);
    expect((await run(w.sa, 'work-logs', { period: 'custom', from: '2025-01-01', to: '2025-12-31' })).rows).toBe(1);
    expect((await run(w.sa, 'work-logs', { ...FY, billable: 'no' })).rows).toBe(1);
    expect((await run(w.sa, 'work-logs', { ...FY, billable: 'yes' })).rows).toBe(1);
    expect((await run(w.sa, 'work-logs', { ...FY, adminId: String(w.other._id) })).rows).toBe(0);
    expect((await run(w.sa, 'work-logs', { period: 'custom', from: '2025-01-01', to: '2027-03-31', adminId: String(w.other._id) })).rows).toBe(1);
    expect((await run(w.sa, 'work-logs', { ...FY, projectId: String(w.app._id) })).rows).toBe(0);
  });
});

describe('work log details', () => {
  it('shows an entry covered by a payout as locked, and neutralises a note that starts with a plus sign', async () => {
    const w = await makeExportWorld();
    await WorkLog.updateOne({ minutes: 30 }, { lockedByPayoutId: new Types.ObjectId(), note: '+91 98765 call' });
    const { file } = await run(w.sa, 'work-logs', { ...FY });
    expect(file.records.find((r) => r.Minutes === '30')).toMatchObject({ 'Locked by a payout': 'Yes', 'Work done': "'+91 98765 call", Hours: '0.50', Billable: 'No' });
    expect(file.records.find((r) => r.Minutes === '90')).toMatchObject({ 'Locked by a payout': 'No' });
  });
});

describe('payments', () => {
  it('writes each amount in its own currency beside an INR column built from the stored inrMinor', async () => {
    const w = await makeExportWorld();
    const { file } = await run(w.sa, 'payments', { ...FY });
    expect(file.header).toEqual([
      'Reference', 'Received on', 'Type', 'Status', 'Client', 'Project reference', 'Project', 'Task reference', 'Milestone', 'Amount', 'Currency', 'Exchange rate to INR', 'Amount (INR)',
      'TDS', 'Bank charges', 'Mode', 'Transaction reference', 'Invoice reference', 'Recorded as advance', 'Void reason', 'Recorded by',
    ]);
    expect(file.records).toHaveLength(3);
    const usd = file.records.find((r) => r.Currency === 'USD')!;
    expect(usd).toMatchObject({ Amount: '1000.00', 'Exchange rate to INR': '83.42', 'Amount (INR)': '83420.00', 'Received on': '2026-10-03', Client: 'Beta, "Global" Ltd', Project: 'Beta app', Mode: 'Bank transfer', Type: 'Receipt', Status: 'Received' });
    const inr = file.records.find((r) => r.Amount === '1250.50')!;
    expect(inr).toMatchObject({ Currency: 'INR', 'Exchange rate to INR': '1', 'Amount (INR)': '1250.50' });
  });

  it('writes TDS and bank charges in the entry currency, blank when there are none', async () => {
    const w = await makeExportWorld();
    await ClientPayment.updateOne({ 'amount.currency': 'USD' }, { tdsMinor: 10_000, chargesMinor: 1_250 });
    const { file } = await run(w.sa, 'payments', { ...FY });
    expect(file.records.find((r) => r.Currency === 'USD')).toMatchObject({ TDS: '100.00', 'Bank charges': '12.50' });
    expect(file.records.find((r) => r.Amount === '1250.50')).toMatchObject({ TDS: '', 'Bank charges': '' });
  });

  it('lists a void entry with its status and reason, and filters by status, type and currency', async () => {
    const w = await makeExportWorld();
    const all = await run(w.sa, 'payments', { ...FY });
    expect(all.file.records.find((r) => r.Status === 'Void')).toMatchObject({ 'Void reason': 'Entered in error', Amount: '500.00' });
    expect((await run(w.sa, 'payments', { ...FY, status: 'received' })).rows).toBe(2);
    expect((await run(w.sa, 'payments', { ...FY, status: 'void' })).rows).toBe(1);
    expect((await run(w.sa, 'payments', { ...FY, currency: 'usd' })).rows).toBe(1);
    expect((await run(w.sa, 'payments', { ...FY, type: 'refund' })).rows).toBe(0);
    expect((await run(w.sa, 'payments', { ...FY, project: String(w.app._id) })).rows).toBe(1);
    expect((await run(w.sa, 'payments', { ...FY, client: String(w.acme._id) })).rows).toBe(2);
  });

  it('keeps entries outside the period out', async () => {
    const w = await makeExportWorld();
    expect((await run(w.sa, 'payments', { period: 'custom', from: '2026-10-02', to: '2026-10-03' })).rows).toBe(1);
    expect((await run(w.sa, 'payments', { period: 'custom', from: '2025-01-01', to: '2025-12-31' })).rows).toBe(0);
  });
});

describe('third-party payouts and work orders', () => {
  it('exports payouts with the INR value of a foreign amount and filters by status', async () => {
    const w = await makeExportWorld();
    const { file, rows } = await run(w.sa, 'third-party-payouts');
    expect(rows).toBe(2);
    const due = file.records.find((r) => r.Status === 'Due')!;
    expect(due).toMatchObject({ Amount: '200.00', Currency: 'USD', 'Exchange rate to INR': '83.42', 'Amount (INR)': '16684.00', 'Due on': '2026-10-20', 'Paid on': '', Overdue: 'No', Project: 'Beta app' });
    expect(file.records.find((r) => r.Status === 'Paid')).toMatchObject({ Amount: '3000.00', 'Amount (INR)': '3000.00', 'Paid on': '2026-10-02' });
    expect((await run(w.sa, 'third-party-payouts', { status: 'due' })).rows).toBe(1);
    expect((await run(w.sa, 'third-party-payouts', { project: String(w.site._id) })).rows).toBe(1);
  });

  it('exports work orders in their own currency and filters by status', async () => {
    const w = await makeExportWorld();
    const { file, rows } = await run(w.sa, 'work-orders');
    expect(rows).toBe(1);
    expect(file.records[0]).toMatchObject({ Title: 'Test work order', Currency: 'INR', 'Agreed amount': '8000.00', Paid: '3000.00', 'Due to pay': '0.00', 'Balance to record': '5000.00', Status: 'Open', Project: 'Acme website', Client: 'Acme Studio' });
    expect((await run(w.sa, 'work-orders', { status: 'closed' })).rows).toBe(0);
    expect((await run(w.sa, 'work-orders', { status: 'current' })).rows).toBe(1);
  });
});

describe('expenses', () => {
  it('lists every expense for a viewer who can see everyone\'s, with a neutralised description', async () => {
    const w = await makeExportWorld();
    const { file } = await run(w.sa, 'expenses', { ...FY });
    expect(file.records).toHaveLength(3);
    expect(file.records.find((r) => r.Description?.includes('Taxi'))).toMatchObject({
      Description: "'=1+1 Taxi to the client", Status: 'Submitted', 'Charged to': 'Client project', Client: 'Acme Studio', Project: 'Acme website', Amount: '450.00', Currency: 'INR', 'Amount (INR)': '450.00', 'Paid from': 'Out of pocket', 'Paid by': 'Dev Person',
    });
    expect(file.records.find((r) => r.Status === 'Paid')).toMatchObject({ 'Charged to': 'Company overhead', 'Paid from': 'Company', Category: 'Software subscriptions', 'Paid on': '2026-10-05' });
  });

  it('confines a viewer who may only submit to their own out-of-pocket expenses', async () => {
    const w = await makeExportWorld();
    const asDev = { ...holding(w.devSession, 'export:data', 'expense:submit'), stepUpValid: true };
    const { file, total } = await run(asDev, 'expenses', { ...FY });
    expect(total).toBe(1);
    expect(file.records).toHaveLength(1);
    expect(file.records[0]).toMatchObject({ 'Paid by': 'Dev Person' });
    expect(file.text).not.toContain('Olive');
    // Asking for someone else's by URL does not widen it.
    expect((await run(asDev, 'expenses', { ...FY, person: String(w.other._id), paidFrom: 'company' })).rows).toBe(1);
  });

  it('applies status, category, project and period filters, and shows a waiting queue whatever the period', async () => {
    const w = await makeExportWorld();
    expect((await run(w.sa, 'expenses', { ...FY, status: 'paid' })).rows).toBe(1);
    expect((await run(w.sa, 'expenses', { ...FY, category: 'travel' })).rows).toBe(0);
    expect((await run(w.sa, 'expenses', { ...FY, projectId: String(w.site._id) })).rows).toBe(1);
    expect((await run(w.sa, 'expenses', { ...FY, person: String(w.other._id) })).rows).toBe(1);
    expect((await run(w.sa, 'expenses', { period: 'custom', from: '2020-01-01', to: '2020-12-31' })).rows).toBe(0);
    expect((await run(w.sa, 'expenses', { period: 'custom', from: '2020-01-01', to: '2020-12-31', status: 'submitted' })).rows).toBe(2);
  });
});

describe('team payouts', () => {
  it('lists payouts with what was charged to projects and what stayed overhead', async () => {
    const w = await makeExportWorld();
    const { file, rows } = await run(w.sa, 'team-payouts', { ...FY });
    expect(rows).toBe(1);
    expect(file.header).toEqual([
      'Reference', 'Person', 'Basis', 'Period from', 'Period to', 'Amount', 'Currency', 'Exchange rate to INR', 'Amount (INR)', 'Status', 'Due on', 'Paid on', 'Mode', 'Transaction reference',
      'Charged to projects', 'Allocated to projects (INR)', 'Company overhead (INR)',
    ]);
    const r = file.records[0]!;
    expect(r).toMatchObject({ Basis: 'Salary', 'Period from': '2026-06-01', 'Period to': '2026-06-30', Amount: '50000.00', 'Amount (INR)': '50000.00', Status: 'Paid', 'Paid on': '2026-10-05', 'Allocated to projects (INR)': '30000.00' });
    expect(r['Charged to projects']).toMatch(/^PRJ-\d{4}$/);
    expect(r.Reference).toMatch(/^TMP-FY\d{2}-\d{4}$/);
  });

  it('states the part of a payout that stayed company overhead', async () => {
    const w = await makeExportWorld();
    await TeamPayout.updateMany({}, { unallocatedInrMinor: 2_000_000 });
    expect((await run(w.sa, 'team-payouts', { ...FY })).file.records[0]).toMatchObject({ 'Company overhead (INR)': '20000.00' });
  });

  it('filters by status and by period', async () => {
    const w = await makeExportWorld();
    expect((await run(w.sa, 'team-payouts', { ...FY, status: 'due' })).rows).toBe(0);
    expect((await run(w.sa, 'team-payouts', { ...FY, status: 'paid' })).rows).toBe(1);
    expect((await run(w.sa, 'team-payouts', { period: 'custom', from: '2025-01-01', to: '2025-12-31' })).rows).toBe(0);
  });
});

describe('enquiries', () => {
  it('lists enquiries with dates in the organisation time zone and neutralises the visitor\'s message', async () => {
    const w = await makeExportWorld();
    const { file, rows } = await run(w.sa, 'enquiries', { ...FY });
    expect(rows).toBe(2);
    const zoe = file.records.find((r) => r.Name === 'Zoë Åström')!;
    // 20:00 UTC on the 2nd is 01:30 on the 3rd in Asia/Kolkata.
    expect(zoe).toMatchObject({ 'Received on': '2026-10-03', Email: 'zoe@example.com', Company: 'Åström AB', Status: 'New' });
    expect(zoe['Message (first 140 characters)']?.startsWith("'=HYPERLINK(")).toBe(true);
    expect(zoe.Reference).toMatch(/^ENQ-\d{4}$/);
  });

  it('applies the status and period filters and holds spam out of the everyday list', async () => {
    const w = await makeExportWorld();
    await makeLead({ name: 'Spammer', status: 'spam', createdAt: new Date('2026-10-05T08:00:00Z') });
    expect((await run(w.sa, 'enquiries', { ...FY })).rows).toBe(2);
    expect(names((await run(w.sa, 'enquiries', { ...FY, status: 'contacted' })).file, 'Name')).toEqual(['Ravi Kumar']);
    expect(names((await run(w.sa, 'enquiries', { ...FY, status: 'spam' })).file, 'Name')).toEqual(['Spammer']);
    expect((await run(w.sa, 'enquiries', { period: 'custom', from: '2026-10-04', to: '2026-10-04' })).rows).toBe(1);
    expect((await run(w.sa, 'enquiries', { ...FY, q: 'zoë' })).rows).toBe(1);
    await Lead.updateOne({ name: 'Ravi Kumar' }, { followUpOn: new Date('2026-01-01T00:00:00Z') });
    expect(names((await run(w.sa, 'enquiries', { followUp: 'due' })).file, 'Name')).toEqual(['Ravi Kumar']);
  });
});

describe('audit', () => {
  it('gives a superadmin everyone\'s entries, with the fields that changed and no values or hashes', async () => {
    const w = await makeExportWorld();
    await makeExportAudit(w.saDoc, w.dev);
    const { file, rows } = await run(w.sa, 'audit', { ...FY });
    expect(rows).toBe(2);
    expect(file.header).toEqual(['Date', 'Time (Asia/Kolkata)', 'Person', 'Action', 'Action code', 'Record type', 'Record reference', 'Record', 'Summary', 'Fields changed', 'Request id']);
    const update = file.records.find((r) => r['Action code'] === 'client.update')!;
    expect(update).toMatchObject({ Date: '2026-10-05', 'Time (Asia/Kolkata)': '14:30', Person: 'Sara Superadmin', 'Record type': 'client', 'Record reference': 'CL-0001', Record: 'Acme Studio', Summary: 'Changed the status', 'Fields changed': 'status; (sensitive field)', 'Request id': 'req-1' });
    expect(update.Action).toBe('updated client');
    expect(file.text).not.toMatch(/ip-hash|secret-agent|old-hash|new-hash|passwordHash/);
    // The other person's entry is neutralised where it begins with a formula or a plus sign, and the IST date is used.
    const create = file.records.find((r) => r['Action code'] === 'task.create')!;
    expect(create).toMatchObject({ Record: "'=1+1 task", Summary: "'+91 98765 note", Date: '2026-10-07', 'Time (Asia/Kolkata)': '02:00' });
  });

  it('gives everyone else only their own entries, whatever the URL asks for', async () => {
    const w = await makeExportWorld();
    await makeExportAudit(w.saDoc, w.dev);
    const asDev = { ...holding(w.devSession, 'export:data'), stepUpValid: true };
    const { file, rows } = await run(asDev, 'audit', { ...FY, actor: String(w.saDoc._id) });
    expect(rows).toBe(1);
    expect(file.records[0]).toMatchObject({ Person: 'Dev Person', 'Action code': 'task.create' });
    expect(file.text).not.toContain('Sara Superadmin');
  });

  it('applies the action, record type, search and sensitive filters', async () => {
    const w = await makeExportWorld();
    await makeExportAudit(w.saDoc, w.dev);
    expect((await run(w.sa, 'audit', { ...FY, action: 'client.' })).rows).toBe(1);
    expect((await run(w.sa, 'audit', { ...FY, entity: 'task' })).rows).toBe(1);
    expect((await run(w.sa, 'audit', { ...FY, q: 'Acme' })).rows).toBe(1);
    expect((await run(w.sa, 'audit', { ...FY, actor: String(w.dev._id) })).rows).toBe(1);
    expect((await run(w.sa, 'audit', { period: 'custom', from: '2025-01-01', to: '2025-12-31' })).rows).toBe(1);
    expect((await run(w.sa, 'audit', { ...FY, sensitive: '1' })).rows).toBe(0);
  });

  it('contains the export itself on the next export, as an entry of its own record type', async () => {
    const w = await makeExportWorld();
    await run(w.sa, 'clients');
    const next = await run(w.sa, 'audit', { period: 'this_month' });
    const entry = next.file.records.find((r) => r['Action code'] === 'export.clients');
    expect(entry).toMatchObject({ 'Record type': 'export', Person: 'Sara Superadmin' });
    expect(entry?.Summary).toContain('Exported 3 clients to CSV');
    expect(entry?.Action).toBe('exported clients');
    expect(await AuditLog.countDocuments({ action: 'export.clients' })).toBe(1);
  });
});
