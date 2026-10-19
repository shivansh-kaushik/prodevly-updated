import { describe, expect, it, vi } from 'vitest';
import { AuditLog, Client, Project } from '@/models';
import { withTransaction } from '@/lib/db/mongoose';
import {
  archiveClient,
  createClient,
  createClientInTx,
  deleteClient,
  getClientById,
  listClients,
  restoreClient,
  updateClient,
} from '@/services/client.service';
import { createClientSchema } from '@/lib/validation/client';
import { makeClient, makeProject, makeTask } from '@/test/domain-factories';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { setupTestDb } from '@/test/db';
import type { SessionUser } from '@/types/session';

setupTestDb();

const input = (o: Record<string, unknown> = {}) => createClientSchema.parse({ name: 'Brightpath Learning', ...o });
const without = (v: SessionUser, ...caps: string[]): SessionUser => ({ ...v, capabilities: new Set([...v.capabilities].filter((c) => !caps.includes(c))) as SessionUser['capabilities'] });
const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; fields?: Record<string, string> };
  }
  throw new Error('expected a rejection');
};

describe('creating a client', () => {
  it('numbers it, stores a snapshot of who made it, and audits with the client in context', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const a = await createClient(sa, input());
    const b = await createClient(sa, input({ name: 'Second Client' }));
    expect([a.ref, b.ref]).toEqual(['CL-0001', 'CL-0002']);
    expect(a).toMatchObject({ status: 'prospect', kind: 'company', isInternal: false, archivedAt: null });
    const entry = await AuditLog.findOne({ action: 'client.create', 'entity.id': (await Client.findOne({ ref: 'CL-0001' }))!._id }).lean();
    expect(entry?.context.clientId?.toString()).toBe(a.id);
    expect(entry?.actor.name).toBe(sa.name);
  });

  it('keeps one primary contact, lowercases emails and refuses two primaries', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const c = await createClient(sa, input({ contacts: [{ name: 'Riya', email: 'Riya@Example.com' }, { name: 'Dev' }] }));
    expect(c.contacts.map((k) => [k.name, k.email, k.isPrimary])).toEqual([['Riya', 'riya@example.com', true], ['Dev', null, false]]);
    const err = await rejects(createClient(sa, input({ name: 'Other', contacts: [{ name: 'A', isPrimary: true }, { name: 'B', isPrimary: true }] })));
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields?.contacts).toMatch(/Only one/);
  });

  it('refuses a duplicate name (any case), the reserved internal name, a currency that is off, and an inactive owner', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    await createClient(sa, input());
    expect((await rejects(createClient(sa, input({ name: 'BRIGHTPATH learning' })))).code).toBe('CONFLICT');
    await makeClient({ name: 'ProDevly (internal)', isInternal: true });
    expect((await rejects(createClient(sa, input({ name: 'prodevly (internal)' })))).code).toBe('CONFLICT');
    expect((await rejects(createClient(sa, input({ name: 'Acme', billingCurrency: 'JPY' })))).fields?.billingCurrency).toMatch(/Settings/);
    const gone = await makeAdmin({ status: 'deactivated' });
    expect((await rejects(createClient(sa, input({ name: 'Acme', accountOwnerId: String(gone._id) })))).fields?.accountOwnerId).toBeDefined();
    const active = await makeAdmin({ name: 'Owner Person' });
    expect((await createClient(sa, input({ name: 'Acme', accountOwnerId: String(active._id) }))).accountOwner?.name).toBe('Owner Person');
  });

  it('needs client:edit', async () => {
    const viewer = without(await sessionFor(await makeAdmin()), 'client:edit');
    expect((await rejects(createClient(viewer, input()))).code).toBe('FORBIDDEN');
    expect(await Client.countDocuments({})).toBe(0);
  });

  it('is atomic with its audit entry, and joins a transaction the caller owns', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    vi.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('audit down'));
    await rejects(createClient(sa, input()));
    expect(await Client.countDocuments({})).toBe(0);
    vi.restoreAllMocks();

    await expect(
      withTransaction(async (session) => {
        await createClientInTx(sa, input({ name: 'Converted Co' }), session, {}, {});
        throw new Error('the caller failed afterwards');
      }),
    ).rejects.toThrow('the caller failed');
    expect(await Client.countDocuments({})).toBe(0); // the whole thing rolled back, ref counter included
    const ok = await withTransaction((session) => createClientInTx(sa, input({ name: 'Converted Co' }), session));
    expect(ok.ref).toBe('CL-0001');
  });
});

