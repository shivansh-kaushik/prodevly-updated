import { describe, expect, it } from 'vitest';
import { GET as lookupRoute } from '@/app/api/admin/lookup/[kind]/route';
import { Client } from '@/models';
import { lookup } from '@/services/lookup.service';
import { makeClient, makeProject, makeTask, makeThirdParty } from '@/test/domain-factories';
import { call, cookieFor, makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { setupTestDb } from '@/test/db';

setupTestDb();

describe('lookup', () => {
  it('finds clients by name fragment, internal client first, never archived ones', async () => {
    const viewer = await sessionFor(await makeSuperadmin());
    await makeClient({ name: 'Acme Robotics' });
    await makeClient({ name: 'Zenith Acme Labs' });
    await makeClient({ name: 'Other Co' });
    const archived = await makeClient({ name: 'Acme Archived' });
    await Client.updateOne({ _id: archived._id }, { $set: { archivedAt: new Date() } });
    await makeClient({ name: 'ProDevly (internal)', isInternal: true });

    expect((await lookup(viewer, 'clients', { q: 'acme' })).map((i) => i.label).sort()).toEqual(['Acme Robotics', 'Zenith Acme Labs']);
    const all = await lookup(viewer, 'clients', {});
    expect(all[0]?.label).toBe('ProDevly (internal)');
    expect(all.map((i) => i.label)).not.toContain('Acme Archived');
  });

  it('treats the search text literally, not as a pattern', async () => {
    const viewer = await sessionFor(await makeSuperadmin());
    await makeClient({ name: 'Acme' });
    expect(await lookup(viewer, 'clients', { q: '.*' })).toEqual([]);
    expect(await lookup(viewer, 'clients', { q: '(' })).toEqual([]);
    expect(await lookup(viewer, 'clients', { q: 'a|z' })).toEqual([]);
  });

  it('cascades: a client\'s projects, then a project\'s tasks', async () => {
    const viewer = await sessionFor(await makeSuperadmin());
    const a = await makeClient({ name: 'A Client' });
    const b = await makeClient({ name: 'B Client' });
    const pa = await makeProject(a, { name: 'Alpha site' });
    const pb = await makeProject(b, { name: 'Beta app' });
    const ta = await makeTask(pa, { title: 'Wire the form' });
    await makeTask(pb, { title: 'Other task' });

    expect((await lookup(viewer, 'projects', { clientId: String(a._id) })).map((i) => i.label)).toEqual(['Alpha site']);
    expect((await lookup(viewer, 'projects', {})).length).toBe(2);
    const tasks = await lookup(viewer, 'tasks', { projectId: String(pa._id) });
    expect(tasks).toEqual([expect.objectContaining({ id: String(ta._id), label: 'Wire the form', ref: ta.ref })]);
    expect((await lookup(viewer, 'projects', { q: pb.ref })).map((i) => i.label)).toEqual(['Beta app']);
  });

  it('lists only active people and third parties', async () => {
    const viewer = await sessionFor(await makeSuperadmin());
    await makeAdmin({ name: 'Riya Active' });
    await makeAdmin({ name: 'Riya Gone', status: 'deactivated' });
    await makeThirdParty({ name: 'Pixel Studio' });
    await makeThirdParty({ name: 'Pixel Dormant', status: 'inactive' });
    expect((await lookup(viewer, 'admins', { q: 'riya' })).map((i) => i.label)).toEqual(['Riya Active']);
    expect((await lookup(viewer, 'third-parties', { q: 'pixel' })).map((i) => i.label)).toEqual(['Pixel Studio']);
  });

  it('needs the matching view capability, and unknown kinds are not found', async () => {
    const plain = await sessionFor(await makeAdmin()); // can view clients/projects/tasks/team/thirdParty by default
    await expect(lookup(plain, 'clients', {})).resolves.toBeDefined();
    await expect(lookup(plain, 'nope', {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('is behind sign-in on the route', async () => {
    const anon = await call(lookupRoute, '/api/admin/lookup/clients', {}, { kind: 'clients' });
    expect(anon.status).toBe(401);
    const admin = await makeAdmin();
    await makeClient({ name: 'Visible Co' });
    const ok = await call(lookupRoute, '/api/admin/lookup/clients?q=visible', { cookie: await cookieFor(admin) }, { kind: 'clients' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.items).toHaveLength(1);
  });
});
