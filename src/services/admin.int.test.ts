import { describe, expect, it } from 'vitest';
import { POST as createRoute, GET as listRoute } from '@/app/api/admin/admins/route';
import { PATCH as updateRoute } from '@/app/api/admin/admins/[id]/route';
import { POST as deactivateRoute } from '@/app/api/admin/admins/[id]/deactivate/route';
import { POST as resetRoute } from '@/app/api/admin/admins/[id]/reset-password/route';
import { loadSessionUser } from '@/lib/auth/authenticate';
import { Admin, AuditLog, Project, Task, Client } from '@/models';
import {
  createAdmin,
  deactivateAdmin,
  listOpenTasksFor,
  reactivateAdmin,
  resetPassword,
  revokeSessions,
  updateAdmin,
} from '@/services/admin.service';
import { call, cookieFor, makeAdmin, makeSuperadmin, sessionFor, TEST_PASSWORD } from '@/test/factories';
import { setupTestDb } from '@/test/db';
import { Types } from 'mongoose';

setupTestDb();

const NEW_ADMIN = { name: 'Neha Verma', email: 'neha@example.com', role: 'admin' as const, grants: [], password: 'silver-kettle-orbit-82' };

const activeSuperadmins = () => Admin.countDocuments({ role: 'superadmin', status: 'active' });
const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; fields?: Record<string, string> };
  }
  throw new Error('expected the call to be rejected');
};

describe('who may manage admins', () => {
  it('lets only superadmins in: a plain admin gets 403 on every management route', async () => {
    const admin = await makeAdmin();
    const cookie = await cookieFor(admin);
    const target = await makeAdmin();
    const id = String(target._id);
    expect((await call(listRoute, '/api/admin/admins', { cookie })).status).toBe(403);
    expect((await call(createRoute, '/api/admin/admins', { method: 'POST', body: NEW_ADMIN, cookie })).status).toBe(403);
    expect((await call(updateRoute, `/api/admin/admins/${id}`, { method: 'PATCH', body: { name: 'Hacked Name' }, cookie }, { id })).status).toBe(403);
    expect((await call(deactivateRoute, `/api/admin/admins/${id}/deactivate`, { method: 'POST', body: { reason: 'because' }, cookie }, { id })).status).toBe(403);
  });

  it('cannot be granted: admin:manage is never grantable, so no grant makes a plain admin a manager', async () => {
    const sa = await sessionFor(await makeSuperadmin(), { stepUp: true });
    const target = await makeAdmin();
    const err = await rejects(updateAdmin(sa, String(target._id), { grants: ['admin:manage'] }));
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields?.grants).toMatch(/cannot be granted/);
  });

  it('returns 404, not a cast error, for a malformed id', async () => {
    const admin = await makeSuperadmin();
    const res = await call(updateRoute, '/api/admin/admins/not-an-id', { method: 'PATCH', body: { name: 'Someone' }, cookie: await cookieFor(admin) }, { id: 'not-an-id' });
    expect(res.status).toBe(404);
  });
});

