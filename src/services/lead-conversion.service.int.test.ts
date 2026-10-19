import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditLog, Client, Counter, Lead, Project } from '@/models';
import { getLead } from '@/services/lead.service';
import { convertLead } from '@/services/lead-conversion.service';
import { setSettings } from '@/test/settings-factories';
import { makeClient } from '@/test/domain-factories';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { conversionFootprint, makeConvertibleLead, withCaps } from '@/test/lead-conversion-factories';
import { makeLead } from '@/test/lead-factories';
import { setupTestDb } from '@/test/db';
import type { ConvertLeadInput } from '@/lib/validation/lead-conversion';

setupTestDb();
afterEach(() => vi.restoreAllMocks());

const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; message: string; fields?: Record<string, string> };
  }
  throw new Error('expected the call to be rejected');
};
const newClient = (o: Partial<Extract<ConvertLeadInput, { mode: 'new' }>> = {}): ConvertLeadInput => ({ mode: 'new', ...o });
const existing = (clientId: string, project?: { name: string; type: 'website' }): ConvertLeadInput => ({ mode: 'existing', clientId, project });
const portal = { name: 'Logistics portal', type: 'web_app' } as const;

describe('a new client and a draft project in one go', () => {
  it('creates both from the enquiry, marks it won and links all three', async () => {
    const viewer = await sessionFor(await makeAdmin({ name: 'Priya Shah' }));
    const lead = await makeConvertibleLead();
    const result = await convertLead(viewer, String(lead._id), newClient({ project: portal }));

    expect(result.client).toMatchObject({ ref: 'CL-0001', name: 'Acme Logistics', created: true });
    expect(result.project).toMatchObject({ ref: 'PRJ-0001', name: 'Logistics portal' });

    const client = await Client.findOne({ ref: 'CL-0001' }).lean();
    expect(client).toMatchObject({ name: 'Acme Logistics', kind: 'company', status: 'prospect', country: 'IN', source: 'enquiry', isInternal: false });
    expect(String(client?.leadId)).toBe(String(lead._id));
    expect(client?.createdBy?.name).toBe('Priya Shah');
    expect(client?.contacts).toEqual([expect.objectContaining({ name: 'Neha Verma', email: 'neha@acme-logistics.example', phone: '+91 98765 43210', isPrimary: true })]);

    const project = await Project.findOne({ ref: 'PRJ-0001' }).lean();
    expect(project).toMatchObject({ name: 'Logistics portal', type: 'web_app', status: 'proposal', clientName: 'Acme Logistics', scopeSummary: lead.message });
    expect(String(project?.clientId)).toBe(String(client?._id));
    expect(project?.agreed).toBeUndefined(); // a proposal has agreed nothing yet
    expect(project?.statusHistory).toHaveLength(1);

    const dto = await getLead(viewer, String(lead._id));
    expect(dto.status).toBe('won');
    expect(dto.converted).toEqual({ clientId: String(client?._id), projectId: String(project?._id) });
    expect(dto.firstResponseAt).not.toBeNull();
    expect(dto.statusHistory.at(-1)).toMatchObject({ from: 'new', to: 'won', by: 'Priya Shah' });
  });

  it('uses the person\'s edits over the prefill', async () => {
    await setSettings({ enabledCurrencies: ['INR', 'USD'] });
    const viewer = await sessionFor(await makeAdmin());
    const lead = await makeConvertibleLead();
    await convertLead(viewer, String(lead._id), newClient({ client: { name: 'Acme Logistics Pvt Ltd', kind: 'company', country: 'US', billingCurrency: 'USD' } }));
    expect(await Client.findOne({}).lean()).toMatchObject({ name: 'Acme Logistics Pvt Ltd', country: 'US', billingCurrency: 'USD' });
  });

  it('falls back to the prefill when the body leaves the client out, and names an individual after the person', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const lead = await makeLead({ name: 'Rohan Das', email: 'rohan@example.com', company: undefined, country: 'Narnia' });
    await convertLead(viewer, String(lead._id), newClient());
    const client = await Client.findOne({}).lean();
    expect(client).toMatchObject({ name: 'Rohan Das', kind: 'individual' });
    expect(client?.country).toBeUndefined(); // an unrecognised country is left for a person to fill in, not guessed
  });

  it('fills what the body leaves out of the client from the enquiry: a person with only a name given is still an individual', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const lead = await makeLead({ name: 'Rohan Das', email: 'rohan@example.com', company: undefined, country: 'Singapore' });
    await convertLead(viewer, String(lead._id), newClient({ client: { name: 'Rohan Das Studio' } }));
    expect(await Client.findOne({}).lean()).toMatchObject({ name: 'Rohan Das Studio', kind: 'individual', country: 'SG' });
  });

  it('keeps a phone number the contact cannot hold in the client notes', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const phone = '+91 (0) 98765-43210 ext. 12345678';
    const lead = await makeConvertibleLead({ phone });
    await convertLead(viewer, String(lead._id), newClient());
    const client = await Client.findOne({}).lean();
    expect(client?.contacts[0]?.phone).toBeUndefined();
    expect(client?.notes).toBe(`Phone from the enquiry: ${phone}`);
  });

  it('cuts a very long message to the project\'s scope limit; the enquiry keeps all of it', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const lead = await makeConvertibleLead({ message: 'x'.repeat(4600) });
    await convertLead(viewer, String(lead._id), newClient({ project: portal }));
    const project = await Project.findOne({}).lean();
    expect(project?.scopeSummary).toHaveLength(4000);
    expect((await Lead.findById(lead._id).lean())?.message).toHaveLength(4600);
  });

  it('converts an enquiry that was already lost, and one already moved to won by hand', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const lost = await makeConvertibleLead({ status: 'lost' });
    await convertLead(viewer, String(lost._id), newClient({ client: { name: 'First Client', kind: 'company', country: '' } }));
    expect((await getLead(viewer, String(lost._id))).statusHistory.at(-1)).toMatchObject({ from: 'lost', to: 'won' });

    const won = await makeConvertibleLead({ status: 'won' });
    await convertLead(viewer, String(won._id), newClient({ client: { name: 'Second Client', kind: 'company', country: '' } }));
    const dto = await getLead(viewer, String(won._id));
    expect(dto.converted).not.toBeNull();
    expect(dto.statusHistory.filter((h) => h.to === 'won')).toHaveLength(1); // no second "won" entry
  });
});

