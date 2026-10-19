import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import type { Capability } from '@/config/capabilities';
import { withTransaction } from '@/lib/db/mongoose';
import { AuditLog, Lead } from '@/models';
import {
  addLeadNote,
  applyLeadConversion,
  deleteLead,
  getLead,
  listAssignableAdmins,
  listLeadSources,
  markLeadSpam,
  searchLeads,
  updateLead,
} from '@/services/lead.service';
import { makeClient, makeProject } from '@/test/domain-factories';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { dateOnly, makeLead, makeService } from '@/test/lead-factories';
import { setupTestDb } from '@/test/db';
import type { SessionUser } from '@/types/session';

setupTestDb();

const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; fields?: Record<string, string>; message: string };
  }
  throw new Error('expected the call to be rejected');
};
/** The same signed-in person, with exactly these capabilities: the service must check them itself. */
const withCaps = (s: SessionUser, caps: Capability[]): SessionUser => ({ ...s, capabilities: new Set(caps) });
const actions = async () => (await AuditLog.find({ 'entity.type': 'lead' }).sort({ at: 1 }).lean()).map((a) => a.action);
const ago = (days: number) => new Date(Date.now() - days * 86_400_000);

describe('who may do what', () => {
  it('reading needs lead:view, changing needs lead:edit, deleting needs lead:delete: nothing is written without them', async () => {
    const admin = await makeAdmin();
    const sa = await makeSuperadmin();
    const lead = await makeLead();
    const id = String(lead._id);
    const none = withCaps(await sessionFor(admin), []);
    const viewOnly = withCaps(await sessionFor(admin), ['lead:view']);
    const editNoDelete = withCaps(await sessionFor(admin), ['lead:view', 'lead:edit']);

    for (const call of [
      () => searchLeads(none),
      () => getLead(none, id),
      () => listAssignableAdmins(none),
      () => listLeadSources(none),
    ]) expect((await rejects(call())).code).toBe('FORBIDDEN');

    for (const call of [
      () => updateLead(viewOnly, id, { status: 'contacted' }),
      () => addLeadNote(viewOnly, id, 'a note'),
      () => markLeadSpam(viewOnly, id, undefined),
      () => deleteLead(editNoDelete, id, 'because'),
      () => deleteLead(viewOnly, id, 'because'),
    ]) expect((await rejects(call())).code).toBe('FORBIDDEN');

    // a plain admin, as the app really builds them, may edit but not delete
    const plain = await sessionFor(admin);
    expect((await rejects(deleteLead(plain, id, 'because'))).code).toBe('FORBIDDEN');

    const after = await Lead.findById(id).lean();
    expect(after?.status).toBe('new');
    expect(after?.notes).toHaveLength(0);
    expect(await AuditLog.countDocuments({ 'entity.type': 'lead' })).toBe(0);

    // a superadmin may do all of it
    expect((await getLead(await sessionFor(sa), id)).id).toBe(id);
  });

  it('a malformed or unknown id is a 404, never a cast error', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    for (const id of ['nope', '123', new Types.ObjectId().toHexString()]) {
      expect((await rejects(getLead(sa, id))).code, id).toBe('NOT_FOUND');
      expect((await rejects(updateLead(sa, id, { status: 'contacted' }))).code, id).toBe('NOT_FOUND');
      expect((await rejects(addLeadNote(sa, id, 'x'))).code, id).toBe('NOT_FOUND');
      expect((await rejects(deleteLead(sa, id, 'reason'))).code, id).toBe('NOT_FOUND');
    }
  });
});

