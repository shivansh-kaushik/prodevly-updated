import { describe, expect, it } from 'vitest';
import { GET as listRoute, POST as createRoute } from '@/app/api/admin/clients/route';
import { DELETE as deleteRoute, GET as getRoute, PATCH as patchRoute } from '@/app/api/admin/clients/[id]/route';
import { POST as archiveRoute } from '@/app/api/admin/clients/[id]/archive/route';
import { POST as restoreRoute } from '@/app/api/admin/clients/[id]/restore/route';
import { Client } from '@/models';
import { makeClient, makeProject } from '@/test/domain-factories';
import { call, cookieFor, makeAdmin, makeSuperadmin } from '@/test/factories';
import { setupTestDb } from '@/test/db';

setupTestDb();

describe('client routes', () => {
  it('require sign-in, same-origin and a valid body', async () => {
    const anon = await call(createRoute, '/api/admin/clients', { method: 'POST', body: { name: 'Acme' } });
    expect(anon.status).toBe(401);
    const cookie = await cookieFor(await makeAdmin());
    const cross = await call(createRoute, '/api/admin/clients', { method: 'POST', body: { name: 'Acme' }, cookie, headers: { 'sec-fetch-site': 'cross-site' } });
    expect(cross.status).toBe(403);
    const bad = await call(createRoute, '/api/admin/clients', { method: 'POST', body: { name: 'A', gstin: 'x' }, cookie });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.error.fields)).toEqual(expect.arrayContaining(['name', 'gstin']));
    const injected = await call(createRoute, '/api/admin/clients', { method: 'POST', body: { name: 'Acme', isInternal: true }, cookie });
    expect(injected.status).toBe(422); // strict: a client cannot make itself the internal one
  });

  it('create, read, update, archive, restore round trip for a plain admin who was granted archive', async () => {
    const admin = await makeAdmin({ grants: ['client:archive'] });
    const cookie = await cookieFor(admin);
    const created = await call(createRoute, '/api/admin/clients', { method: 'POST', body: { name: 'Round Trip Ltd', status: 'active' }, cookie });
    expect(created.status).toBe(201);
    const id: string = created.body.data.client.id;

    expect((await call(getRoute, `/api/admin/clients/${id}`, { cookie }, { id })).body.data.client.name).toBe('Round Trip Ltd');
    const patched = await call(patchRoute, `/api/admin/clients/${id}`, { method: 'PATCH', body: { notes: 'Hello' }, cookie }, { id });
    expect(patched.body.data.client.notes).toBe('Hello');
    expect((await call(archiveRoute, `/api/admin/clients/${id}/archive`, { method: 'POST', body: {}, cookie }, { id })).status).toBe(200);
    expect((await call(listRoute, '/api/admin/clients', { cookie })).body.data.items).toHaveLength(0);
    expect((await call(restoreRoute, `/api/admin/clients/${id}/restore`, { method: 'POST', body: {}, cookie }, { id })).status).toBe(200);
    expect((await call(listRoute, '/api/admin/clients?q=round', { cookie })).body.data.items).toHaveLength(1);
  });

  it('a plain admin cannot archive or delete; a superadmin can delete only an unlinked client by typing its name', async () => {
    const plainCookie = await cookieFor(await makeAdmin());
    const client = await makeClient({ name: 'Doomed Co' });
    const id = String(client._id);
    expect((await call(archiveRoute, `/api/admin/clients/${id}/archive`, { method: 'POST', body: {}, cookie: plainCookie }, { id })).status).toBe(403);
    expect((await call(deleteRoute, `/api/admin/clients/${id}`, { method: 'DELETE', body: { confirmName: 'Doomed Co' }, cookie: plainCookie }, { id })).status).toBe(403);

    const cookie = await cookieFor(await makeSuperadmin());
    expect((await call(deleteRoute, `/api/admin/clients/${id}`, { method: 'DELETE', body: { confirmName: 'nope' }, cookie }, { id })).status).toBe(422);
    await makeProject(client);
    const linked = await call(deleteRoute, `/api/admin/clients/${id}`, { method: 'DELETE', body: { confirmName: 'Doomed Co' }, cookie }, { id });
    expect(linked.status).toBe(409);
    expect(linked.body.error.code).toBe('HAS_LINKED_RECORDS');
    expect(await Client.countDocuments({ _id: client._id })).toBe(1);
  });

  it('answers 404 for a malformed id and never a 500', async () => {
    const cookie = await cookieFor(await makeAdmin());
    expect((await call(getRoute, '/api/admin/clients/not-an-id', { cookie }, { id: 'not-an-id' })).status).toBe(404);
    expect((await call(getRoute, '/api/admin/clients/5F3A9C0B1D2E4F6A8B7C9D0E', { cookie }, { id: '5F3A9C0B1D2E4F6A8B7C9D0E' })).status).toBe(404);
  });
});
