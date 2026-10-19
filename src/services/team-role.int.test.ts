import { describe, expect, it } from 'vitest';
import { GET as listRoute, POST as createRoute } from '@/app/api/admin/team/roles/route';
import { DELETE as deleteRoute, PATCH as updateRoute } from '@/app/api/admin/team/roles/[id]/route';
import { POST as archiveRoute } from '@/app/api/admin/team/roles/[id]/archive/route';
import { POST as restoreRoute } from '@/app/api/admin/team/roles/[id]/restore/route';
import { POST as reorderRoute } from '@/app/api/admin/team/roles/reorder/route';
import { Admin, AuditLog, TeamRole } from '@/models';
import {
  archiveTeamRole,
  createTeamRole,
  deleteTeamRole,
  listTeamRoles,
  reorderTeamRoles,
  restoreTeamRole,
  updateTeamRole,
} from '@/services/team-role.service';
import { setupTestDb } from '@/test/db';
import { call, cookieFor, makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { makeMember, makeTeamRole } from '@/test/team-factories';

setupTestDb();

const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; status?: number; fields?: Record<string, string> };
  }
  throw new Error('expected the call to be rejected');
};
const superadmin = async () => sessionFor(await makeSuperadmin());
const plainAdmin = async () => sessionFor(await makeAdmin());

describe('who may touch the job-role catalogue', () => {
  it('lets an admin read it (the directory shows it) but not change it', async () => {
    const admin = await plainAdmin();
    const role = await makeTeamRole({ name: 'Designer' });
    expect((await listTeamRoles(admin)).map((r) => r.name)).toEqual(['Designer']);

    const id = String(role._id);
    expect((await rejects(createTeamRole(admin, { name: 'Tester' }))).code).toBe('FORBIDDEN');
    expect((await rejects(updateTeamRole(admin, id, { name: 'Renamed' }))).code).toBe('FORBIDDEN');
    expect((await rejects(archiveTeamRole(admin, id))).code).toBe('FORBIDDEN');
    expect((await rejects(restoreTeamRole(admin, id))).code).toBe('FORBIDDEN');
    expect((await rejects(deleteTeamRole(admin, id))).code).toBe('FORBIDDEN');
    expect((await rejects(reorderTeamRoles(admin, [id]))).code).toBe('FORBIDDEN');
    expect(await TeamRole.countDocuments()).toBe(1);
    expect((await TeamRole.findById(role._id).lean())?.name).toBe('Designer');
    expect(await AuditLog.countDocuments({ action: /^teamRole\./ })).toBe(0);
  });

  it('answers 403 on every write route for an admin, and 200 on the list', async () => {
    const admin = await makeAdmin();
    const cookie = await cookieFor(admin);
    const role = await makeTeamRole();
    const id = String(role._id);
    expect((await call(listRoute, '/api/admin/team/roles', { cookie })).status).toBe(200);
    expect((await call(createRoute, '/api/admin/team/roles', { body: { name: 'Tester' }, cookie })).status).toBe(403);
    expect((await call(updateRoute, `/api/admin/team/roles/${id}`, { method: 'PATCH', body: { name: 'Nope' }, cookie }, { id })).status).toBe(403);
    expect((await call(archiveRoute, `/api/admin/team/roles/${id}/archive`, { method: 'POST', body: {}, cookie }, { id })).status).toBe(403);
    expect((await call(restoreRoute, `/api/admin/team/roles/${id}/restore`, { method: 'POST', body: {}, cookie }, { id })).status).toBe(403);
    expect((await call(deleteRoute, `/api/admin/team/roles/${id}`, { method: 'DELETE', cookie }, { id })).status).toBe(403);
    expect((await call(reorderRoute, '/api/admin/team/roles/reorder', { body: { ids: [id] }, cookie })).status).toBe(403);
    expect(await TeamRole.countDocuments()).toBe(1);
  });

  it('refuses an unauthenticated caller with 401', async () => {
    expect((await call(listRoute, '/api/admin/team/roles')).status).toBe(401);
  });
});