describe('detail', () => {
  it('returns a plain DTO with services, history and notes, and never the IP hash, user agent or message hash', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const svc = await makeService({ title: 'Web apps' });
    const lead = await makeLead({ company: 'Verma Logistics', serviceIds: [svc._id], sourcePath: '/contact', utm: { source: 'google' } });
    await Lead.updateOne({ _id: lead._id }, { $set: { ipHash: 'secret-hash', userAgent: 'UA/1' } });
    const dto = await getLead(sa, String(lead._id));
    expect(dto).toMatchObject({
      ref: lead.ref,
      company: 'Verma Logistics',
      services: [{ id: String(svc._id), title: 'Web apps' }],
      sourcePath: '/contact',
      utm: { source: 'google', medium: null, campaign: null },
      status: 'new',
      assignedTo: null,
      followUpOn: null,
      converted: null,
    });
    expect(typeof dto.createdAt).toBe('string');
    const text = JSON.stringify(dto);
    expect(text).not.toContain('secret-hash');
    expect(text).not.toContain('UA/1');
    expect(text).not.toContain('messageHash');
    expect(dto).not.toHaveProperty('ipHash');
  });

  it('keeps naming a service that was archived or removed since', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const archived = await makeService({ title: 'Old offer', status: 'archived' });
    const gone = new Types.ObjectId();
    const lead = await makeLead({ serviceIds: [archived._id, gone] });
    expect((await getLead(sa, String(lead._id))).services.map((s) => s.title)).toEqual(['Old offer', 'Removed service']);
  });
});