describe('updating a client', () => {
  it('renames it everywhere the name is a snapshot, and audits before and after', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const client = await makeClient({ name: 'Old Name' });
    const project = await makeProject(client);
    const updated = await updateClient(sa, String(client._id), { name: 'New Name', notes: 'Pays on time' });
    expect(updated).toMatchObject({ name: 'New Name', notes: 'Pays on time' });
    expect((await Project.findById(project._id).lean())?.clientName).toBe('New Name');
    const entry = await AuditLog.findOne({ action: 'client.update' }).lean();
    expect(entry?.changes).toEqual(expect.arrayContaining([{ path: 'name', before: 'Old Name', after: 'New Name' }]));
  });

  it('clears a field with an empty string, and leaves the rest alone', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const c = await createClient(sa, input({ industry: 'Education', country: 'IN', gstin: '22ABCDE1234F1Z5', notes: 'x' }));
    const after = await updateClient(sa, c.id, { industry: '', gstin: '' });
    expect(after).toMatchObject({ industry: null, gstin: null, country: 'IN', notes: 'x' });
  });

  it('protects the internal client and refuses a name that is taken', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const internal = await makeClient({ name: 'ProDevly (internal)', isInternal: true });
    expect((await rejects(updateClient(sa, String(internal._id), { name: 'Something else' }))).code).toBe('CONFLICT');
    expect((await rejects(updateClient(sa, String(internal._id), { status: 'past' }))).code).toBe('CONFLICT');
    await expect(updateClient(sa, String(internal._id), { notes: 'Our own work' })).resolves.toMatchObject({ notes: 'Our own work' });
    const a = await makeClient({ name: 'Taken Name' });
    const b = await makeClient({ name: 'Other One' });
    expect((await rejects(updateClient(sa, String(b._id), { name: 'taken name' }))).code).toBe('CONFLICT');
    await expect(updateClient(sa, String(a._id), { name: 'Taken Name' })).resolves.toBeDefined(); // its own name is fine
  });

  it('answers not found for an unknown or malformed id', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    expect((await rejects(updateClient(sa, 'zzz', { notes: 'x' }))).code).toBe('NOT_FOUND');
    expect((await rejects(getClientById(sa, '5f3a9c0b1d2e4f6a8b7c9d0e'))).code).toBe('NOT_FOUND');
  });
});

describe('archive, restore and delete', () => {
  it('archive and restore need client:archive, which a plain admin lacks until granted', async () => {
    const client = await makeClient();
    const plain = await sessionFor(await makeAdmin());
    expect((await rejects(archiveClient(plain, String(client._id)))).code).toBe('FORBIDDEN');
    const granted = await sessionFor(await makeAdmin({ grants: ['client:archive'] }));
    expect((await archiveClient(granted, String(client._id))).archivedAt).not.toBeNull();
    expect((await rejects(archiveClient(granted, String(client._id)))).code).toBe('CONFLICT');
    expect((await restoreClient(granted, String(client._id))).archivedAt).toBeNull();
    expect((await rejects(restoreClient(granted, String(client._id)))).code).toBe('CONFLICT');
  });

  it('never archives or deletes the internal client', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const internal = await makeClient({ name: 'ProDevly (internal)', isInternal: true });
    expect((await rejects(archiveClient(sa, String(internal._id)))).code).toBe('CONFLICT');
    expect((await rejects(deleteClient(sa, String(internal._id), 'ProDevly (internal)'))).code).toBe('FORBIDDEN');
  });

  it('deletes for good only for a superadmin, with the name typed, and only when nothing links to it', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const plain = await sessionFor(await makeAdmin());
    const empty = await makeClient({ name: 'Empty Client' });
    expect((await rejects(deleteClient(plain, String(empty._id), 'Empty Client'))).code).toBe('FORBIDDEN');
    expect((await rejects(deleteClient(sa, String(empty._id), 'wrong name'))).fields?.confirmName).toBeDefined();
    await expect(deleteClient(sa, String(empty._id), 'Empty Client')).resolves.toEqual({ id: String(empty._id) });
    expect(await Client.countDocuments({})).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'client.delete' })).toBe(1);

    const busy = await makeClient({ name: 'Busy Client' });
    const project = await makeProject(busy);
    await makeTask(project);
    const err = await rejects(deleteClient(sa, String(busy._id), 'Busy Client'));
    expect(err.code).toBe('HAS_LINKED_RECORDS');
    expect(await Client.countDocuments({ name: 'Busy Client' })).toBe(1);
  });
});

