import { afterEach, describe, expect, it } from 'vitest';
import { POST as convertRoute } from '@/app/api/admin/enquiries/[id]/convert/route';
import { ROLE_DEFAULTS, type Capability } from '@/config/capabilities';
import { Admin, AuditLog, Client, Lead, Project } from '@/models';
import { makeClient } from '@/test/domain-factories';
import { call, cookieFor, makeAdmin, makeSuperadmin } from '@/test/factories';
import { conversionFootprint, makeConvertibleLead } from '@/test/lead-conversion-factories';
import { setupTestDb } from '@/test/db';

setupTestDb();

const ADMIN_DEFAULTS = ROLE_DEFAULTS.admin;
/** A role that lacks these. The real auth path reads role defaults on every request, so this is end to end. */
const adminLacking = (...caps: Capability[]) => {
  ROLE_DEFAULTS.admin = ADMIN_DEFAULTS.filter((c) => !caps.includes(c));
};
afterEach(() => {
  ROLE_DEFAULTS.admin = ADMIN_DEFAULTS;
});

const convert = (id: string, body: unknown, cookie?: string, headers: Record<string, string> = {}) =>
  call(convertRoute, `/api/admin/enquiries/${id}/convert`, { method: 'POST', body, cookie, headers }, { id });
const portal = { name: 'Logistics portal', type: 'web_app' };