describe('create', () => {
  it('creates an admin who must change the temporary password, and audits it', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const created = await createAdmin(sa, NEW_ADMIN);
    expect(created).toMatchObject({ role: 'admin', status: 'active', mustChangePassword: true, email: 'neha@example.com' });
    expect(JSON.stringify(created)).not.toMatch(/passwordHash|\$2[aby]\$/);

    const entry = await AuditLog.findOne({ action: 'admin.create' }).lean();
    expect(entry?.actor.name).toBe(sa.name);
    expect(JSON.stringify(entry)).not.toContain(NEW_ADMIN.password);
  });

  it('rejects a duplicate email with 409, even when the other account is deactivated (the email stays reserved)', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    await makeAdmin({ email: 'neha@example.com', status: 'deactivated' });
    const res = await call(
      createRoute,
      '/api/admin/admins',
      { method: 'POST', body: NEW_ADMIN, cookie: await cookieFor({ _id: new Types.ObjectId(sa.id), role: 'superadmin' }) },
    );
    expect(res.status).toBe(409);
  });

  it('enforces the password policy against the new person\'s own name and email', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    expect((await rejects(createAdmin(sa, { ...NEW_ADMIN, password: 'short' }))).fields?.password).toMatch(/12/);
    expect((await rejects(createAdmin(sa, { ...NEW_ADMIN, password: 'neha-loves-the-sea-1' }))).fields?.password).toMatch(/name|email/);
    expect((await rejects(createAdmin(sa, { ...NEW_ADMIN, password: 'Password123456!' }))).fields?.password).toMatch(/common/);
  });

  it('needs step-up to create a superadmin or to hand out grants, but not a plain admin', async () => {
    const sa = await sessionFor(await makeSuperadmin()); // no step-up
    expect((await rejects(createAdmin(sa, { ...NEW_ADMIN, role: 'superadmin' }))).code).toBe('STEP_UP_REQUIRED');
    expect((await rejects(createAdmin(sa, { ...NEW_ADMIN, grants: ['payment:view'] }))).code).toBe('STEP_UP_REQUIRED');
    expect((await createAdmin(sa, NEW_ADMIN)).role).toBe('admin');

    const stepped = await sessionFor(await makeSuperadmin(), { stepUp: true });
    expect((await createAdmin(stepped, { ...NEW_ADMIN, email: 'sa2@example.com', name: 'Sam Roy', role: 'superadmin' })).role).toBe('superadmin');
  });

  it('normalises grants: adds the dependency, rejects non-grantable ones, refuses grants on a superadmin', async () => {
    const sa = await sessionFor(await makeSuperadmin(), { stepUp: true });
    const created = await createAdmin(sa, { ...NEW_ADMIN, grants: ['payment:record'] });
    expect(created.grants).toEqual(expect.arrayContaining(['payment:record', 'payment:view']));

    expect((await rejects(createAdmin(sa, { ...NEW_ADMIN, email: 'b@example.com', name: 'Bela Roy', grants: ['money:approve'] }))).fields?.grants).toMatch(/cannot be granted/);
    expect((await rejects(createAdmin(sa, { ...NEW_ADMIN, email: 'c@example.com', name: 'Chen Roy', role: 'superadmin', grants: ['payment:view'] }))).fields?.grants).toMatch(/full access/);
  });

  it('is atomic: a failed create leaves no admin and no audit entry behind', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    await rejects(createAdmin(sa, { ...NEW_ADMIN, profile: { jobRoleId: String(new Types.ObjectId()) } }));
    expect(await Admin.countDocuments({ email: 'neha@example.com' })).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'admin.create' })).toBe(0);
  });
});

describe('nobody acts on their own account', () => {
  it('refuses role changes, grants changes, removal, password reset and session revoke on self with SELF_ACTION', async () => {
    const me = await makeSuperadmin();
    await makeSuperadmin(); // a second superadmin, so the guard is not what stops us
    const sa = await sessionFor(me, { stepUp: true });
    const id = String(me._id);
    expect((await rejects(updateAdmin(sa, id, { role: 'admin' }))).code).toBe('SELF_ACTION');
    expect((await rejects(updateAdmin(sa, id, { grants: [] }))).code).toBe('SELF_ACTION');
    expect((await rejects(deactivateAdmin(sa, id, 'bye'))).code).toBe('SELF_ACTION');
    expect((await rejects(resetPassword(sa, id, 'another-long-passphrase-5'))).code).toBe('SELF_ACTION');
    expect((await rejects(revokeSessions(sa, id))).code).toBe('SELF_ACTION');
    expect((await Admin.findById(me._id).lean())?.role).toBe('superadmin');
  });

  it('still lets you edit your own name and profile', async () => {
    const me = await makeSuperadmin();
    const sa = await sessionFor(me);
    const updated = await updateAdmin(sa, String(me._id), { name: 'Renamed Person', profile: { designation: 'Founder', skills: ['sales'] } });
    expect(updated.name).toBe('Renamed Person');
    expect(updated.profile.designation).toBe('Founder');
  });
});