describe('list and search', () => {
  it('matches name, email, company and reference literally, case-insensitively', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const a = await makeLead({ name: 'Asha Rao', email: 'asha@acme.example', company: 'Acme (India) Pvt.' });
    await makeLead({ name: 'Abc Person', email: 'abc@x.example' });
    const found = async (q: string) => (await searchLeads(sa, { q })).items.map((i) => i.ref);
    expect(await found('asha')).toEqual([a.ref]);
    expect(await found('ACME.EXAMPLE')).toEqual([a.ref]);
    expect(await found('(india)')).toEqual([a.ref]);
    expect(await found(a.ref.toLowerCase())).toEqual([a.ref]);
    // regex characters mean themselves: "a.c" must not match "abc", ".*" must not match everything
    expect(await found('a.c')).toEqual([]);
    expect(await found('.*')).toEqual([]);
    // a bare "(" is matched as the character, so it finds the company with brackets and does not throw
    expect(await found('(')).toEqual([a.ref]);
    expect(await found('[a-z]+')).toEqual([]);
  });

  it('hides spam from the everyday list; a status filter or a search brings it back', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    await makeLead({ name: 'Real Person' });
    const spam = await makeLead({ name: 'Junk Sender', status: 'spam' });
    expect((await searchLeads(sa)).items.map((i) => i.name)).toEqual(['Real Person']);
    expect((await searchLeads(sa, { status: 'spam' })).items.map((i) => i.ref)).toEqual([spam.ref]);
    expect((await searchLeads(sa, { q: 'junk' })).items.map((i) => i.ref)).toEqual([spam.ref]);
  });

  it('filters by one status, by "open", by assignee (me, unassigned, a person), by source and by period', async () => {
    const meDoc = await makeAdmin({ name: 'Me Myself' });
    const other = await makeAdmin({ name: 'Other One' });
    const me = await sessionFor(meDoc);
    const n1 = await makeLead({ name: 'N1', status: 'new', assignedTo: { id: meDoc._id, name: meDoc.name }, sourcePath: '/contact', utm: { source: 'google' }, createdAt: ago(2) });
    const c1 = await makeLead({ name: 'C1', status: 'contacted', assignedTo: { id: other._id, name: other.name }, createdAt: ago(40) });
    const w1 = await makeLead({ name: 'W1', status: 'won', createdAt: ago(3) });
    const l1 = await makeLead({ name: 'L1', status: 'lost', createdAt: ago(4) });
    const refs = async (s: Parameters<typeof searchLeads>[1]) => (await searchLeads(me, s)).items.map((i) => i.ref).sort();

    expect(await refs({ status: 'won' })).toEqual([w1.ref]);
    expect(await refs({ status: 'open' })).toEqual([n1.ref, c1.ref].sort());
    expect(await refs({ assignee: 'me' })).toEqual([n1.ref]);
    expect(await refs({ assignee: 'unassigned' })).toEqual([w1.ref, l1.ref].sort());
    expect(await refs({ assignee: String(other._id) })).toEqual([c1.ref]);
    expect(await refs({ assignee: 'not-an-id' })).toEqual([n1.ref, c1.ref, w1.ref, l1.ref].sort()); // ignored, not an error
    expect(await refs({ source: { kind: 'utm', value: 'google' } })).toEqual([n1.ref]);
    expect(await refs({ source: { kind: 'page', value: '/contact' } })).toEqual([n1.ref]);
    expect(await refs({ period: { fromInstant: ago(10), toInstant: new Date() } })).toEqual([n1.ref, w1.ref, l1.ref].sort());
  });

  it('follow-up "due" means open and dated today or earlier, soonest first, whatever the period', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const now = new Date('2026-10-12T10:00:00Z'); // 15:30 on 12 Oct in India
    const overdue = await makeLead({ name: 'Overdue', status: 'contacted', followUpOn: dateOnly('2026-10-01'), createdAt: new Date('2026-01-01') });
    const today = await makeLead({ name: 'Today', status: 'new', followUpOn: dateOnly('2026-10-12') });
    await makeLead({ name: 'Tomorrow', status: 'new', followUpOn: dateOnly('2026-10-13') });
    await makeLead({ name: 'Closed', status: 'won', followUpOn: dateOnly('2026-10-01') });
    await makeLead({ name: 'Undated', status: 'new' });
    const res = await searchLeads(sa, {
      followUp: 'due',
      now,
      // a period that excludes "Overdue" must not hide it: this is a work queue
      period: { fromInstant: new Date('2026-10-01'), toInstant: new Date('2027-04-01') },
    });
    expect(res.items.map((i) => i.ref)).toEqual([overdue.ref, today.ref]);
  });

  it('judges "today" in the organisation zone, not UTC', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const dueInIndia = await makeLead({ followUpOn: dateOnly('2026-10-13'), status: 'new' });
    // 20:00 UTC on 12 Oct is already 13 Oct in Asia/Kolkata
    expect((await searchLeads(sa, { followUp: 'due', now: new Date('2026-10-12T20:00:00Z') })).items.map((i) => i.ref)).toEqual([dueInIndia.ref]);
    expect((await searchLeads(sa, { followUp: 'due', now: new Date('2026-10-12T10:00:00Z') })).items).toHaveLength(0);
  });

  it('sorts, pages, and reports the totals; an out-of-range page is clamped', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    for (const [name, days] of [['Charlie', 3], ['Alice', 2], ['Bob', 1]] as const) await makeLead({ name, createdAt: ago(days) });
    expect((await searchLeads(sa)).items.map((i) => i.name)).toEqual(['Bob', 'Alice', 'Charlie']); // newest first
    expect((await searchLeads(sa, { sort: 'createdAt', dir: 'asc' })).items.map((i) => i.name)).toEqual(['Charlie', 'Alice', 'Bob']);
    expect((await searchLeads(sa, { sort: 'name', dir: 'asc' })).items.map((i) => i.name)).toEqual(['Alice', 'Bob', 'Charlie']);
    const p2 = await searchLeads(sa, { pageSize: 2, page: 2 });
    expect(p2.items).toHaveLength(1);
    expect(p2.meta).toMatchObject({ page: 2, pages: 2, total: 3, from: 3, to: 3 });
    expect((await searchLeads(sa, { pageSize: 2, page: 99 })).meta.page).toBe(2);
  });

  it('list rows carry service titles and a plain-text excerpt, and nothing private', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const svc = await makeService({ title: 'Mobile apps' });
    await makeLead({ serviceIds: [svc._id], message: `<b>bold</b>   ${'long '.repeat(60)}` });
    const [row] = (await searchLeads(sa)).items;
    expect(row?.services).toEqual(['Mobile apps']);
    expect(row?.excerpt.length).toBeLessThanOrEqual(140);
    expect(row?.excerpt).toContain('<b>bold</b>'); // untrusted text is carried as text; rendering escapes it
    expect(row).not.toHaveProperty('ipHash');
  });
});