describe('POST /api/admin/enquiries/[id]/convert: access', () => {
  it('is 401 without a session and 403 from another site, writing nothing', async () => {
    const lead = await makeConvertibleLead();
    const id = String(lead._id);
    const before = await conversionFootprint(id);
    expect((await convert(id, { mode: 'new' })).status).toBe(401);
    const cookie = await cookieFor(await makeAdmin());
    expect((await convert(id, { mode: 'new' }, cookie, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(await conversionFootprint(id)).toEqual(before);
  });

  it('a removed admin cannot convert: the session is checked against the database', async () => {
    const admin = await makeAdmin();
    const cookie = await cookieFor(admin);
    const lead = await makeConvertibleLead();
    await Admin.updateOne({ _id: admin._id }, { $set: { status: 'deactivated' }, $inc: { tokenVersion: 1 } });
    expect((await convert(String(lead._id), { mode: 'new' }, cookie)).status).toBe(401);
  });

  it('is 403 without lead:edit, without client:edit, and for a project without project:edit, writing nothing each time', async () => {
    const cookie = await cookieFor(await makeAdmin());
    const lead = await makeConvertibleLead();
    const id = String(lead._id);
    const before = await conversionFootprint(id);

    for (const missing of ['lead:edit', 'client:edit'] as const) {
      adminLacking(missing);
      const res = await convert(id, { mode: 'new' }, cookie);
      expect(res.status, missing).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    adminLacking('project:edit');
    expect((await convert(id, { mode: 'new', project: portal }, cookie)).status).toBe(403);
    expect(await conversionFootprint(id)).toEqual(before);

    // without a project the missing project:edit does not matter
    expect((await convert(id, { mode: 'new' }, cookie)).status).toBe(201);
  });

  it('a superadmin converts without step-up', async () => {
    const cookie = await cookieFor(await makeSuperadmin());
    const lead = await makeConvertibleLead();
    expect((await convert(String(lead._id), { mode: 'new', project: portal }, cookie)).status).toBe(201);
  });
});

describe('POST /api/admin/enquiries/[id]/convert: converting', () => {
  it('creates the client and the draft project (201) and answers with both', async () => {
    const cookie = await cookieFor(await makeAdmin());
    const lead = await makeConvertibleLead();
    const res = await convert(String(lead._id), { mode: 'new', client: { name: 'Acme Logistics', kind: 'company', country: 'IN' }, project: portal }, cookie);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      ok: true,
      data: {
        conversion: {
          client: { id: expect.any(String), ref: 'CL-0001', name: 'Acme Logistics', created: true },
          project: { id: expect.any(String), ref: 'PRJ-0001', name: 'Logistics portal' },
        },
      },
    });
    const after = await Lead.findById(lead._id).lean();
    expect(after?.status).toBe('won');
    expect(String(after?.convertedClientId)).toBe(res.body.data.conversion.client.id);
    expect(String(after?.convertedProjectId)).toBe(res.body.data.conversion.project.id);
    const entry = await AuditLog.findOne({ action: 'lead.convert' }).lean();
    expect(entry?.ipHash).toEqual(expect.any(String)); // the request's hashed IP, never the address
    expect(JSON.stringify(res.body)).not.toMatch(/ipHash|messageHash|userAgent/);
  });

  it('links an existing client (200, nothing created) and refuses a second conversion (409)', async () => {
    const cookie = await cookieFor(await makeAdmin());
    const client = await makeClient({ name: 'Brightpath Learning' });
    const lead = await makeConvertibleLead();
    const id = String(lead._id);
    const res = await convert(id, { mode: 'existing', clientId: String(client._id) }, cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.conversion).toEqual({ client: { id: String(client._id), ref: client.ref, name: 'Brightpath Learning', created: false }, project: null });
    expect(await Client.countDocuments({})).toBe(1);

    const again = await convert(id, { mode: 'new', project: portal }, cookie);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CONFLICT');
    expect(await Client.countDocuments({})).toBe(1);
    expect(await Project.countDocuments({})).toBe(0);
  });

  it('refuses spam (409)', async () => {
    const cookie = await cookieFor(await makeAdmin());
    const lead = await makeConvertibleLead({ status: 'spam' });
    const before = await conversionFootprint(lead._id);
    expect((await convert(String(lead._id), { mode: 'new' }, cookie)).status).toBe(409);
    expect(await conversionFootprint(lead._id)).toEqual(before);
  });

  it('answers 404 for a malformed or unknown enquiry, and treats an uppercase id as the same enquiry', async () => {
    const cookie = await cookieFor(await makeAdmin());
    expect((await convert('not-an-id', { mode: 'new' }, cookie)).status).toBe(404);
    expect((await convert('5f3a5f3a5f3a5f3a5f3a5f3a', { mode: 'new' }, cookie)).status).toBe(404);
    const lead = await makeConvertibleLead();
    expect((await convert(String(lead._id).toUpperCase(), { mode: 'new' }, cookie)).status).toBe(201);
  });

  it('puts server-side problems on the form\'s own fields: a taken name, an archived client, a currency that is off', async () => {
    const cookie = await cookieFor(await makeAdmin());
    await makeClient({ name: 'Acme Logistics' });
    const archived = await makeClient({ name: 'Old Client', archivedAt: new Date() });
    const lead = await makeConvertibleLead();
    const id = String(lead._id);
    const before = await conversionFootprint(id);

    const taken = await convert(id, { mode: 'new', project: portal }, cookie);
    expect(taken.status).toBe(409);
    expect(taken.body.error.fields).toEqual({ 'client.name': 'A client with this name already exists' });

    const gone = await convert(id, { mode: 'existing', clientId: String(archived._id) }, cookie);
    expect(gone.status).toBe(422);
    expect(Object.keys(gone.body.error.fields)).toEqual(['clientId']);

    const money = await convert(id, { mode: 'new', client: { name: 'Fresh Client', kind: 'company', billingCurrency: 'JPY' } }, cookie);
    expect(money.status).toBe(422);
    expect(Object.keys(money.body.error.fields)).toEqual(['client.billingCurrency']);

    expect(await conversionFootprint(id)).toEqual(before);
  });
});

describe('POST /api/admin/enquiries/[id]/convert: the body', () => {
  it('is 422 with field messages for a bad mode, id, name or project, and writes nothing', async () => {
    const cookie = await cookieFor(await makeAdmin());
    const lead = await makeConvertibleLead();
    const id = String(lead._id);
    const before = await conversionFootprint(id);

    expect(Object.keys((await convert(id, {}, cookie)).body.error.fields)).toEqual(['mode']);
    expect(Object.keys((await convert(id, { mode: 'merge' }, cookie)).body.error.fields)).toEqual(['mode']);
    expect((await convert(id, { mode: 'existing' }, cookie)).body.error.fields).toEqual({ clientId: 'Pick a client' });
    expect((await convert(id, { mode: 'existing', clientId: 'x' }, cookie)).status).toBe(422);
    const bad = await convert(id, { mode: 'new', client: { name: 'A' }, project: { name: 'P', type: 'rocket' } }, cookie);
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['client.name', 'project.name', 'project.type']);
    expect((await convert(id, 'not an object', cookie)).status).toBe(422);
    expect(await conversionFootprint(id)).toEqual(before);
  });

  it('is strict: nothing off the allow-list gets through (status, owner, money, ids, the other mode\'s fields)', async () => {
    const cookie = await cookieFor(await makeAdmin());
    const lead = await makeConvertibleLead();
    const id = String(lead._id);
    const other = '5f3a5f3a5f3a5f3a5f3a5f3a';
    const extras: unknown[] = [
      { mode: 'new', status: 'won' },
      { mode: 'new', convertedClientId: other },
      { mode: 'new', clientId: other },
      { mode: 'new', client: { name: 'Acme', status: 'active' } },
      { mode: 'new', client: { name: 'Acme', isInternal: true } },
      { mode: 'new', client: { name: 'Acme', accountOwnerId: other } },
      { mode: 'new', project: { ...portal, status: 'active' } },
      { mode: 'new', project: { ...portal, contract: { pricingModel: 'fixed', amountMinor: 1, currency: 'INR' } } },
      { mode: 'new', project: { ...portal, clientId: other } },
      { mode: 'existing', clientId: other, client: { name: 'Acme' } },
    ];
    for (const body of extras) expect((await convert(id, body, cookie)).status, JSON.stringify(body)).toBe(422);
    expect(await Client.countDocuments({})).toBe(0);
    expect((await Lead.findById(id).lean())?.status).toBe('new');
  });
});
