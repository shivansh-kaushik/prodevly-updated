import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as profileGet, PATCH as profilePatch } from '@/app/api/admin/team/profile/route';
import { Admin, AuditLog, TeamRole } from '@/models';
import * as auditModule from '@/services/audit.service';
import {
  capacityMinutes,
  getOwnProfile,
  getTeamMember,
  searchTeam,
  updateOwnProfile,
  utilisationOf,
} from '@/services/team.service';
import { setupTestDb } from '@/test/db';
import { makeClient, makeProject, makeTask } from '@/test/domain-factories';
import { call, cookieFor, makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { day, makeAssignedTask, makeMember, makePayProfile, makeTeamRole, makeWorkLog } from '@/test/team-factories';

setupTestDb();
afterEach(() => vi.restoreAllMocks());

const NOW = new Date('2026-10-12T10:00:00Z'); // 12 Oct 2026 in India
const OCT = { from: day('2026-10-01'), to: day('2026-10-14') };
const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; fields?: Record<string, string> };
  }
  throw new Error('expected the call to be rejected');
};

/** A session that holds only the capabilities given (an admin always holds team:view, so the matrix needs a doctored one). */
async function sessionWithout(...removed: string[]) {
  const s = await sessionFor(await makeAdmin());
  return { ...s, capabilities: new Set([...s.capabilities].filter((c) => !removed.includes(c))) };
}

async function seedWorld() {
  const client = await makeClient();
  const project = await makeProject(client);
  return { client, project };
}

describe('the directory: who may read it', () => {
  it('needs team:view', async () => {
    const viewer = await sessionWithout('team:view');
    expect((await rejects(searchTeam(viewer, OCT))).code).toBe('FORBIDDEN');
    expect((await rejects(getTeamMember(viewer, String((await makeMember())._id), OCT))).code).toBe('FORBIDDEN');
  });

  it('is open to a plain admin and to a superadmin', async () => {
    await makeMember({ name: 'Asha Rao' });
    expect((await searchTeam(await sessionFor(await makeAdmin()), OCT, {}, NOW)).map((m) => m.name)).toContain('Asha Rao');
    expect((await searchTeam(await sessionFor(await makeSuperadmin()), OCT, {}, NOW)).map((m) => m.name)).toContain('Asha Rao');
  });
});

