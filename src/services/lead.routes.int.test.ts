import { describe, expect, it } from 'vitest';
import { DELETE as deleteRoute, PATCH as patchRoute } from '@/app/api/admin/enquiries/[id]/route';
import { POST as notesRoute } from '@/app/api/admin/enquiries/[id]/notes/route';
import { POST as spamRoute } from '@/app/api/admin/enquiries/[id]/spam/route';
import { Admin, AuditLog, Lead } from '@/models';
import { makeClient } from '@/test/domain-factories';
import { call, cookieFor, makeAdmin, makeSuperadmin } from '@/test/factories';
import { makeLead } from '@/test/lead-factories';
import { setupTestDb } from '@/test/db';

setupTestDb();

const base = (id: string) => `/api/admin/enquiries/${id}`;
const patch = (id: string, body: unknown, cookie?: string, extra: Record<string, string> = {}) =>
  call(patchRoute, base(id), { method: 'PATCH', body, cookie, headers: extra }, { id });
const note = (id: string, body: unknown, cookie?: string) => call(notesRoute, `${base(id)}/notes`, { method: 'POST', body, cookie }, { id });
const spam = (id: string, body: unknown, cookie?: string) => call(spamRoute, `${base(id)}/spam`, { method: 'POST', body, cookie }, { id });
const remove = (id: string, body: unknown, cookie?: string) => call(deleteRoute, base(id), { method: 'DELETE', body, cookie }, { id });

describe('enquiry routes: authentication and capabilities', () => {
  it('every route is 401 without a session, and writes nothing', async () => {
    const lead = await makeLead();
    const id = String(lead._id);
    expect((await patch(id, { status: 'contacted' })).status).toBe(401);
    expect((await note(id, { text: 'hello' })).status).toBe(401);
    expect((await spam(id, {})).status).toBe(401);
    expect((await remove(id, { reason: 'because' })).status).toBe(401);
    const after = await Lead.findById(id).lean();
    expect(after?.status).toBe('new');
    expect(after?.notes).toHaveLength(0);
    expect(await AuditLog.countDocuments({})).toBe(0);
  });

  it('a removed admin cannot use them: the session is checked against the database each time', async () => {
    const admin = await makeAdmin();
    const cookie = await cookieFor(admin);
    const lead = await makeLead();
    await Admin.updateOne({ _id: admin._id }, { $set: { status: 'deactivated' }, $inc: { tokenVersion: 1 } });
    expect((await patch(String(lead._id), { status: 'contacted' }, cookie)).status).toBe(401);
  });

  it('a plain admin may edit (200) but permanent delete is superadmin-only (403), and nothing is deleted', async () => {
    const admin = await makeAdmin();
    const cookie = await cookieFor(admin);
    const lead = await makeLead();
    const id = String(lead._id);
    expect((await patch(id, { status: 'contacted' }, cookie)).status).toBe(200);
    expect((await note(id, { text: 'A note.' }, cookie)).status).toBe(201);
    expect((await spam(id, {}, cookie)).status).toBe(200);
    const denied = await remove(id, { reason: 'cleanup' }, cookie);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
    expect(await Lead.countDocuments({})).toBe(1);
  });

  it('a grant cannot unlock delete: lead:delete is never grantable, so even a granted admin gets 403', async () => {
    const admin = await makeAdmin({ grants: ['content:publish', 'export:data'] });
    const lead = await makeLead();
    expect((await remove(String(lead._id), { reason: 'cleanup' }, await cookieFor(admin))).status).toBe(403);
  });

  it('a superadmin deletes with a reason (200)', async () => {
    const sa = await makeSuperadmin();
    const lead = await makeLead();
    const res = await remove(String(lead._id), { reason: 'Duplicate test entry' }, await cookieFor(sa));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { deleted: true } });
    expect(await Lead.countDocuments({})).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'lead.delete' })).toBe(1);
  });

  it('refuses writes from another site', async () => {
    const cookie = await cookieFor(await makeAdmin());
    const lead = await makeLead();
    const res = await patch(String(lead._id), { status: 'contacted' }, cookie, { 'sec-fetch-site': 'cross-site' });
    expect(res.status).toBe(403);
    expect((await Lead.findById(lead._id).lean())?.status).toBe('new');
  });
});