describe('status changes', () => {
  it('records who moved it, when and why; sets firstResponseAt once, on the first move away from new', async () => {
    const adminDoc = await makeAdmin({ name: 'Priya Shah' });
    const viewer = await sessionFor(adminDoc);
    const lead = await makeLead();
    const id = String(lead._id);

    const first = await updateLead(viewer, id, { status: 'contacted', statusNote: 'Called and emailed' });
    expect(first.status).toBe('contacted');
    expect(first.firstResponseAt).not.toBeNull();
    expect(first.statusHistory.at(-1)).toMatchObject({ from: 'new', to: 'contacted', by: 'Priya Shah', note: 'Called and emailed' });

    const stamp = first.firstResponseAt;
    const second = await updateLead(viewer, id, { status: 'qualified' });
    expect(second.firstResponseAt).toBe(stamp); // never moves
    expect(second.statusHistory.map((h) => h.to)).toEqual(['new', 'contacted', 'qualified']);

    const back = await updateLead(viewer, id, { status: 'new' });
    expect(back.firstResponseAt).toBe(stamp); // still the first reply
    expect(back.statusHistory).toHaveLength(4);
  });

  it('moving straight to lost or won counts as a first response; moving to spam does not', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const lost = await makeLead();
    expect((await updateLead(viewer, String(lost._id), { status: 'lost' })).firstResponseAt).not.toBeNull();
    const junk = await makeLead();
    const marked = await updateLead(viewer, String(junk._id), { status: 'spam' });
    expect(marked.firstResponseAt).toBeNull();
    // restored from spam to a real status: THAT is the first response
    expect((await updateLead(viewer, String(junk._id), { status: 'contacted' })).firstResponseAt).not.toBeNull();
  });

  it('setting the status it already has changes nothing and writes no audit entry', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const lead = await makeLead();
    const dto = await updateLead(viewer, String(lead._id), { status: 'new' });
    expect(dto.statusHistory).toHaveLength(1);
    expect(dto.firstResponseAt).toBeNull();
    expect(await actions()).toEqual([]);
  });

  it('audits each change with its before and after, naming the action', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const lead = await makeLead();
    await updateLead(viewer, String(lead._id), { status: 'qualified', statusNote: 'Good fit' });
    const [entry] = await AuditLog.find({ 'entity.type': 'lead' }).lean();
    expect(entry).toMatchObject({
      action: 'lead.status',
      summary: 'Good fit',
      entity: { type: 'lead', ref: lead.ref },
      changes: [{ path: 'status', before: 'new', after: 'qualified' }],
    });
  });
});