describe('an existing client', () => {
  it('links the enquiry and leaves the client\'s own record alone', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const client = await makeClient({ name: 'Brightpath Learning', contacts: [{ name: 'Riya', email: 'riya@brightpath.example', isPrimary: true }] });
    const lead = await makeConvertibleLead();
    const before = await Client.findById(client._id).lean();

    const result = await convertLead(viewer, String(lead._id), existing(String(client._id)));
    expect(result.client).toEqual({ id: String(client._id), ref: client.ref, name: 'Brightpath Learning', created: false });
    expect(result.project).toBeNull();
    expect(await Client.countDocuments({})).toBe(1);

    const after = await Client.findById(client._id).lean();
    expect(after).toMatchObject({ name: before?.name, status: before?.status });
    expect(after?.source).toBeUndefined();
    expect(after?.leadId).toBeUndefined();
    expect(after?.contacts).toEqual(before?.contacts);

    const dto = await getLead(viewer, String(lead._id));
    expect(dto.status).toBe('won');
    expect(dto.converted).toEqual({ clientId: String(client._id), projectId: null });
  });

  it('can start a draft project for that client', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const client = await makeClient({ name: 'Brightpath Learning' });
    const lead = await makeConvertibleLead();
    const result = await convertLead(viewer, String(lead._id), existing(String(client._id), { name: 'Brightpath site', type: 'website' }));
    expect(result.project).toMatchObject({ ref: 'PRJ-0001', name: 'Brightpath site' });
    expect(await Project.findOne({}).lean()).toMatchObject({ clientName: 'Brightpath Learning', status: 'proposal', type: 'website' });
    expect((await getLead(viewer, String(lead._id))).converted?.projectId).toEqual(result.project?.id);
  });

  it('refuses a client that is archived, the internal client, and one that does not exist, writing nothing', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const archived = await makeClient({ name: 'Old Client', archivedAt: new Date() });
    const internal = await makeClient({ name: 'ProDevly (internal)', isInternal: true });
    const lead = await makeConvertibleLead();
    const before = await conversionFootprint(lead._id);

    for (const id of [String(archived._id), String(internal._id), '5f3a5f3a5f3a5f3a5f3a5f3a']) {
      const err = await rejects(convertLead(viewer, String(lead._id), existing(id, { name: 'Anything', type: 'website' })));
      expect(err.code, id).toBe('VALIDATION_FAILED');
      expect(err.fields?.clientId, id).toBeDefined();
    }
    expect(await conversionFootprint(lead._id)).toEqual(before);
  });

  it('touches the linked client, so a concurrent archive conflicts with the link instead of both committing', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const client = await makeClient({ name: 'Racing Client' });
    const lead = await makeConvertibleLead();
    const before = (await Client.findById(client._id).lean())?.updatedAt.getTime() ?? 0;
    await new Promise((r) => setTimeout(r, 5));
    await convertLead(viewer, String(lead._id), existing(String(client._id)));
    expect((await Client.findById(client._id).lean())?.updatedAt.getTime()).toBeGreaterThan(before);
  });
});