describe('the directory: what it shows', () => {
  it('returns each person with job role, skills, capacity, open tasks, overdue and estimate, and hours in the period', async () => {
    const { project } = await seedWorld();
    const role = await makeTeamRole({ name: 'Frontend developer' });
    const asha = await makeMember({ name: 'Asha Rao', jobRole: role, designation: 'Senior engineer', employmentType: 'full_time', skills: ['React', 'CSS'], weeklyCapacityHours: 40, joinedOn: '2026-01-01' });
    const ben = await makeMember({ name: 'Ben Das' });

    // Asha: two open tasks (one overdue, one with an estimate), one done, one cancelled, one archived
    await makeAssignedTask(project, [asha], { status: 'in_progress', due: '2026-10-10', estimateMinutes: 120 });
    await makeAssignedTask(project, [asha, ben], { status: 'todo', due: '2026-10-20', estimateMinutes: 60 });
    await makeAssignedTask(project, [asha], { status: 'done', due: '2026-10-01' });
    await makeAssignedTask(project, [asha], { status: 'cancelled' });
    await makeAssignedTask(project, [asha], { status: 'todo', archivedAt: new Date() });
    const task = await makeTask(project);
    await makeWorkLog(asha, task, { workedOn: '2026-10-05', minutes: 600 });
    await makeWorkLog(asha, task, { workedOn: '2026-10-14', minutes: 300 }); // last day of the range: counted
    await makeWorkLog(asha, task, { workedOn: '2026-09-30', minutes: 480 }); // before the range
    await makeWorkLog(asha, task, { workedOn: '2026-10-15', minutes: 480 }); // after the range

    const rows = await searchTeam(await sessionFor(await makeAdmin()), OCT, {}, NOW);
    const a = rows.find((r) => r.id === String(asha._id));
    expect(a).toEqual({
      id: String(asha._id),
      name: 'Asha Rao',
      email: asha.email,
      status: 'active',
      jobRole: { id: String(role._id), name: 'Frontend developer', archived: false },
      designation: 'Senior engineer',
      employmentType: 'full_time',
      skills: ['React', 'CSS'],
      weeklyCapacityHours: 40,
      openTasks: 2,
      overdueTasks: 1,
      openEstimateMinutes: 180,
      loggedMinutes: 900,
      // 1-12 Oct is 12 days of capacity: 40 h x 60 x 12 / 7 = 4114 min; 900 / 4114
      utilisationPercent: 21.9,
    });
    const b = rows.find((r) => r.id === String(ben._id));
    expect(b).toMatchObject({ jobRole: null, openTasks: 1, overdueTasks: 0, loggedMinutes: 0, utilisationPercent: null, weeklyCapacityHours: null });
  });

  it('counts a task once per person even when it lists them twice, and ignores third-party assignees', async () => {
    const { project } = await seedWorld();
    const asha = await makeMember({ name: 'Asha Rao' });
    await makeTask(project, {
      status: 'todo',
      assignees: [
        { kind: 'admin', id: asha._id, name: asha.name },
        { kind: 'admin', id: asha._id, name: asha.name },
        { kind: 'thirdParty', id: asha._id, name: 'Not an admin' }, // same id, other kind: must not count
      ],
    });
    const [row] = (await searchTeam(await sessionFor(await makeAdmin()), OCT, { q: 'Asha' }, NOW));
    expect(row?.openTasks).toBe(1);
  });

  it('shows no utilisation for a future period, and none for a removed person', async () => {
    const asha = await makeMember({ name: 'Asha Rao', weeklyCapacityHours: 40 });
    const gone = await makeMember({ name: 'Gone Away', weeklyCapacityHours: 40, status: 'deactivated' });
    const viewer = await sessionFor(await makeAdmin());
    const future = { from: day('2027-01-01'), to: day('2027-01-31') };
    expect((await searchTeam(viewer, future, { q: 'Asha' }, NOW))[0]?.utilisationPercent).toBeNull();
    expect((await searchTeam(viewer, OCT, { status: 'deactivated' }, NOW))[0]).toMatchObject({ id: String(gone._id), utilisationPercent: null });
    expect(String(asha._id)).toBeTruthy();
  });

  it('treats a role that was deleted after being assigned as "no job role"', async () => {
    const role = await makeTeamRole({ name: 'Short-lived' });
    await makeMember({ name: 'Asha Rao', jobRole: role });
    await TeamRole.deleteOne({ _id: role._id });
    const [row] = await searchTeam(await sessionFor(await makeAdmin()), OCT, { q: 'Asha' }, NOW);
    expect(row?.jobRole).toBeNull();
  });
});

