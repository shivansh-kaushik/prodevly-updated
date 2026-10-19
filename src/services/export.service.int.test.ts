import { describe, expect, it } from 'vitest';
import type { Capability } from '@/config/capabilities';
import { AuditLog, ClientPayment, Lead, PayProfile, ThirdParty, ThirdPartyPayout, TeamPayout, Client, Task } from '@/models';
import { setupTestDb } from '@/test/db';
import { FY, holding, makeExportAudit, makeExportWorld, parseCsv, without } from '@/test/export-factories';
import { makeLead } from '@/test/lead-factories';
import { makePayProfile } from '@/test/team-factories';
import { exportSection } from './export.service';
import { EXPORT_SECTIONS, type ExportSectionId } from './exports/types';

setupTestDb();

const meta = { requestId: 'req-1', ipHash: 'caller-hash', userAgent: 'vitest' };
const rejects = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string; status?: number };
  }
  throw new Error('Expected the call to be refused');
};

/** What each section needs on top of export:data. The audit log needs nothing: every admin has a trail. */
const VIEW: Record<ExportSectionId, Capability[]> = {
  clients: ['client:view'],
  projects: ['project:view'],
  tasks: ['task:view'],
  'work-logs': ['worklog:viewAll'],
  payments: ['payment:view'],
  'third-party-payouts': ['payout:view'],
  'work-orders': ['payout:view'],
  expenses: ['expense:view'],
  'team-payouts': ['team:payView'],
  enquiries: ['lead:view'],
  audit: [],
};

describe('who may export', () => {
  it('refuses a viewer without export:data, for every section, and writes nothing', async () => {
    const w = await makeExportWorld();
    const viewer = { ...without(w.sa, 'export:data') };
    for (const section of EXPORT_SECTIONS) {
      const error = await rejects(exportSection(viewer, section, {}, meta));
      expect(error.code, section).toBe('FORBIDDEN');
      expect(error.status, section).toBe(403);
    }
    expect(await AuditLog.countDocuments({ 'entity.type': 'export' })).toBe(0);
  });

  it('refuses without an open step-up, for every section, and writes nothing', async () => {
    const w = await makeExportWorld();
    const viewer = { ...w.sa, stepUpValid: false };
    for (const section of EXPORT_SECTIONS) {
      const error = await rejects(exportSection(viewer, section, {}, meta));
      expect(error.code, section).toBe('STEP_UP_REQUIRED');
      expect(error.status, section).toBe(403);
    }
    expect(await AuditLog.countDocuments({ 'entity.type': 'export' })).toBe(0);
  });

  it('refuses export:data held WITHOUT the section\'s own view capability, and writes nothing', async () => {
    const w = await makeExportWorld();
    for (const section of EXPORT_SECTIONS) {
      if (section === 'audit') continue;
      const viewer = holding(w.sa, 'export:data');
      const error = await rejects(exportSection(viewer, section, {}, meta));
      expect(error.code, section).toBe('FORBIDDEN');
    }
    expect(await AuditLog.countDocuments({ 'entity.type': 'export' })).toBe(0);
  });

  it('lets the same viewer export once they hold the section\'s capability, and no other section', async () => {
    const w = await makeExportWorld();
    for (const section of EXPORT_SECTIONS) {
      const viewer = holding(w.sa, 'export:data', ...VIEW[section]);
      const result = await exportSection(viewer, section, { ...FY }, meta);
      expect(result.section).toBe(section);
      expect(result.csv.startsWith('﻿')).toBe(true);
    }
    // One capability opens one section: client:view alone does not open the payments export.
    const clientsOnly = holding(w.sa, 'export:data', 'client:view');
    expect((await rejects(exportSection(clientsOnly, 'payments', {}, meta))).code).toBe('FORBIDDEN');
    // Seeing a section's page is not enough either: the export needs its own capability.
    const noExport = holding(w.sa, 'client:view', 'payment:view', 'project:view');
    expect((await rejects(exportSection(noExport, 'clients', {}, meta))).code).toBe('FORBIDDEN');
  });

  it('treats the work-log export as everyone\'s time: worklog:own is not enough', async () => {
    const w = await makeExportWorld();
    const viewer = holding(w.sa, 'export:data', 'worklog:own');
    expect((await rejects(exportSection(viewer, 'work-logs', {}, meta))).code).toBe('FORBIDDEN');
  });

  it('answers NOT_FOUND for a section that does not exist, after the capability checks', async () => {
    const w = await makeExportWorld();
    expect((await rejects(exportSection(w.sa, 'secrets', {}, meta))).code).toBe('NOT_FOUND');
    expect((await rejects(exportSection(w.sa, '__proto__', {}, meta))).code).toBe('NOT_FOUND');
    expect((await rejects(exportSection(w.sa, 'constructor', {}, meta))).code).toBe('NOT_FOUND');
    expect((await rejects(exportSection(without(w.sa, 'export:data'), 'secrets', {}, meta))).code).toBe('FORBIDDEN');
    expect(await AuditLog.countDocuments({ 'entity.type': 'export' })).toBe(0);
  });

  it('opens an export to an admin who holds a grant, and only for what the grant covers', async () => {
    const w = await makeExportWorld();
    const viewer = { ...holding(w.devSession, 'export:data', 'client:view', 'task:view'), stepUpValid: true };
    expect((await exportSection(viewer, 'clients', {}, meta)).rows).toBe(3);
    expect((await rejects(exportSection(viewer, 'payments', {}, meta))).code).toBe('FORBIDDEN');
  });
});