describe('the audit trail', () => {
  it('writes one lead.convert entry that names the client and project, and the records keep their own entries', async () => {
    const viewer = await sessionFor(await makeAdmin({ name: 'Priya Shah' }));
    const lead = await makeConvertibleLead();
    const result = await convertLead(viewer, String(lead._id), newClient({ project: portal }), { ipHash: 'h', userAgent: 'ua', requestId: 'r1' });

    expect(await AuditLog.countDocuments({ action: 'lead.convert' })).toBe(1);
    const entry = await AuditLog.findOne({ action: 'lead.convert' }).lean();
    expect(entry?.summary).toBe('Created client CL-0001 (Acme Logistics), started draft project PRJ-0001 (Logistics portal)');
    expect(entry).toMatchObject({ actor: { name: 'Priya Shah' }, entity: { type: 'lead', ref: lead.ref }, ipHash: 'h', requestId: 'r1' });
    expect(String(entry?.context.clientId)).toBe(result.client.id);
    expect(String(entry?.context.projectId)).toBe(result.project?.id);
    expect(entry?.changes.map((c) => c.path)).toEqual(['status', 'convertedClientId', 'convertedProjectId']);

    const client = await AuditLog.findOne({ action: 'client.create' }).lean();
    expect(client?.summary).toBe('Created from an enquiry');
    const project = await AuditLog.findOne({ action: 'project.create' }).lean();
    expect(project?.summary).toBe(`Draft started from enquiry ${lead.ref}`);
    expect(await AuditLog.countDocuments({})).toBe(3);
  });

  it('says "linked to existing client" when no client was made, and leaves the project out when there is none', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const client = await makeClient({ name: 'Brightpath Learning' });
    const lead = await makeConvertibleLead();
    await convertLead(viewer, String(lead._id), existing(String(client._id)));
    const entry = await AuditLog.findOne({ action: 'lead.convert' }).lean();
    expect(entry?.summary).toBe(`Linked to existing client ${client.ref} (Brightpath Learning)`);
    expect(entry?.changes.map((c) => c.path)).toEqual(['status', 'convertedClientId']);
    expect(await AuditLog.countDocuments({})).toBe(1); // nothing else was created, so nothing else to audit
  });
});