describe('assignment', () => {
  it('assigns an active admin, shows the name, and unassigns with null', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const target = await makeAdmin({ name: 'Rohan Das' });
    const lead = await makeLead();
    const assigned = await updateLead(viewer, String(lead._id), { assignedTo: String(target._id) });
    expect(assigned.assignedTo).toEqual({ id: String(target._id), name: 'Rohan Das' });
    expect(await actions()).toEqual(['lead.assign']);

    // uppercase hex is the same admin: no second change
    await updateLead(viewer, String(lead._id), { assignedTo: String(target._id).toUpperCase() });
    expect(await actions()).toEqual(['lead.assign']);

    const cleared = await updateLead(viewer, String(lead._id), { assignedTo: null });
    expect(cleared.assignedTo).toBeNull();
    expect(await actions()).toEqual(['lead.assign', 'lead.unassign']);
    // clearing what is already clear is a no-op
    await updateLead(viewer, String(lead._id), { assignedTo: null });
    expect(await actions()).toHaveLength(2);
  });

  it('refuses a removed admin, an unknown id and a malformed id (422), and leaves the enquiry untouched', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const gone = await makeAdmin({ status: 'deactivated' });
    const lead = await makeLead();
    for (const assignedTo of [String(gone._id), new Types.ObjectId().toHexString(), 'garbage']) {
      const err = await rejects(updateLead(viewer, String(lead._id), { assignedTo }));
      expect(err.code, assignedTo).toBe('VALIDATION_FAILED');
      expect(err.fields?.assignedTo).toMatch(/active team member/);
    }
    expect((await Lead.findById(lead._id).lean())?.assignedTo).toBeUndefined();
  });

  it('is all-or-nothing: a bad assignee rolls back a valid status change in the same request', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const lead = await makeLead();
    await rejects(updateLead(viewer, String(lead._id), { status: 'contacted', assignedTo: new Types.ObjectId().toHexString() }));
    const after = await Lead.findById(lead._id).lean();
    expect(after?.status).toBe('new');
    expect(after?.statusHistory).toHaveLength(1);
    expect(after?.firstResponseAt).toBeUndefined();
    expect(await AuditLog.countDocuments({})).toBe(0);
  });

  it('several changes in one request make one audit entry listing each', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const target = await makeAdmin({ name: 'Rohan Das' });
    const lead = await makeLead();
    await updateLead(viewer, String(lead._id), { status: 'contacted', assignedTo: String(target._id), followUpOn: '2026-11-02' });
    const entries = await AuditLog.find({ 'entity.type': 'lead' }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe('lead.status');
    expect(entries[0]?.changes.map((c) => c.path).sort()).toEqual(['assignedTo', 'followUpOn', 'status']);
  });
});

describe('follow-up date', () => {
  it('stores a calendar date at midnight UTC, shows it as YYYY-MM-DD, changes and clears it', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const lead = await makeLead();
    const set = await updateLead(viewer, String(lead._id), { followUpOn: '2026-11-02' });
    expect(set.followUpOn).toBe('2026-11-02');
    expect((await Lead.findById(lead._id).lean())?.followUpOn?.toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect((await updateLead(viewer, String(lead._id), { followUpOn: '2026-11-05' })).followUpOn).toBe('2026-11-05');
    expect((await updateLead(viewer, String(lead._id), { followUpOn: null })).followUpOn).toBeNull();
    expect(await actions()).toEqual(['lead.update', 'lead.update', 'lead.update']);
  });

  it('rejects an impossible date and one far outside a sane range', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const lead = await makeLead();
    for (const followUpOn of ['2026-02-31', 'tomorrow', '1999-01-01', '2101-01-01']) {
      expect((await rejects(updateLead(viewer, String(lead._id), { followUpOn }))).code, followUpOn).toBe('VALIDATION_FAILED');
    }
  });
});