describe('the audit entry', () => {
  it('writes exactly one entry per export, with the actor, the row count, the filters and the request', async () => {
    const w = await makeExportWorld();
    await exportSection(w.sa, 'clients', { status: 'active', q: 'acme' }, meta);
    const entries = await AuditLog.find({ 'entity.type': 'export' }).lean();
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry).toMatchObject({ action: 'export.clients', entity: { type: 'export', ref: 'clients', label: 'clients export' }, requestId: 'req-1', ipHash: 'caller-hash', userAgent: 'vitest' });
    expect(entry?.actor).toMatchObject({ name: 'Sara Superadmin', role: 'superadmin' });
    expect(String(entry?.actor.id)).toBe(w.sa.id);
    expect(entry?.summary).toContain('Exported 1 clients to CSV');
    expect(entry?.summary).toContain('search=acme');
    expect(entry?.summary).toContain('status=active');
    expect(entry?.changes).toEqual([]);
  });

  it('says "none" when no filter was set, and names the period for a section that has one', async () => {
    const w = await makeExportWorld();
    await exportSection(w.sa, 'clients', {}, meta);
    await exportSection(w.sa, 'payments', { ...FY }, meta);
    const clients = await AuditLog.findOne({ action: 'export.clients' }).lean();
    const payments = await AuditLog.findOne({ action: 'export.payments' }).lean();
    expect(clients?.summary).toMatch(/Filters: sort=updatedAt desc$/);
    expect(payments?.summary).toContain('period=2026-04-01 to 2027-03-31');
    expect(payments?.summary).toContain('Exported 3 client payments to CSV');
  });

  it('uses an underscore in the action for a multi-word section so the audit filter can find it', async () => {
    const w = await makeExportWorld();
    await exportSection(w.sa, 'third-party-payouts', {}, meta);
    await exportSection(w.sa, 'work-logs', { ...FY }, meta);
    expect(await AuditLog.countDocuments({ action: 'export.third_party_payouts' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'export.work_logs' })).toBe(1);
  });

  it('writes one entry for each section exported, and never a second for one export', async () => {
    const w = await makeExportWorld();
    for (const section of EXPORT_SECTIONS) await exportSection(w.sa, section, { ...FY }, meta);
    expect(await AuditLog.countDocuments({ 'entity.type': 'export' })).toBe(EXPORT_SECTIONS.length);
  });

  it('records an empty export too: a file with only a header is still a read of the data', async () => {
    const w = await makeExportWorld();
    const result = await exportSection(w.sa, 'clients', { status: 'past' }, meta);
    expect(result.rows).toBe(0);
    expect(result.csv.split('\r\n').filter(Boolean)).toHaveLength(1);
    expect((await AuditLog.findOne({ action: 'export.clients' }).lean())?.summary).toContain('Exported 0 clients to CSV');
  });

  it('does not deliver an export that cannot be logged', async () => {
    const w = await makeExportWorld();
    // An actor name past the model's limit makes the audit write fail.
    const viewer = { ...w.sa, name: 'x'.repeat(500) };
    await expect(exportSection(viewer, 'clients', {}, meta)).rejects.toBeTruthy();
    expect(await AuditLog.countDocuments({ 'entity.type': 'export' })).toBe(0);
  });
});