describe('the directory: filters and sorting', () => {
  it('lists active people by default, removed ones on request, everyone with "all"', async () => {
    await makeMember({ name: 'Active Person' });
    await makeMember({ name: 'Removed Person', status: 'deactivated' });
    const viewer = await sessionFor(await makeAdmin({ name: 'The Viewer' }));
    const names = async (status?: 'active' | 'deactivated' | 'all') => (await searchTeam(viewer, OCT, { status }, NOW)).map((m) => m.name);
    expect(await names()).toEqual(expect.arrayContaining(['Active Person', 'The Viewer']));
    expect(await names()).not.toContain('Removed Person');
    expect(await names('deactivated')).toEqual(['Removed Person']);
    expect(await names('all')).toEqual(expect.arrayContaining(['Active Person', 'Removed Person']));
  });

  it('filters by job role (and "none"), by employment type, and by search over name, email, title and skills', async () => {
    const dev = await makeTeamRole({ name: 'Developer' });
    const designer = await makeTeamRole({ name: 'Designer' });
    await makeMember({ name: 'Dev One', jobRole: dev, employmentType: 'full_time', skills: ['Node'], designation: 'Backend lead' });
    await makeMember({ name: 'Des One', jobRole: designer, employmentType: 'intern', skills: ['Figma'] });
    await makeMember({ name: 'Nobody Role', email: 'nobody@example.org' });
    const viewer = await sessionFor(await makeAdmin({ name: 'The Viewer' }));
    const find = async (p: Parameters<typeof searchTeam>[2]) => (await searchTeam(viewer, OCT, p, NOW)).map((m) => m.name).sort();

    expect(await find({ jobRole: String(dev._id) })).toEqual(['Dev One']);
    expect(await find({ jobRole: String(dev._id).toUpperCase() })).toEqual(['Dev One']);
    expect(await find({ jobRole: 'none' })).toEqual(['Nobody Role', 'The Viewer']);
    expect(await find({ employmentType: 'intern' })).toEqual(['Des One']);
    expect(await find({ q: 'figma' })).toEqual(['Des One']);
    expect(await find({ q: 'backend' })).toEqual(['Dev One']);
    expect(await find({ q: 'nobody@example.org' })).toEqual(['Nobody Role']);
    expect(await find({ jobRole: String(dev._id), employmentType: 'intern' })).toEqual([]);
  });

  it('matches search text literally: regex characters are not patterns', async () => {
    await makeMember({ name: 'Asha Rao' });
    const viewer = await sessionFor(await makeAdmin());
    expect(await searchTeam(viewer, OCT, { q: '.*' }, NOW)).toEqual([]);
    expect(await searchTeam(viewer, OCT, { q: 'A(' }, NOW)).toEqual([]);
    expect(await searchTeam(viewer, OCT, { q: 'a.ha' }, NOW)).toEqual([]);
  });

  it('rejects a malformed job role or employment type filter instead of a cast error', async () => {
    const viewer = await sessionFor(await makeAdmin());
    expect((await rejects(searchTeam(viewer, OCT, { jobRole: 'nope' }, NOW))).code).toBe('VALIDATION_FAILED');
    expect((await rejects(searchTeam(viewer, OCT, { employmentType: 'weekend' as never }, NOW))).code).toBe('VALIDATION_FAILED');
  });

  it('sorts by name, by open tasks (busiest first) and by hours, with name as the tiebreak', async () => {
    const { project } = await seedWorld();
    const a = await makeMember({ name: 'Anil' });
    const b = await makeMember({ name: 'Bela' });
    const c = await makeMember({ name: 'Chen' });
    await makeAssignedTask(project, [b], { status: 'todo' });
    await makeAssignedTask(project, [b], { status: 'todo' });
    await makeAssignedTask(project, [c], { status: 'todo' });
    const task = await makeTask(project);
    await makeWorkLog(c, task, { workedOn: '2026-10-02', minutes: 300 });
    await makeWorkLog(a, task, { workedOn: '2026-10-02', minutes: 60 });
    const viewer = await sessionFor(await makeAdmin({ name: 'Zed Viewer' }));
    const order = async (sort: Parameters<typeof searchTeam>[2] = {}) => (await searchTeam(viewer, OCT, sort, NOW)).map((m) => m.name);

    expect(await order({ sort: 'name' })).toEqual(['Anil', 'Bela', 'Chen', 'Zed Viewer']);
    expect(await order({ sort: 'name', dir: 'desc' })).toEqual(['Zed Viewer', 'Chen', 'Bela', 'Anil']);
    expect(await order({ sort: 'openTasks' })).toEqual(['Bela', 'Chen', 'Anil', 'Zed Viewer']);
    expect(await order({ sort: 'loggedMinutes' })).toEqual(['Chen', 'Anil', 'Bela', 'Zed Viewer']);
  });

  it('returns one person with getTeamMember, 404 for an unknown or malformed id', async () => {
    const asha = await makeMember({ name: 'Asha Rao', designation: 'Engineer' });
    const viewer = await sessionFor(await makeAdmin());
    expect(await getTeamMember(viewer, String(asha._id), OCT, NOW)).toMatchObject({ id: String(asha._id), designation: 'Engineer' });
    expect((await rejects(getTeamMember(viewer, '5f3a9c0b1d2e4f6a8b7c9d0e', OCT, NOW))).code).toBe('NOT_FOUND');
    expect((await rejects(getTeamMember(viewer, 'nope', OCT, NOW))).code).toBe('NOT_FOUND');
  });
});

describe('pay never travels with the directory', () => {
  it('leaves every pay value out of the directory, a member read and the workload, for every kind of viewer', async () => {
    const asha = await makeMember({ name: 'Asha Rao' });
    await makePayProfile(asha, { basis: 'monthly', rateMinor: 7_777_700, payoutNote: 'IFSC-LEAK-CHECK-5521' });
    for (const viewer of [await sessionFor(await makeAdmin()), await sessionFor(await makeSuperadmin(), { stepUp: true })]) {
      const dump = JSON.stringify([await searchTeam(viewer, OCT, { status: 'all' }, NOW), await getTeamMember(viewer, String(asha._id), OCT, NOW)]);
      expect(dump).not.toContain('7777700');
      expect(dump).not.toContain('IFSC-LEAK-CHECK-5521');
      expect(dump).not.toMatch(/rateMinor|payoutNote|basis|payProfile/i);
    }
  });

  it('does not even import the pay-profile service or model (pay is structurally out of reach)', () => {
    const source = readFileSync(new URL('./team.service.ts', import.meta.url), 'utf8');
    // Only real imports count: the file's own comments say where pay lives.
    expect(source).not.toMatch(/^import[^;]*(pay-profile|PayProfile)/m);
    expect(source).not.toMatch(/\bPayProfile\.(find|aggregate|count)/);
  });
});