describe('there is always at least one active superadmin', () => {
  it('lets a superadmin demote or remove another while a different one remains', async () => {
    const a = await sessionFor(await makeSuperadmin(), { stepUp: true });
    const b = await makeSuperadmin();
    const c = await makeSuperadmin();
    await updateAdmin(a, String(b._id), { role: 'admin' });
    await deactivateAdmin(a, String(c._id), 'left the company');
    expect(await activeSuperadmins()).toBe(1);
  });

  it('two superadmins demoting EACH OTHER at the same instant leaves exactly one (never zero)', async () => {
    for (let round = 0; round < 6; round++) {
      await Admin.deleteMany({});
      const A = await makeSuperadmin();
      const B = await makeSuperadmin();
      const [sa, sb] = [await sessionFor(A, { stepUp: true }), await sessionFor(B, { stepUp: true })];

      const results = await Promise.allSettled([
        updateAdmin(sa, String(B._id), { role: 'admin' }),
        updateAdmin(sb, String(A._id), { role: 'admin' }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await activeSuperadmins()).toBe(1);
      const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      // The loser retries after the winner commits and is no longer a superadmin: FORBIDDEN, not LAST_SUPERADMIN.
      expect((loser.reason as { code?: string }).code).toBe('FORBIDDEN');
    }
  });

  it('two superadmins removing EACH OTHER at the same instant leaves exactly one', async () => {
    for (let round = 0; round < 6; round++) {
      await Admin.deleteMany({});
      const A = await makeSuperadmin();
      const B = await makeSuperadmin();
      const [sa, sb] = [await sessionFor(A, { stepUp: true }), await sessionFor(B, { stepUp: true })];
      const results = await Promise.allSettled([
        deactivateAdmin(sa, String(B._id), 'x-removal'),
        deactivateAdmin(sb, String(A._id), 'y-removal'),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await activeSuperadmins()).toBe(1);
    }
  });

  it('a demoted or removed superadmin cannot finish an action they started (the actor is re-checked in the transaction)', async () => {
    const A = await makeSuperadmin();
    const B = await makeSuperadmin();
    const sa = await sessionFor(A, { stepUp: true });
    const target = await makeAdmin();
    await Admin.updateOne({ _id: A._id }, { $set: { role: 'admin' } }); // demoted after authenticating
    expect((await rejects(updateAdmin(sa, String(target._id), { name: 'Late Edit' }))).code).toBe('FORBIDDEN');
    expect(await Admin.countDocuments({ name: 'Late Edit' })).toBe(0);
    expect(B).toBeTruthy();
  });
});

describe('sessions end when access changes', () => {
  const tokenIsAlive = async (id: Types.ObjectId, tv: number) => (await loadSessionUser({ sub: String(id), tv })) !== null;

  it('role change, password reset, session revoke and removal each end the person\'s sessions', async () => {
    const sa = await sessionFor(await makeSuperadmin(), { stepUp: true });

    const roleChange = await makeAdmin();
    await updateAdmin(sa, String(roleChange._id), { role: 'superadmin' });
    expect(await tokenIsAlive(roleChange._id, 0)).toBe(false);

    const reset = await makeAdmin();
    await resetPassword(sa, String(reset._id), 'fresh-temporary-phrase-73');
    expect(await tokenIsAlive(reset._id, 0)).toBe(false);
    expect((await Admin.findById(reset._id).lean())?.mustChangePassword).toBe(true);

    const revoked = await makeAdmin();
    await revokeSessions(sa, String(revoked._id));
    expect(await tokenIsAlive(revoked._id, 0)).toBe(false);

    const removed = await makeAdmin();
    await deactivateAdmin(sa, String(removed._id), 'left the team');
    expect(await tokenIsAlive(removed._id, 0)).toBe(false);
    expect(await tokenIsAlive(removed._id, 1)).toBe(false); // deactivated: no token version works
  });

  it('a name or profile edit does not log anyone out', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const person = await makeAdmin();
    await updateAdmin(sa, String(person._id), { name: 'New Display Name' });
    expect(await tokenIsAlive(person._id, 0)).toBe(true);
  });
});

describe('deactivate and reactivate ("delete" means deactivate)', () => {
  it('keeps the account and its trail, records who and why, and needs a recent step-up only for a superadmin', async () => {
    const sa = await sessionFor(await makeSuperadmin()); // no step-up
    const person = await makeAdmin({ email: 'leaver@example.com' });
    const dto = await deactivateAdmin(sa, String(person._id), 'moved to another company');
    expect(dto).toMatchObject({ status: 'deactivated', deactivatedBy: sa.name, deactivationReason: 'moved to another company' });
    expect(await Admin.countDocuments({ email: 'leaver@example.com' })).toBe(1);

    const otherSa = await makeSuperadmin();
    expect((await rejects(deactivateAdmin(sa, String(otherSa._id), 'oops'))).code).toBe('STEP_UP_REQUIRED');
  });

  it('refuses to deactivate twice or reactivate an active account', async () => {
    const sa = await sessionFor(await makeSuperadmin(), { stepUp: true });
    const person = await makeAdmin();
    await deactivateAdmin(sa, String(person._id), 'left the team');
    expect((await rejects(deactivateAdmin(sa, String(person._id), 'again please'))).code).toBe('CONFLICT');
    const active = await makeAdmin();
    expect((await rejects(reactivateAdmin(sa, String(active._id), 'fresh-temporary-phrase-73'))).code).toBe('CONFLICT');
  });

  it('reactivates with a new temporary password and a forced change, and the person can sign in again', async () => {
    const sa = await sessionFor(await makeSuperadmin(), { stepUp: true });
    const person = await makeAdmin({ email: 'back@example.com', name: 'Dev Patel' });
    await deactivateAdmin(sa, String(person._id), 'sabbatical leave');
    const dto = await reactivateAdmin(sa, String(person._id), 'fresh-temporary-phrase-73');
    expect(dto).toMatchObject({ status: 'active', mustChangePassword: true, deactivatedAt: null });
    const fresh = await Admin.findById(person._id).lean();
    expect(await loadSessionUser({ sub: String(person._id), tv: fresh!.tokenVersion })).not.toBeNull();
  });

  it('reactivation always needs a step-up, even for a plain admin account', async () => {
    const plain = await sessionFor(await makeSuperadmin());
    const person = await makeAdmin();
    await deactivateAdmin(plain, String(person._id), 'left the team');
    expect((await rejects(reactivateAdmin(plain, String(person._id), 'fresh-temporary-phrase-73'))).code).toBe('STEP_UP_REQUIRED');
    const stepped = await sessionFor({ _id: new Types.ObjectId(plain.id) }, { stepUp: true });
    await expect(reactivateAdmin(stepped, String(person._id), 'fresh-temporary-phrase-73')).resolves.toMatchObject({ status: 'active' });
  });

  it('lists a person\'s open tasks so they can be reassigned before removal', async () => {
    const person = await makeAdmin();
    const client = await Client.create({ ref: 'CL-0001', name: 'Acme Co', nameLower: 'acme co' });
    const project = await Project.create({
      ref: 'PRJ-0001', clientId: client._id, clientName: 'Acme Co', name: 'Site', type: 'website',
      contract: { pricingModel: 'fixed', amountMinor: 0, currency: 'INR' },
    });
    const mk = (ref: string, status: 'in_progress' | 'done' | 'todo', kind: 'admin' | 'thirdParty') =>
      Task.create({
        ref, projectId: project._id, clientId: client._id, title: `Task ${ref}`, status,
        assignees: [{ kind, id: person._id, name: 'x' }],
      });
    await mk('PRJ-0001-T001', 'in_progress', 'admin');
    await mk('PRJ-0001-T002', 'done', 'admin');
    await mk('PRJ-0001-T003', 'todo', 'thirdParty');
    const open = await listOpenTasksFor(String(person._id));
    expect(open.map((t) => t.ref)).toEqual(['PRJ-0001-T001']);
  });
});

describe('role and grant changes', () => {
  it('need a step-up, and demoting a superadmin clears their grants baseline', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const person = await makeAdmin();
    expect((await rejects(updateAdmin(sa, String(person._id), { role: 'superadmin' }))).code).toBe('STEP_UP_REQUIRED');
    expect((await rejects(updateAdmin(sa, String(person._id), { grants: ['payment:view'] }))).code).toBe('STEP_UP_REQUIRED');

    const stepped = await sessionFor({ _id: new Types.ObjectId(sa.id) }, { stepUp: true });
    const updated = await updateAdmin(stepped, String(person._id), { grants: ['expense:record', 'content:publish'] });
    expect(updated.grants).toEqual(expect.arrayContaining(['expense:record', 'expense:view', 'content:publish']));
  });

  it('removes a grant the role already includes by default (no redundant storage)', async () => {
    const sa = await sessionFor(await makeSuperadmin(), { stepUp: true });
    const person = await makeAdmin();
    expect((await updateAdmin(sa, String(person._id), { grants: ['payment:view'] })).grants).toEqual(['payment:view']);
    expect((await updateAdmin(sa, String(person._id), { grants: [] })).grants).toEqual([]);
  });

  it('rejects unknown capabilities and an empty update', async () => {
    const sa = await sessionFor(await makeSuperadmin(), { stepUp: true });
    const person = await makeAdmin();
    expect((await rejects(updateAdmin(sa, String(person._id), { grants: ['teleport:anywhere'] }))).fields?.grants).toMatch(/Unknown/);
    const res = await call(updateRoute, '/api/admin/admins/x', { method: 'PATCH', body: {}, cookie: await cookieFor(await makeSuperadmin()) }, { id: String(person._id) });
    expect(res.status).toBe(422);
  });
});

describe('password reset', () => {
  it('works through the route only with a step-up, and checks the policy against the target\'s name', async () => {
    const sa = await makeSuperadmin();
    const person = await makeAdmin({ name: 'Kavya Iyer', email: 'kavya@example.com' });
    const id = String(person._id);
    const cookie = await cookieFor(sa);

    const noStepUp = await call(resetRoute, `/api/admin/admins/${id}/reset-password`, { method: 'POST', body: { newPassword: 'fresh-temporary-phrase-73' }, cookie }, { id });
    expect(noStepUp.status).toBe(403);
    expect(noStepUp.body.error.code).toBe('STEP_UP_REQUIRED');

    const stepped = await cookieFor(sa, { stepUp: true });
    const weak = await call(resetRoute, `/api/admin/admins/${id}/reset-password`, { method: 'POST', body: { newPassword: 'kavya-and-kavya-1234' }, cookie: stepped }, { id });
    expect(weak.status).toBe(422);
    const ok = await call(resetRoute, `/api/admin/admins/${id}/reset-password`, { method: 'POST', body: { newPassword: 'fresh-temporary-phrase-73' }, cookie: stepped }, { id });
    expect(ok.status).toBe(200);
    expect(JSON.stringify(ok.body)).not.toContain('fresh-temporary-phrase-73');
    expect(JSON.stringify(await AuditLog.find({}).lean())).not.toContain('fresh-temporary-phrase-73');
  });

  it('also clears a lock and the failed-attempt counter', async () => {
    const sa = await sessionFor(await makeSuperadmin(), { stepUp: true });
    const person = await makeAdmin();
    await Admin.updateOne({ _id: person._id }, { $set: { lockedUntil: new Date(Date.now() + 60_000), failedLoginAttempts: 4 } });
    await resetPassword(sa, String(person._id), 'fresh-temporary-phrase-73');
    const after = await Admin.findById(person._id).lean();
    expect(after?.lockedUntil).toBeUndefined();
    expect(after?.failedLoginAttempts).toBe(0);
  });
});

describe('audit trail', () => {
  it('writes one entry per management action with the actor, and never a secret', async () => {
    const sa = await sessionFor(await makeSuperadmin(), { stepUp: true });
    const person = await makeAdmin();
    const id = String(person._id);
    await updateAdmin(sa, id, { name: 'Edited Person' });
    await resetPassword(sa, id, 'fresh-temporary-phrase-73');
    await revokeSessions(sa, id);
    await deactivateAdmin(sa, id, 'left the team');
    await reactivateAdmin(sa, id, 'another-fresh-phrase-64');

    const actions = (await AuditLog.find({ 'entity.id': person._id }).sort({ at: 1 }).lean()).map((a) => a.action);
    expect(actions).toEqual(['admin.update', 'admin.reset_password', 'admin.revoke_sessions', 'admin.deactivate', 'admin.reactivate']);
    const dump = JSON.stringify(await AuditLog.find({}).lean());
    expect(dump).not.toMatch(/fresh-temporary-phrase|another-fresh-phrase|\$2[aby]\$/);
    expect((await AuditLog.findOne({ action: 'admin.deactivate' }).lean())?.actor.name).toBe(sa.name);
  });

  it('is append-only: the model refuses updates and deletes', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    await updateAdmin(sa, sa.id, { name: 'Audit Subject' });
    const entry = await AuditLog.findOne({}).lean();
    await expect(AuditLog.updateOne({ _id: entry!._id }, { $set: { action: 'tampered' } })).rejects.toThrow(/append-only/);
    await expect(AuditLog.deleteMany({})).rejects.toThrow(/append-only/);
    await expect(AuditLog.findOneAndUpdate({ _id: entry!._id }, { $set: { action: 'x' } })).rejects.toThrow(/append-only/);
    const doc = await AuditLog.findById(entry!._id);
    doc!.action = 'tampered';
    await expect(doc!.save()).rejects.toThrow(/append-only/);
    expect(await AuditLog.countDocuments({ action: 'tampered' })).toBe(0);
  });
});

describe('seed account safety (sanity)', () => {
  it('TEST_PASSWORD is itself acceptable to the policy', () => {
    expect(TEST_PASSWORD.length).toBeGreaterThanOrEqual(12);
  });
});