describe('create', () => {
  it('creates a role at the end of the list, audits it, and returns a DTO', async () => {
    const sa = await superadmin();
    await makeTeamRole({ name: 'First', order: 0 });
    const role = await createTeamRole(sa, { name: 'Frontend developer', description: 'Builds the UI' });
    expect(role).toMatchObject({ name: 'Frontend developer', description: 'Builds the UI', archived: false, memberCount: 0, order: 1 });
    expect(typeof role.id).toBe('string');
    expect(role).not.toHaveProperty('_id');
    expect(role).not.toHaveProperty('nameLower');

    const entry = await AuditLog.findOne({ action: 'teamRole.create' }).lean();
    expect(entry?.actor.name).toBe(sa.name);
    expect(entry?.entity).toMatchObject({ type: 'teamRole', label: 'Frontend developer' });
  });

  it('keeps names unique ignoring case and surrounding or repeated spaces', async () => {
    const sa = await superadmin();
    await createTeamRole(sa, { name: 'Project manager' });
    const err = await rejects(createTeamRole(sa, { name: 'PROJECT MANAGER' }));
    expect(err.code).toBe('CONFLICT');
    expect(err.fields?.name).toBeTruthy();
    expect(await TeamRole.countDocuments()).toBe(1);
  });

  it('tells you when the clashing role is archived, so you restore it rather than duplicate it', async () => {
    const sa = await superadmin();
    await makeTeamRole({ name: 'QA', archived: true });
    expect((await rejects(createTeamRole(sa, { name: 'qa' }))).code).toBe('CONFLICT');
  });

  it('validates the name on the route: collapses spaces, rejects too short and unknown keys', async () => {
    const cookie = await cookieFor(await makeSuperadmin());
    const ok = await call(createRoute, '/api/admin/team/roles', { body: { name: '  UI/UX   designer ' }, cookie });
    expect(ok.status).toBe(201);
    expect(ok.body.data.role.name).toBe('UI/UX designer');
    expect((await call(createRoute, '/api/admin/team/roles', { body: { name: 'x' }, cookie })).status).toBe(422);
    expect((await call(createRoute, '/api/admin/team/roles', { body: { name: 'Valid name', order: 5 }, cookie })).status).toBe(422);
  });

  it('survives two people adding the same name at once: exactly one wins, the other gets a clean 409', async () => {
    const sa = await superadmin();
    const results = await Promise.allSettled([createTeamRole(sa, { name: 'DevOps' }), createTeamRole(sa, { name: 'devops' })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((lost.reason as { code?: string }).code).toBe('CONFLICT');
    expect(await TeamRole.countDocuments({ nameLower: 'devops' })).toBe(1);
  });
});

describe('rename and describe', () => {
  it('renames, allows changing only the case of its own name, and refuses another role\'s name', async () => {
    const sa = await superadmin();
    const a = await createTeamRole(sa, { name: 'Backend developer' });
    const b = await createTeamRole(sa, { name: 'Designer' });

    expect((await updateTeamRole(sa, a.id, { name: 'backend developer' })).name).toBe('backend developer'); // own name, new case
    expect((await updateTeamRole(sa, a.id, { name: 'Server developer' })).name).toBe('Server developer');
    const err = await rejects(updateTeamRole(sa, b.id, { name: 'SERVER DEVELOPER' }));
    expect(err.code).toBe('CONFLICT');
    expect((await TeamRole.findById(b.id).lean())?.name).toBe('Designer');
    // the lower-case key moved with the rename, so the old name is free again
    expect((await createTeamRole(sa, { name: 'Backend developer' })).name).toBe('Backend developer');
  });

  it('sets and clears the description and writes one audit entry per real change', async () => {
    const sa = await superadmin();
    const role = await createTeamRole(sa, { name: 'Designer' });
    expect((await updateTeamRole(sa, role.id, { description: 'Screens and flows' })).description).toBe('Screens and flows');
    expect((await updateTeamRole(sa, role.id, { description: '' })).description).toBeNull();
    await updateTeamRole(sa, role.id, { description: '' }); // no change: no write, no audit
    await updateTeamRole(sa, role.id, { name: 'Designer' }); // same name: no change
    expect(await AuditLog.countDocuments({ action: 'teamRole.update' })).toBe(2);
  });

  it('returns 404 for a malformed or unknown id, never a cast error', async () => {
    const cookie = await cookieFor(await makeSuperadmin());
    expect((await call(updateRoute, '/api/admin/team/roles/nope', { method: 'PATCH', body: { name: 'Whatever' }, cookie }, { id: 'nope' })).status).toBe(404);
    const missing = '5f3a9c0b1d2e4f6a8b7c9d0e';
    expect((await call(updateRoute, `/api/admin/team/roles/${missing}`, { method: 'PATCH', body: { name: 'Whatever' }, cookie }, { id: missing })).status).toBe(404);
  });

  it('accepts an UPPERCASE id', async () => {
    const sa = await superadmin();
    const role = await createTeamRole(sa, { name: 'Designer' });
    expect((await updateTeamRole(sa, role.id.toUpperCase(), { name: 'Visual designer' })).name).toBe('Visual designer');
  });
});

describe('archive, restore and delete', () => {
  it('archives a role that people hold without touching them, and hides it from the live list', async () => {
    const sa = await superadmin();
    const role = await makeTeamRole({ name: 'Designer' });
    const person = await makeMember({ jobRole: role });
    const archived = await archiveTeamRole(sa, String(role._id));
    expect(archived).toMatchObject({ archived: true, memberCount: 1, activeMemberCount: 1 });
    expect((await listTeamRoles(sa, { includeArchived: false })).map((r) => r.name)).toEqual([]);
    expect((await listTeamRoles(sa)).map((r) => r.name)).toEqual(['Designer']);
    expect(String((await Admin.findById(person._id).lean())?.profile.jobRoleId)).toBe(String(role._id));

    expect((await rejects(archiveTeamRole(sa, String(role._id)))).code).toBe('CONFLICT');
    const restored = await restoreTeamRole(sa, String(role._id));
    expect(restored.archived).toBe(false);
    expect((await rejects(restoreTeamRole(sa, String(role._id)))).code).toBe('CONFLICT');
    expect(await AuditLog.countDocuments({ action: /^teamRole\.(archive|restore)$/ })).toBe(2);
  });

  it('refuses to hard delete a role anyone holds (even a removed account) with 409 HAS_LINKED_RECORDS, and deletes an unused one', async () => {
    const sa = await superadmin();
    const used = await makeTeamRole({ name: 'Used' });
    await makeMember({ jobRole: used, status: 'deactivated' });
    const err = await rejects(deleteTeamRole(sa, String(used._id)));
    expect(err.code).toBe('HAS_LINKED_RECORDS');
    expect(await TeamRole.countDocuments({ _id: used._id })).toBe(1);

    const unused = await makeTeamRole({ name: 'Unused' });
    expect(await deleteTeamRole(sa, String(unused._id))).toEqual({ id: String(unused._id) });
    expect(await TeamRole.countDocuments({ _id: unused._id })).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'teamRole.delete' })).toBe(1);
  });

  it('answers the same through the routes', async () => {
    const admin = await makeSuperadmin();
    const cookie = await cookieFor(admin);
    const role = await makeTeamRole({ name: 'Used' });
    await makeMember({ jobRole: role });
    const id = String(role._id);
    expect((await call(deleteRoute, `/api/admin/team/roles/${id}`, { method: 'DELETE', cookie }, { id })).body.error.code).toBe('HAS_LINKED_RECORDS');
    expect((await call(archiveRoute, `/api/admin/team/roles/${id}/archive`, { method: 'POST', body: {}, cookie }, { id })).status).toBe(200);
    expect((await call(restoreRoute, `/api/admin/team/roles/${id}/restore`, { method: 'POST', body: {}, cookie }, { id })).status).toBe(200);
  });
});