describe('capacity maths', () => {
  it('counts only the part of the period that has happened, from the day the person joined', () => {
    const range = { from: day('2026-10-01'), to: day('2026-10-14') };
    expect(capacityMinutes(35, range, day('2026-10-07'))).toBe(35 * 60); // 1-7 Oct is exactly one week
    expect(capacityMinutes(35, range, day('2026-10-31'))).toBe(35 * 60 * 2); // the whole range: two weeks
    expect(capacityMinutes(35, range, day('2026-10-07'), day('2026-10-04'))).toBe(Math.round((35 * 60 * 4) / 7)); // joined on the 4th
    expect(capacityMinutes(35, range, day('2026-09-30'))).toBe(0); // the period has not started
    expect(capacityMinutes(35, range, day('2026-10-31'), day('2026-11-01'))).toBe(0); // joined after it
  });

  it('only gives a ratio when there is a capacity to divide by', () => {
    expect(utilisationOf(100, 0)).toBeNull();
    expect(utilisationOf(0, 100)).toBe(0);
    expect(utilisationOf(1, 3)).toBe(33.3);
  });
});

describe('editing your own profile', () => {
  it('lets a person change their phone, title and skills, tidies the skills, and audits one entry', async () => {
    const me = await makeAdmin({ name: 'Asha Rao' });
    const viewer = await sessionFor(me);
    const dto = await updateOwnProfile(viewer, { phone: '+91 98765 43210', designation: 'Engineer', skills: ['React', ' react ', 'CSS'] });
    expect(dto).toMatchObject({ phone: '+91 98765 43210', designation: 'Engineer', skills: ['React', 'CSS'] });
    const stored = await Admin.findById(me._id).lean();
    expect(stored?.profile).toMatchObject({ phone: '+91 98765 43210', designation: 'Engineer', skills: ['React', 'CSS'] });

    const entries = await AuditLog.find({ action: 'teamProfile.update' }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entity: { type: 'admin', label: 'Asha Rao' }, summary: 'Updated their own profile' });
    expect(entries[0]?.actor.name).toBe('Asha Rao');
  });

  it('clears a field with empty text and writes nothing when nothing changed', async () => {
    const me = await makeMember({ phone: '98765 43210', designation: 'Engineer' });
    const viewer = await sessionFor(me);
    expect((await updateOwnProfile(viewer, { phone: '' })).phone).toBeNull();
    expect((await Admin.findById(me._id).lean())?.profile.phone).toBeUndefined();
    await updateOwnProfile(viewer, { designation: 'Engineer', skills: [] }); // already so
    expect(await AuditLog.countDocuments({ action: 'teamProfile.update' })).toBe(1);
  });

  it('refuses job role, employment type, capacity, role, grants, pay and identity fields, changing nothing', async () => {
    const role = await makeTeamRole({ name: 'Developer' });
    const me = await makeMember({ designation: 'Engineer', employmentType: 'intern', weeklyCapacityHours: 20 });
    const viewer = await sessionFor(me);
    const attempts: Array<Record<string, unknown>> = [
      { jobRoleId: String(role._id) },
      { employmentType: 'full_time' },
      { weeklyCapacityHours: 80 },
      { role: 'superadmin' },
      { grants: ['payment:view'] },
      { payoutNote: 'mine now' },
      { rateMinor: 1 },
      { name: 'Someone Else' },
      { email: 'else@example.com' },
      { designation: 'Boss', status: 'deactivated' }, // a legal field does not smuggle an illegal one through
    ];
    for (const patch of attempts) {
      const err = await rejects(updateOwnProfile(viewer, patch as never));
      expect(err.code, JSON.stringify(patch)).toBe('VALIDATION_FAILED');
    }
    const stored = await Admin.findById(me._id).lean();
    expect(stored).toMatchObject({ role: 'admin', grants: [], status: 'active' });
    expect(stored?.profile).toMatchObject({ designation: 'Engineer', employmentType: 'intern', weeklyCapacityHours: 20 });
    expect(stored?.profile.jobRoleId).toBeUndefined();
    expect(await AuditLog.countDocuments({ action: 'teamProfile.update' })).toBe(0);
  });

  it('only ever writes the signed-in person: nobody else\'s profile changes', async () => {
    const me = await makeMember({ designation: 'Mine' });
    const other = await makeMember({ designation: 'Theirs', phone: '11111 22222' });
    await updateOwnProfile(await sessionFor(me), { designation: 'Mine, updated', phone: '99999 88888' });
    expect((await Admin.findById(other._id).lean())?.profile).toMatchObject({ designation: 'Theirs', phone: '11111 22222' });
  });

  it('cannot save from a session that was revoked, or for an account that was removed', async () => {
    const me = await makeAdmin();
    const stale = await sessionFor(me);
    await Admin.updateOne({ _id: me._id }, { $inc: { tokenVersion: 1 } }); // signed out everywhere
    expect((await rejects(updateOwnProfile(stale, { designation: 'Sneaky' }))).code).toBe('FORBIDDEN');

    const gone = await makeAdmin();
    const goneSession = await sessionFor(gone);
    await Admin.updateOne({ _id: gone._id }, { $set: { status: 'deactivated' } });
    expect((await rejects(updateOwnProfile(goneSession, { designation: 'Sneaky' }))).code).toBe('FORBIDDEN');
    expect(await Admin.countDocuments({ 'profile.designation': 'Sneaky' })).toBe(0);
  });

  it('validates phone, title length and skills', async () => {
    const viewer = await sessionFor(await makeAdmin());
    expect((await rejects(updateOwnProfile(viewer, { phone: 'call me maybe' }))).fields?.phone).toBeTruthy();
    expect((await rejects(updateOwnProfile(viewer, { designation: 'x'.repeat(81) }))).fields?.designation).toBeTruthy();
    expect((await rejects(updateOwnProfile(viewer, { skills: Array.from({ length: 31 }, (_, i) => `s${i}`) }))).fields?.skills).toBeTruthy();
    expect((await rejects(updateOwnProfile(viewer, { skills: ['x'.repeat(41)] }))).code).toBe('VALIDATION_FAILED');
    expect((await rejects(updateOwnProfile(viewer, { skills: ['  '] }))).code).toBe('VALIDATION_FAILED'); // blank skills are not skills
    expect((await rejects(updateOwnProfile(viewer, {} as never))).code).toBe('VALIDATION_FAILED');
  });

  it('is atomic: when the audit write fails, the profile is not changed', async () => {
    const me = await makeMember({ designation: 'Before' });
    vi.spyOn(auditModule, 'audit').mockRejectedValueOnce(new Error('audit down'));
    await rejects(updateOwnProfile(await sessionFor(me), { designation: 'After' }));
    expect((await Admin.findById(me._id).lean())?.profile.designation).toBe('Before');
  });

  it('shows the read-only fields next to the editable ones', async () => {
    const role = await makeTeamRole({ name: 'Developer' });
    const me = await makeMember({ jobRole: role, employmentType: 'part_time', weeklyCapacityHours: 20, skills: ['Go'] });
    expect(await getOwnProfile(await sessionFor(me))).toMatchObject({ jobRole: 'Developer', employmentType: 'part_time', weeklyCapacityHours: 20, skills: ['Go'] });
  });
});