describe('listing clients', () => {
  it('searches literally across name, ref and contacts, filters, sorts and counts projects', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const a = await makeClient({ name: 'Acme Robotics', country: 'US', status: 'active', contacts: [{ name: 'Wile', email: 'wile@acme.test', isPrimary: true }] });
    await makeClient({ name: 'Zenith Labs', country: 'IN', status: 'past' });
    await makeProject(a);
    await makeProject(a);

    const all = await listClients(sa, {});
    expect(all.items.map((c) => c.name)).toContain('Acme Robotics');
    expect((await listClients(sa, { q: 'acme' })).items.map((c) => c.name)).toEqual(['Acme Robotics']);
    expect((await listClients(sa, { q: 'wile@acme' })).items.map((c) => c.name)).toEqual(['Acme Robotics']);
    expect((await listClients(sa, { q: a.ref })).items).toHaveLength(1);
    expect((await listClients(sa, { q: '.*' })).items).toEqual([]);
    expect((await listClients(sa, { status: 'past' })).items.map((c) => c.name)).toEqual(['Zenith Labs']);
    expect((await listClients(sa, { country: 'us' })).items.map((c) => c.name)).toEqual(['Acme Robotics']);
    expect((await listClients(sa, { sort: 'name', dir: 'asc' })).items.map((c) => c.name)).toEqual(['Acme Robotics', 'Zenith Labs']);
    expect((await listClients(sa, { q: 'acme' })).items[0]?.projectCount).toBe(2);
    expect((await listClients(sa, { q: 'acme' })).items[0]?.primaryContact).toEqual({ name: 'Wile', email: 'wile@acme.test' });
  });

  it('hides archived clients unless asked, pages, and needs client:view', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const old = await makeClient({ name: 'Archived Co' });
    await Client.updateOne({ _id: old._id }, { $set: { archivedAt: new Date() } });
    for (let i = 0; i < 3; i++) await makeClient({ name: `Client ${i}` });
    expect((await listClients(sa, {})).meta.total).toBe(3);
    expect((await listClients(sa, { archived: 'only' })).items.map((c) => c.name)).toEqual(['Archived Co']);
    expect((await listClients(sa, { archived: 'include' })).meta.total).toBe(4);
    const page = await listClients(sa, { pageSize: 2, page: 2, sort: 'name', dir: 'asc' });
    expect(page.items).toHaveLength(1);
    expect(page.meta).toMatchObject({ page: 2, pages: 2, total: 3 });
    expect((await rejects(listClients(without(sa, 'client:view'), {}))).code).toBe('FORBIDDEN');
  });
});

describe('renaming keeps the search key in step', () => {
  it('updates nameLower, so the duplicate guard and search follow the new name', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const c = await makeClient({ name: 'Old Name' });
    await updateClient(sa, String(c._id), { name: 'Fresh Name' });
    expect((await Client.findById(c._id).lean())?.nameLower).toBe('fresh name');
    expect((await listClients(sa, { q: 'fresh' })).items).toHaveLength(1);
    expect((await listClients(sa, { q: 'old name' })).items).toHaveLength(0);
    expect((await rejects(createClient(sa, input({ name: 'FRESH NAME' })))).code).toBe('CONFLICT');
  });
});