describe('enquiry routes: PATCH', () => {
  it('changes status, assignee and follow-up, and answers with the new detail', async () => {
    const admin = await makeAdmin({ name: 'Priya Shah' });
    const target = await makeAdmin({ name: 'Rohan Das' });
    const cookie = await cookieFor(admin);
    const lead = await makeLead();
    const res = await patch(String(lead._id), { status: 'contacted', statusNote: 'Emailed', assignedTo: String(target._id), followUpOn: '2026-11-02' }, cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.enquiry).toMatchObject({
      status: 'contacted',
      assignedTo: { name: 'Rohan Das' },
      followUpOn: '2026-11-02',
    });
    expect(res.body.data.enquiry.firstResponseAt).toEqual(expect.any(String));
    expect(res.body.data.enquiry.statusHistory.at(-1)).toMatchObject({ by: 'Priya Shah', note: 'Emailed' });
    expect(JSON.stringify(res.body)).not.toMatch(/ipHash|messageHash|userAgent/);
  });

  it('validates the body: 422 with field messages for a bad status, id and date; unknown keys and empty bodies refused', async () => {
    const cookie = await cookieFor(await makeAdmin());
    const lead = await makeLead();
    const id = String(lead._id);
    const bad = await patch(id, { status: 'bogus', assignedTo: 'x', followUpOn: '2026-13-45' }, cookie);
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['assignedTo', 'followUpOn', 'status']);
    expect((await patch(id, {}, cookie)).status).toBe(422);
    // notes cannot be rewritten through PATCH, nor can anything else off the allow-list
    for (const extra of [{ notes: [] }, { ref: 'ENQ-9999' }, { message: 'edited' }, { email: 'x@y.com' }, { convertedClientId: '5f3a5f3a5f3a5f3a5f3a5f3a' }]) {
      expect((await patch(id, { status: 'contacted', ...extra }, cookie)).status, JSON.stringify(extra)).toBe(422);
    }
    expect((await Lead.findById(id).lean())?.status).toBe('new');
  });

  it('answers 422 for an assignee who has been removed, and 404 for a malformed or unknown enquiry id', async () => {
    const cookie = await cookieFor(await makeAdmin());
    const gone = await makeAdmin({ status: 'deactivated' });
    const lead = await makeLead();
    expect((await patch(String(lead._id), { assignedTo: String(gone._id) }, cookie)).status).toBe(422);
    expect((await patch('not-an-id', { status: 'contacted' }, cookie)).status).toBe(404);
    expect((await patch('5f3a5f3a5f3a5f3a5f3a5f3a', { status: 'contacted' }, cookie)).status).toBe(404);
  });

  it('treats an uppercase id in the URL as the same enquiry', async () => {
    const cookie = await cookieFor(await makeAdmin());
    const lead = await makeLead();
    const res = await patch(String(lead._id).toUpperCase(), { status: 'contacted' }, cookie);
    expect(res.status).toBe(200);
  });
});

describe('enquiry routes: notes, spam, delete', () => {
  it('POST notes appends (201), refuses empty and over-long text (422) and unknown keys', async () => {
    const cookie = await cookieFor(await makeAdmin({ name: 'Priya Shah' }));
    const lead = await makeLead();
    const id = String(lead._id);
    const res = await note(id, { text: 'Spoke to them. Wants a call on Monday.' }, cookie);
    expect(res.status).toBe(201);
    expect(res.body.data.enquiry.notes).toEqual([expect.objectContaining({ by: 'Priya Shah', text: 'Spoke to them. Wants a call on Monday.' })]);
    expect((await note(id, { text: '  ' }, cookie)).status).toBe(422);
    expect((await note(id, { text: 'x'.repeat(2001) }, cookie)).status).toBe(422);
    expect((await note(id, { text: 'ok', by: 'Someone Else' }, cookie)).status).toBe(422);
    expect((await Lead.findById(id).lean())?.notes).toHaveLength(1);
  });

  it('POST spam moves it to spam (200); a second call is 409', async () => {
    const cookie = await cookieFor(await makeAdmin());
    const lead = await makeLead();
    const id = String(lead._id);
    const first = await spam(id, { note: 'Link farm' }, cookie);
    expect(first.status).toBe(200);
    expect(first.body.data.enquiry.status).toBe('spam');
    const second = await spam(id, {}, cookie);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');
  });

  it('DELETE needs a reason (422), and refuses an enquiry converted into a client (409)', async () => {
    const sa = await makeSuperadmin();
    const cookie = await cookieFor(sa);
    const lead = await makeLead();
    expect((await remove(String(lead._id), {}, cookie)).status).toBe(422);
    expect((await remove(String(lead._id), { reason: 'ab' }, cookie)).status).toBe(422);
    const client = await makeClient();
    const converted = await makeLead({ status: 'won', convertedClientId: client._id });
    const res = await remove(String(converted._id), { reason: 'cleanup please' }, cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HAS_LINKED_RECORDS');
    expect(await Lead.countDocuments({})).toBe(2);
  });
});