describe('all or nothing', () => {
  it('leaves no client behind, the enquiry unchanged and the counters untouched when the project step fails', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const lead = await makeConvertibleLead();
    const before = await conversionFootprint(lead._id);
    vi.spyOn(Project, 'create').mockRejectedValueOnce(new Error('project down'));

    await rejects(convertLead(viewer, String(lead._id), newClient({ project: portal })));
    expect(await conversionFootprint(lead._id)).toEqual(before);
    // the references were never spent
    expect(await Counter.findById('client').lean()).toBeNull();
    expect(await Counter.findById('project').lean()).toBeNull();
    vi.restoreAllMocks();

    // so the next conversion is still CL-0001 and PRJ-0001
    const result = await convertLead(viewer, String(lead._id), newClient({ project: portal }));
    expect([result.client.ref, result.project?.ref]).toEqual(['CL-0001', 'PRJ-0001']);
  });

  it('rolls the client and project back when the conversion audit entry cannot be written', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const lead = await makeConvertibleLead();
    const before = await conversionFootprint(lead._id);
    const create = AuditLog.create.bind(AuditLog) as (...a: unknown[]) => Promise<unknown>;
    vi.spyOn(AuditLog, 'create').mockImplementation(((docs: Array<{ action?: string }>, options: unknown) =>
      docs[0]?.action === 'lead.convert' ? Promise.reject(new Error('audit down')) : create(docs, options)) as never);

    await rejects(convertLead(viewer, String(lead._id), newClient({ project: portal })));
    expect(await conversionFootprint(lead._id)).toEqual(before);
  });

  it('rolls back when the client step fails (the name is taken), and puts the problem on the name field', async () => {
    const viewer = await sessionFor(await makeAdmin());
    await makeClient({ name: 'Acme Logistics' });
    const lead = await makeConvertibleLead();
    const before = await conversionFootprint(lead._id);
    const err = await rejects(convertLead(viewer, String(lead._id), newClient({ project: portal })));
    expect(err.code).toBe('CONFLICT');
    expect(err.fields).toEqual({ 'client.name': 'A client with this name already exists' });
    expect(await conversionFootprint(lead._id)).toEqual(before);
  });

  it('refuses a billing currency that is not switched on, on the currency field', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const lead = await makeConvertibleLead();
    const err = await rejects(convertLead(viewer, String(lead._id), newClient({ client: { name: 'Acme', kind: 'company', country: '', billingCurrency: 'JPY' } })));
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields?.['client.billingCurrency']).toMatch(/Settings/);
    expect(await Client.countDocuments({})).toBe(0);
  });
});

describe('what cannot be converted', () => {
  it('refuses an enquiry that was already converted (409) and writes nothing more', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const lead = await makeConvertibleLead();
    await convertLead(viewer, String(lead._id), newClient({ project: portal }));
    const before = await conversionFootprint(lead._id);

    const again = await rejects(convertLead(viewer, String(lead._id), newClient({ client: { name: 'Another', kind: 'company', country: '' }, project: portal })));
    expect(again.code).toBe('CONFLICT');
    expect(again.message).toMatch(/already been converted/);
    const other = await makeClient({ name: 'Someone Else' });
    expect((await rejects(convertLead(viewer, String(lead._id), existing(String(other._id))))).code).toBe('CONFLICT');
    expect(await conversionFootprint(lead._id)).toEqual({ ...before, clients: before.clients + 1 }); // only the fixture above
  });

  it('lets exactly one of two simultaneous conversions win', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const lead = await makeConvertibleLead();
    const attempt = (name: string) => convertLead(viewer, String(lead._id), newClient({ client: { name, kind: 'company', country: '' }, project: portal }));
    const settled = await Promise.allSettled([attempt('Client A'), attempt('Client B')]);
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    const lost = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult;
    expect((lost.reason as { code?: string }).code).toBe('CONFLICT');
    expect(await Client.countDocuments({})).toBe(1);
    expect(await Project.countDocuments({})).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'lead.convert' })).toBe(1);
  });

  it('refuses spam, with nothing written', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const lead = await makeConvertibleLead({ status: 'spam' });
    const before = await conversionFootprint(lead._id);
    const err = await rejects(convertLead(viewer, String(lead._id), newClient({ project: portal })));
    expect(err.code).toBe('CONFLICT');
    expect(err.message).toMatch(/Spam/);
    expect(await conversionFootprint(lead._id)).toEqual(before);
  });

  it('answers not found for an unknown or malformed enquiry id', async () => {
    const viewer = await sessionFor(await makeAdmin());
    expect((await rejects(convertLead(viewer, '5f3a5f3a5f3a5f3a5f3a5f3a', newClient()))).code).toBe('NOT_FOUND');
    expect((await rejects(convertLead(viewer, 'nope', newClient()))).code).toBe('NOT_FOUND');
    expect(await Client.countDocuments({})).toBe(0);
  });
});