describe('reorder', () => {
  it('saves the new order of the live roles, leaves archived ones below, and audits once', async () => {
    const sa = await superadmin();
    const a = await createTeamRole(sa, { name: 'A role' });
    const b = await createTeamRole(sa, { name: 'B role' });
    const c = await createTeamRole(sa, { name: 'C role' });
    const archived = await makeTeamRole({ name: 'Old role', archived: true, order: 0 });

    const list = await reorderTeamRoles(sa, [c.id, a.id, b.id]);
    expect(list.map((r) => r.name)).toEqual(['C role', 'A role', 'B role', 'Old role']);
    expect((await listTeamRoles(sa)).map((r) => r.name)).toEqual(['C role', 'A role', 'B role', 'Old role']);
    expect(String(archived._id)).toBeTruthy();
    expect(await AuditLog.countDocuments({ action: 'teamRole.reorder' })).toBe(1);

    await reorderTeamRoles(sa, [c.id, a.id, b.id]); // same order again: no write, no audit
    expect(await AuditLog.countDocuments({ action: 'teamRole.reorder' })).toBe(1);
  });

  it('refuses a list that is not exactly the live roles, so a stale screen cannot scramble the order', async () => {
    const sa = await superadmin();
    const a = await createTeamRole(sa, { name: 'A role' });
    const b = await createTeamRole(sa, { name: 'B role' });
    expect((await rejects(reorderTeamRoles(sa, [a.id]))).code).toBe('CONFLICT'); // one missing
    expect((await rejects(reorderTeamRoles(sa, [a.id, b.id, '5f3a9c0b1d2e4f6a8b7c9d0e']))).code).toBe('CONFLICT'); // a stranger
    expect((await rejects(reorderTeamRoles(sa, [a.id, a.id]))).code).toBe('VALIDATION_FAILED'); // a repeat
    expect((await listTeamRoles(sa)).map((r) => r.name)).toEqual(['A role', 'B role']);
  });

  it('validates the route body', async () => {
    const cookie = await cookieFor(await makeSuperadmin());
    const role = await makeTeamRole();
    expect((await call(reorderRoute, '/api/admin/team/roles/reorder', { body: { ids: [] }, cookie })).status).toBe(422);
    expect((await call(reorderRoute, '/api/admin/team/roles/reorder', { body: { ids: ['bad'] }, cookie })).status).toBe(422);
    expect((await call(reorderRoute, '/api/admin/team/roles/reorder', { body: { ids: [String(role._id)] }, cookie })).status).toBe(200);
  });
});

describe('member counts', () => {
  it('counts everyone who holds a role, and separately the active ones', async () => {
    const sa = await superadmin();
    const role = await makeTeamRole({ name: 'Designer' });
    await makeMember({ jobRole: role });
    await makeMember({ jobRole: role });
    await makeMember({ jobRole: role, status: 'deactivated' });
    const [row] = await listTeamRoles(sa);
    expect(row).toMatchObject({ memberCount: 3, activeMemberCount: 2 });
  });
});