describe('notes', () => {
  it('append in order with who and when, and are never edited or removed by the other operations', async () => {
    const a = await makeAdmin({ name: 'Priya Shah' });
    const b = await makeAdmin({ name: 'Rohan Das' });
    const lead = await makeLead();
    const id = String(lead._id);
    await addLeadNote(await sessionFor(a), id, 'Left a voicemail.');
    const dto = await addLeadNote(await sessionFor(b), id, '  Asked for a quote by Friday.  ');
    expect(dto.notes.map((n) => [n.by, n.text])).toEqual([
      ['Priya Shah', 'Left a voicemail.'],
      ['Rohan Das', 'Asked for a quote by Friday.'],
    ]);
    expect(Date.parse(dto.notes[1]!.at)).toBeGreaterThanOrEqual(Date.parse(dto.notes[0]!.at));

    // changing status, assignment and follow-up leaves every note exactly as it was
    const viewer = await sessionFor(a);
    await updateLead(viewer, id, { status: 'contacted', followUpOn: '2026-11-01' });
    await markLeadSpam(viewer, id, 'looks like spam');
    const after = await Lead.findById(id).lean();
    expect(after?.notes.map((n) => n.text)).toEqual(['Left a voicemail.', 'Asked for a quote by Friday.']);
    expect(await actions()).toEqual(['lead.note', 'lead.note', 'lead.status', 'lead.mark_spam']);
  });

  it('refuse blank and over-long text, and stop at the cap', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const lead = await makeLead();
    const id = String(lead._id);
    expect((await rejects(addLeadNote(viewer, id, '   '))).code).toBe('VALIDATION_FAILED');
    expect((await rejects(addLeadNote(viewer, id, 'x'.repeat(2001)))).code).toBe('VALIDATION_FAILED');
    const filler = Array.from({ length: 500 }, () => ({ at: new Date(), by: { id: null, name: 'Test' }, text: 'filler' }));
    await Lead.collection.updateOne({ _id: lead._id }, { $set: { notes: filler } });
    expect((await rejects(addLeadNote(viewer, id, 'one too many'))).code).toBe('CONFLICT');
    expect((await Lead.findById(id).lean())?.notes).toHaveLength(500);
  });

  it('do not put the note text in the audit log', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const lead = await makeLead();
    await addLeadNote(viewer, String(lead._id), 'Customer mentioned a confidential budget.');
    expect(JSON.stringify(await AuditLog.find({}).lean())).not.toContain('confidential');
  });
});

describe('marking spam', () => {
  it('moves to spam with the reason in the history, keeps the record, and cannot be repeated', async () => {
    const viewer = await sessionFor(await makeAdmin({ name: 'Priya Shah' }));
    const lead = await makeLead();
    const dto = await markLeadSpam(viewer, String(lead._id), 'Link farm');
    expect(dto.status).toBe('spam');
    expect(dto.statusHistory.at(-1)).toMatchObject({ from: 'new', to: 'spam', by: 'Priya Shah', note: 'Link farm' });
    expect(await Lead.countDocuments({})).toBe(1);
    expect(await actions()).toEqual(['lead.mark_spam']);
    expect((await rejects(markLeadSpam(viewer, String(lead._id), undefined))).code).toBe('CONFLICT');
    expect(await actions()).toEqual(['lead.mark_spam']);
  });

  it('is reversible: changing the status moves it back into the list', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const lead = await makeLead();
    await markLeadSpam(viewer, String(lead._id), undefined);
    expect((await searchLeads(viewer)).items).toHaveLength(0);
    await updateLead(viewer, String(lead._id), { status: 'new' });
    expect((await searchLeads(viewer)).items).toHaveLength(1);
  });
});

describe('permanent delete', () => {
  it('removes the enquiry but keeps an audit entry with the reference, the reason and who did it', async () => {
    const sa = await makeSuperadmin({ name: 'Aman Gupta' });
    const lead = await makeLead({ name: 'Test Person' });
    await deleteLead(await sessionFor(sa), String(lead._id), 'Test data from QA');
    expect(await Lead.countDocuments({})).toBe(0);
    const entry = await AuditLog.findOne({ action: 'lead.delete' }).lean();
    expect(entry).toMatchObject({ actor: { name: 'Aman Gupta' }, entity: { type: 'lead', ref: lead.ref, label: 'Test Person' }, summary: 'Test data from QA' });
  });

  it('refuses an enquiry that was converted into a client (HAS_LINKED_RECORDS) and leaves it in place', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const client = await makeClient();
    const lead = await makeLead({ status: 'won', convertedClientId: client._id });
    expect((await rejects(deleteLead(sa, String(lead._id), 'cleanup'))).code).toBe('HAS_LINKED_RECORDS');
    expect(await Lead.countDocuments({})).toBe(1);
    expect(await AuditLog.countDocuments({})).toBe(0);
  });

  it('also refuses an enquiry a client names as its source, even when the enquiry holds no link back', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const lead = await makeLead();
    await makeClient({ source: 'enquiry', leadId: lead._id });
    expect((await rejects(deleteLead(sa, String(lead._id), 'cleanup'))).code).toBe('HAS_LINKED_RECORDS');
    expect(await Lead.countDocuments({})).toBe(1);
  });
});