describe('who may convert', () => {
  const caps = ['lead:view', 'lead:edit', 'client:view', 'client:edit', 'project:view', 'project:edit'] as const;
  const without = (...drop: string[]) => caps.filter((c) => !drop.includes(c));

  it('lead:edit without client:edit is refused, in both modes, and nothing is written', async () => {
    const base = await sessionFor(await makeSuperadmin());
    const viewer = withCaps(base, without('client:edit'));
    const client = await makeClient({ name: 'Brightpath Learning' });
    const lead = await makeConvertibleLead();
    const before = await conversionFootprint(lead._id);
    expect((await rejects(convertLead(viewer, String(lead._id), newClient()))).code).toBe('FORBIDDEN');
    expect((await rejects(convertLead(viewer, String(lead._id), newClient({ project: portal })))).code).toBe('FORBIDDEN');
    expect((await rejects(convertLead(viewer, String(lead._id), existing(String(client._id))))).code).toBe('FORBIDDEN');
    expect(await conversionFootprint(lead._id)).toEqual({ ...before, clients: 1 });
  });

  it('client:edit without lead:edit is refused', async () => {
    const viewer = withCaps(await sessionFor(await makeSuperadmin()), without('lead:edit'));
    const lead = await makeConvertibleLead();
    const before = await conversionFootprint(lead._id);
    expect((await rejects(convertLead(viewer, String(lead._id), newClient()))).code).toBe('FORBIDDEN');
    expect(await conversionFootprint(lead._id)).toEqual(before);
  });

  it('a draft project needs project:edit, and is refused before the client is made', async () => {
    const viewer = withCaps(await sessionFor(await makeSuperadmin()), without('project:edit'));
    const lead = await makeConvertibleLead();
    const before = await conversionFootprint(lead._id);
    expect((await rejects(convertLead(viewer, String(lead._id), newClient({ project: portal })))).code).toBe('FORBIDDEN');
    expect(await conversionFootprint(lead._id)).toEqual(before);

    // without a project there is nothing that needs project:edit
    const result = await convertLead(viewer, String(lead._id), newClient());
    expect(result.project).toBeNull();
    expect(await Project.countDocuments({})).toBe(0);
  });

  it('a viewer who can only read enquiries is refused', async () => {
    const viewer = withCaps(await sessionFor(await makeSuperadmin()), ['lead:view', 'client:view', 'project:view']);
    const lead = await makeConvertibleLead();
    const before = await conversionFootprint(lead._id);
    expect((await rejects(convertLead(viewer, String(lead._id), newClient()))).code).toBe('FORBIDDEN');
    expect(await conversionFootprint(lead._id)).toEqual(before);
  });

  it('an ordinary admin has all three by default', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const lead = await makeConvertibleLead();
    expect((await convertLead(viewer, String(lead._id), newClient({ project: portal }))).client.created).toBe(true);
  });
});