describe('the row cap', () => {
  it('cuts at the cap, says so, and reports how many matched', async () => {
    const w = await makeExportWorld();
    const result = await exportSection(w.sa, 'clients', {}, meta, { cap: 2 });
    expect(result.rows).toBe(2);
    expect(result.total).toBe(3);
    expect(result.truncated).toBe(true);
    expect(parseCsv(result.csv).records).toHaveLength(2);
    expect((await AuditLog.findOne({ action: 'export.clients' }).lean())?.summary).toContain('Exported 2 clients to CSV (cut at 2 of 3)');
  });

  it('is not truncated when the matches fit exactly', async () => {
    const w = await makeExportWorld();
    const exact = await exportSection(w.sa, 'clients', {}, meta, { cap: 3 });
    expect(exact).toMatchObject({ rows: 3, total: 3, truncated: false });
    const roomy = await exportSection(w.sa, 'clients', {}, meta, { cap: 5 });
    expect(roomy).toMatchObject({ rows: 3, total: 3, truncated: false });
  });

  it('walks past the list\'s page size of 100: every row once, none twice', async () => {
    const w = await makeExportWorld();
    const base = new Date('2026-09-01T00:00:00Z').getTime();
    for (let i = 0; i < 230; i++) await makeLead({ name: `Bulk ${String(i).padStart(3, '0')}`, createdAt: new Date(base + i * 60_000) });
    const all = await exportSection(w.sa, 'enquiries', { ...FY }, meta);
    const file = parseCsv(all.csv);
    expect(all.rows).toBe(232);
    expect(all.total).toBe(232);
    expect(new Set(file.records.map((r) => r.Reference)).size).toBe(232);
    // Page order is kept: newest first, the two from the world, then the bulk ones counting down.
    expect(file.records.map((r) => r.Name).slice(0, 4)).toEqual(['Ravi Kumar', 'Zoë Åström', 'Bulk 229', 'Bulk 228']);
    expect(file.records.at(-1)?.Name).toBe('Bulk 000');

    const cut = await exportSection(w.sa, 'enquiries', { ...FY }, meta, { cap: 120 });
    expect(cut).toMatchObject({ rows: 120, total: 232, truncated: true });
    expect(new Set(parseCsv(cut.csv).records.map((r) => r.Reference)).size).toBe(120);
  }, 120_000);

  it('applies the cap to every section\'s rows, not just the first', async () => {
    const w = await makeExportWorld();
    for (const section of ['projects', 'tasks', 'payments', 'third-party-payouts', 'expenses'] as const) {
      const result = await exportSection(w.sa, section, { ...FY }, meta, { cap: 1 });
      expect(result.rows, section).toBe(1);
      expect(result.truncated, section).toBe(true);
    }
  });
});

describe('the file', () => {
  it('starts with a UTF-8 byte order mark, ends each record with CRLF, and keeps unicode', async () => {
    const w = await makeExportWorld();
    const { csv } = await exportSection(w.sa, 'enquiries', { ...FY }, meta);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const bytes = Buffer.from(csv, 'utf8');
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.replace(/\r\n/g, '')).not.toContain('\n');
    expect(csv).toContain('Zoë Åström');
  });

  it('names the file prodevly-<section>-<date>.csv with the date in the organisation time zone', async () => {
    const w = await makeExportWorld();
    // 20:00 UTC on the 12th is already the 13th in Asia/Kolkata.
    const result = await exportSection(w.sa, 'third-party-payouts', {}, meta, { now: new Date('2026-10-12T20:00:00Z') });
    expect(result.filename).toBe('prodevly-third-party-payouts-2026-10-13.csv');
    const early = await exportSection(w.sa, 'clients', {}, meta, { now: new Date('2026-10-12T10:00:00Z') });
    expect(early.filename).toBe('prodevly-clients-2026-10-12.csv');
  });

  it('writes the same number of cells in every row as there are headers, in every section', async () => {
    const w = await makeExportWorld();
    await makeExportAudit(w.saDoc, w.dev);
    for (const section of EXPORT_SECTIONS) {
      const { csv } = await exportSection(w.sa, section, { ...FY }, meta);
      const file = parseCsv(csv);
      expect(file.header.length, section).toBeGreaterThan(3);
      for (const row of file.rows) expect(row.length, section).toBe(file.header.length);
    }
  });

  it('never leaves a cell that a spreadsheet could read as a formula', async () => {
    const w = await makeExportWorld();
    await makeExportAudit(w.saDoc, w.dev);
    for (const section of EXPORT_SECTIONS) {
      const file = parseCsv((await exportSection(w.sa, section, { ...FY }, meta)).csv);
      for (const row of file.rows) {
        for (const cell of row) {
          // A bare number (a refund) is a number, not a formula; everything else must not lead with a trigger.
          if (/^-?\d+(\.\d+)?$/.test(cell)) continue;
          expect(cell.replace(/^[\s​-‍⁠﻿]+/, ''), `${section}: ${cell}`).not.toMatch(/^[=+\-@]/);
          expect(cell, `${section}: ${cell}`).not.toMatch(/^[\t\r]/);
        }
      }
    }
  });
});