describe('PATCH /api/admin/team/profile', () => {
  it('works for any signed-in admin, and rejects unknown keys with 422', async () => {
    const me = await makeAdmin();
    const cookie = await cookieFor(me);
    const ok = await call(profilePatch, '/api/admin/team/profile', { method: 'PATCH', body: { designation: 'Designer', skills: ['Figma'] }, cookie });
    expect(ok.status).toBe(200);
    expect(ok.body.data.profile).toMatchObject({ designation: 'Designer', skills: ['Figma'] });

    for (const body of [{ role: 'superadmin' }, { grants: ['payment:view'] }, { jobRoleId: '5f3a9c0b1d2e4f6a8b7c9d0e' }, { weeklyCapacityHours: 60 }, { id: String(me._id) }, {}]) {
      const res = await call(profilePatch, '/api/admin/team/profile', { method: 'PATCH', body, cookie });
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    expect((await Admin.findById(me._id).lean())?.role).toBe('admin');
  });

  it('answers 401 without a session and 403 while a password change is pending, and GET returns only your own', async () => {
    expect((await call(profilePatch, '/api/admin/team/profile', { method: 'PATCH', body: { designation: 'X' } })).status).toBe(401);
    const fresh = await makeAdmin({ mustChangePassword: true });
    const pending = await call(profilePatch, '/api/admin/team/profile', { method: 'PATCH', body: { designation: 'X' }, cookie: await cookieFor(fresh) });
    expect(pending.status).toBe(403);
    expect(pending.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const me = await makeMember({ designation: 'Mine' });
    await makeMember({ designation: 'Theirs' });
    const own = await call(profileGet, '/api/admin/team/profile', { cookie: await cookieFor(me) });
    expect(own.body.data.profile.designation).toBe('Mine');
  });
});