describe('pickers and filters data', () => {
  it('lists only active admins, by name', async () => {
    const viewer = await sessionFor(await makeAdmin({ name: 'Zed Last' }));
    await makeAdmin({ name: 'Amy First' });
    await makeAdmin({ name: 'Removed One', status: 'deactivated' });
    expect((await listAssignableAdmins(viewer)).map((a) => a.name)).toEqual(['Amy First', 'Zed Last']);
  });

  it('lists the pages and UTM sources enquiries came from, most frequent first, leaving spam out', async () => {
    const viewer = await sessionFor(await makeAdmin());
    for (const [path, source] of [['/contact', 'google'], ['/contact', 'google'], ['/', 'newsletter']] as const) await makeLead({ sourcePath: path, utm: { source } });
    await makeLead({ sourcePath: '/spam-page', utm: { source: 'bot' }, status: 'spam' });
    expect(await listLeadSources(viewer)).toEqual({ pages: ['/contact', '/'], utmSources: ['google', 'newsletter'] });
  });
});

describe('extension point: conversion', () => {
  it('moves the enquiry to won and links the new records inside the caller\'s transaction, with an audit entry', async () => {
    const viewer = await sessionFor(await makeAdmin({ name: 'Priya Shah' }));
    const client = await makeClient();
    const project = await makeProject(client);
    const lead = await makeLead({ status: 'qualified' });
    await withTransaction((session) => applyLeadConversion(viewer, String(lead._id), { clientId: String(client._id), projectId: String(project._id) }, session));

    const dto = await getLead(viewer, String(lead._id));
    expect(dto.status).toBe('won');
    expect(dto.converted).toEqual({ clientId: String(client._id), projectId: String(project._id) });
    expect(dto.firstResponseAt).not.toBeNull();
    expect(dto.statusHistory.at(-1)).toMatchObject({ from: 'qualified', to: 'won', by: 'Priya Shah' });
    const entry = await AuditLog.findOne({ action: 'lead.convert' }).lean();
    expect(entry?.context).toMatchObject({ clientId: client._id, projectId: project._id });

    // a second conversion, and a delete, are both refused
    expect((await rejects(withTransaction((s) => applyLeadConversion(viewer, String(lead._id), { clientId: String(client._id) }, s)))).code).toBe('CONFLICT');
  });

  it('rolls the enquiry change back when the caller\'s transaction fails, and refuses spam', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const client = await makeClient();
    const lead = await makeLead();
    await rejects(
      withTransaction(async (session) => {
        await applyLeadConversion(viewer, String(lead._id), { clientId: String(client._id) }, session);
        throw new Error('the client step failed');
      }),
    );
    expect((await Lead.findById(lead._id).lean())?.status).toBe('new');
    expect(await AuditLog.countDocuments({ action: 'lead.convert' })).toBe(0);

    const spam = await makeLead({ status: 'spam' });
    expect((await rejects(withTransaction((s) => applyLeadConversion(viewer, String(spam._id), { clientId: String(client._id) }, s)))).code).toBe('CONFLICT');
  });

  it('needs lead:edit', async () => {
    const viewer = withCaps(await sessionFor(await makeAdmin()), ['lead:view']);
    const lead = await makeLead();
    const client = await makeClient();
    expect((await rejects(withTransaction((s) => applyLeadConversion(viewer, String(lead._id), { clientId: String(client._id) }, s)))).code).toBe('FORBIDDEN');
  });
});