describe('secrets never reach a file', () => {
  const PLANTED = ['SECRET-PAYMENT-NOTE', 'SECRET-PAYOUT-NOTE', 'SECRET-TEAM-NOTE', 'SECRET-PAYMENT-DETAILS', 'SECRET-IP-HASH', 'SECRET-USER-AGENT', 'SECRET-LEAD-NOTE', 'SECRET-CLIENT-NOTE', 'SECRET-PAY-PROFILE-NOTE', 'SECRET-MESSAGE-HASH', 'SECRET-TASK-DESCRIPTION'];
  /** A header that names any of these would be a column of something that must never be exported. */
  const FORBIDDEN_HEADER = /note|hash|password|token|secret|\bip\b|user agent|payout note|pay profile|payment detail|bank account|ifsc|upi|gstin|tax id/i;

  async function plant() {
    const w = await makeExportWorld();
    await makeExportAudit(w.saDoc, w.dev);
    await ClientPayment.updateMany({}, { note: 'SECRET-PAYMENT-NOTE' });
    await ThirdPartyPayout.updateMany({}, { note: 'SECRET-PAYOUT-NOTE' });
    await TeamPayout.updateMany({}, { note: 'SECRET-TEAM-NOTE' });
    await ThirdParty.updateMany({}, { paymentNote: 'SECRET-PAYMENT-DETAILS' });
    await Lead.updateMany({}, { ipHash: 'SECRET-IP-HASH', userAgent: 'SECRET-USER-AGENT', messageHash: 'SECRET-MESSAGE-HASH', notes: [{ at: new Date(), by: { id: null, name: 'Test' }, text: 'SECRET-LEAD-NOTE' }] });
    await Client.updateMany({}, { notes: 'SECRET-CLIENT-NOTE' });
    await Task.updateMany({}, { description: 'SECRET-TASK-DESCRIPTION' });
    await PayProfile.deleteMany({});
    await makePayProfile(w.dev, { payoutNote: 'SECRET-PAY-PROFILE-NOTE' });
    return w;
  }

  it('has no column for notes, hashes, passwords, bank details or pay profiles in any section, even when they are set', async () => {
    const w = await plant();
    for (const section of EXPORT_SECTIONS) {
      const { csv } = await exportSection(w.sa, section, { ...FY }, meta);
      const file = parseCsv(csv);
      for (const column of file.header) expect(column, `${section}: ${column}`).not.toMatch(FORBIDDEN_HEADER);
      for (const secret of PLANTED) expect(csv, `${section} leaks ${secret}`).not.toContain(secret);
      expect(csv, section).not.toMatch(/passwordHash|tokenVersion|bcrypt|\$2[aby]\$/);
    }
  });

  it('leaves no secret in the audit entry an export writes either', async () => {
    const w = await plant();
    for (const section of EXPORT_SECTIONS) await exportSection(w.sa, section, { ...FY, q: 'SECRET-LEAD-NOTE' }, meta);
    const entries = await AuditLog.find({ 'entity.type': 'export' }).lean();
    expect(entries).toHaveLength(EXPORT_SECTIONS.length);
    for (const e of entries) {
      expect(e.changes).toEqual([]);
      expect(JSON.stringify(e.summary)).not.toMatch(/passwordHash|bcrypt/);
    }
  });

  it('shows the money columns only where the section is money, and none for a viewer without the capability', async () => {
    const w = await makeExportWorld();
    const projects = parseCsv((await exportSection(without(w.sa, 'payment:view'), 'projects', {}, meta)).csv);
    expect(projects.header.join('|')).not.toMatch(/contract|amount|pricing|inr/i);
    // The money sections refuse a viewer without the money capability altogether: there is no money-free version of them.
    for (const [section, capability] of [['payments', 'payment:view'], ['third-party-payouts', 'payout:view'], ['work-orders', 'payout:view'], ['team-payouts', 'team:payView']] as const) {
      expect((await rejects(exportSection(without(w.sa, capability), section, {}, meta))).code, section).toBe('FORBIDDEN');
    }
    // Tasks, clients, work logs, enquiries and the audit log carry no money columns for anyone.
    for (const section of ['clients', 'tasks', 'work-logs', 'enquiries', 'audit'] as const) {
      const file = parseCsv((await exportSection(w.sa, section, { ...FY }, meta)).csv);
      // (A client's billing currency is a fact about the client, not a money column.)
      expect(file.header.filter((h) => h !== 'Billing currency').join('|'), section).not.toMatch(/amount|inr|currency|exchange|contract/i);
    }
  });
});
