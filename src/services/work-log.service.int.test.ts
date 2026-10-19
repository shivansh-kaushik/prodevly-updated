import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { AuditLog, Project, Settings, Task, WorkLog } from '@/models';
import { createWorkLog, deleteWorkLog, getDayTotal, listMyRecentWorkLogs, listTaskWorkLogs, listWorkLogs, updateWorkLog, workLogAccess } from '@/services/work-log.service';
import { setupTestDb } from '@/test/db';
import { makeAdmin, sessionFor } from '@/test/factories';
import { makeClient, makeProject, makeTask } from '@/test/domain-factories';
import { backdateLog, dayOffset, holding, makeTeamPayout, makeWorkLog, makeWorkspace, without, ymd } from '@/test/task-factories';

setupTestDb();

const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; fields?: Record<string, string>; message: string };
  }
  throw new Error('expected the call to be rejected');
};
const id = (d: { _id: Types.ObjectId }) => String(d._id);
const today = () => ymd(dayOffset(0));
const logInput = (taskId: string, o: Record<string, unknown> = {}) => ({ taskId, workedOn: today(), minutes: 60, note: 'Built the form', ...o });
const cached = async (taskId: Types.ObjectId) => (await Task.findById(taskId).lean())?.loggedMinutes;
const summed = async (taskId: Types.ObjectId) => (await WorkLog.find({ taskId }).lean()).reduce((s, l) => s + l.minutes, 0);

describe('creating an entry', () => {
  it('derives project and client from the task, snapshots the person, audits it and updates the task total', async () => {
    const w = await makeWorkspace();
    const dto = await createWorkLog(w.adminSession, logInput(id(w.task), { minutes: 90, note: '  Wired the API  ' }));
    expect(dto).toMatchObject({
      adminId: w.adminSession.id,
      adminName: w.adminSession.name,
      workedOn: today(),
      minutes: 90,
      note: 'Wired the API',
      billable: false,
      locked: false,
      canEdit: true,
    });
    expect(dto.task).toMatchObject({ id: id(w.task), ref: w.task.ref });
    expect(dto.project).toMatchObject({ id: id(w.project), name: w.project.name });
    expect(dto.clientId).toBe(id(w.client));
    const stored = await WorkLog.findById(dto.id).lean();
    expect(String(stored?.projectId)).toBe(id(w.project));
    expect(String(stored?.clientId)).toBe(id(w.client));
    expect(stored?.workedOn.toISOString()).toBe(`${today()}T00:00:00.000Z`);
    expect(await cached(w.task._id)).toBe(90);

    const entry = await AuditLog.findOne({ action: 'workLog.create' }).lean();
    expect(entry?.actor.name).toBe(w.adminSession.name);
    expect(String(entry?.context.taskId)).toBe(id(w.task));
    expect(String(entry?.context.projectId)).toBe(id(w.project));
    expect(String(entry?.context.clientId)).toBe(id(w.client));
  });

  it('defaults billable to true on hourly projects and false elsewhere, and lets the person choose', async () => {
    const client = await makeClient();
    const hourly = await makeProject(client, { contract: { pricingModel: 'hourly', amountMinor: 0, currency: 'INR', hourlyRateMinor: 150000 } });
    const task = await makeTask(hourly);
    const w = await makeWorkspace();
    expect((await createWorkLog(w.adminSession, logInput(id(task), { minutes: 30 }))).billable).toBe(true);
    expect((await createWorkLog(w.adminSession, logInput(id(task), { minutes: 30, billable: false }))).billable).toBe(false);
    expect((await createWorkLog(w.adminSession, logInput(id(w.task), { minutes: 30 }))).billable).toBe(false);
    expect((await createWorkLog(w.adminSession, logInput(id(w.task), { minutes: 30, billable: true }))).billable).toBe(true);
  });

  it('holds minutes to 5..720 whole minutes, the note to 3..500 characters and the date to a real day that is not in the future', async () => {
    const w = await makeWorkspace();
    for (const minutes of [4, 721, 0, -5, 12.5, Number.NaN]) {
      expect((await rejects(createWorkLog(w.adminSession, logInput(id(w.task), { minutes })))).fields?.minutes, `${minutes}`).toBeDefined();
    }
    await createWorkLog(w.adminSession, logInput(id(w.task), { minutes: 5, workedOn: ymd(dayOffset(-3)) }));
    await createWorkLog(w.adminSession, logInput(id(w.task), { minutes: 720, workedOn: ymd(dayOffset(-4)) }));
    for (const note of ['ab', '   ', 'x'.repeat(501)]) {
      expect((await rejects(createWorkLog(w.adminSession, logInput(id(w.task), { note })))).fields?.note, note.slice(0, 5)).toBeDefined();
    }
    expect((await rejects(createWorkLog(w.adminSession, logInput(id(w.task), { workedOn: ymd(dayOffset(1)) })))).fields?.workedOn).toMatch(/future/);
    for (const workedOn of ['2026-02-30', 'tomorrow', '2026-1-5', '']) {
      expect((await rejects(createWorkLog(w.adminSession, logInput(id(w.task), { workedOn })))).fields?.workedOn, workedOn).toBeDefined();
    }
    expect(await WorkLog.countDocuments({})).toBe(2);
  });

  it('rejects a project or client that does not own the task with LINK_MISMATCH', async () => {
    const w = await makeWorkspace();
    const otherClient = await makeClient();
    const otherProject = await makeProject(otherClient);
    expect((await rejects(createWorkLog(w.adminSession, logInput(id(w.task), { projectId: id(otherProject) })))).code).toBe('LINK_MISMATCH');
    expect((await rejects(createWorkLog(w.adminSession, logInput(id(w.task), { clientId: id(otherClient) })))).code).toBe('LINK_MISMATCH');
    const ok = await createWorkLog(w.adminSession, logInput(id(w.task), { projectId: id(w.project), clientId: id(w.client).toUpperCase() }));
    expect(ok.project.id).toBe(id(w.project));
    expect(await WorkLog.countDocuments({})).toBe(1);
  });

  it('refuses unknown, cancelled and archived tasks and archived projects, and nothing is written', async () => {
    const w = await makeWorkspace();
    expect((await rejects(createWorkLog(w.adminSession, logInput(String(new Types.ObjectId()))))).fields?.taskId).toMatch(/does not exist/);
    expect((await rejects(createWorkLog(w.adminSession, logInput('nope')))).code).toBe('NOT_FOUND');

    const cancelled = await makeTask(w.project, { status: 'cancelled' });
    expect((await rejects(createWorkLog(w.adminSession, logInput(id(cancelled))))).code).toBe('CONFLICT');
    const archivedTask = await makeTask(w.project, { archivedAt: new Date() });
    expect((await rejects(createWorkLog(w.adminSession, logInput(id(archivedTask))))).code).toBe('CONFLICT');
    await Project.updateOne({ _id: w.project._id }, { $set: { archivedAt: new Date() } });
    expect((await rejects(createWorkLog(w.adminSession, logInput(id(w.task))))).code).toBe('CONFLICT');

    expect(await WorkLog.countDocuments({})).toBe(0);
    expect(await AuditLog.countDocuments({})).toBe(0);
  });
});

describe('the 16 hour day', () => {
  it('allows a day to total exactly 16 hours and refuses a minute more, per person and per day', async () => {
    const w = await makeWorkspace();
    await createWorkLog(w.adminSession, logInput(id(w.task), { minutes: 600 }));
    await createWorkLog(w.adminSession, logInput(id(w.task), { minutes: 360 })); // 600 + 360 = 960
    const err = await rejects(createWorkLog(w.adminSession, logInput(id(w.task), { minutes: 5 })));
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields?.minutes).toMatch(/16 hours/);
    // another day is unaffected, and so is another person on the same day
    await createWorkLog(w.adminSession, logInput(id(w.task), { minutes: 600, workedOn: ymd(dayOffset(-1)) }));
    await createWorkLog(w.superSession, logInput(id(w.task), { minutes: 600 }));
    expect(await cached(w.task._id)).toBe(600 + 360 + 600 + 600);
  });

  it('applies to edits too: raising an entry or moving it onto a full day is refused', async () => {
    const w = await makeWorkspace();
    const a = await createWorkLog(w.adminSession, logInput(id(w.task), { minutes: 700 }));
    const b = await createWorkLog(w.adminSession, logInput(id(w.task), { minutes: 200 }));
    expect((await rejects(updateWorkLog(w.adminSession, b.id, { minutes: 300 }))).fields?.minutes).toMatch(/16 hours/);
    const elsewhere = await createWorkLog(w.adminSession, logInput(id(w.task), { minutes: 100, workedOn: ymd(dayOffset(-1)) }));
    expect((await rejects(updateWorkLog(w.adminSession, elsewhere.id, { workedOn: today(), minutes: 100 }))).fields?.minutes).toMatch(/16 hours/);
    // an edit that stays under the cap (excluding the entry itself) is fine
    expect((await updateWorkLog(w.adminSession, a.id, { minutes: 720 })).minutes).toBe(720);
    expect(await cached(w.task._id)).toBe(await summed(w.task._id));
  });

  it('holds under concurrency: two entries that together pass 16 hours cannot both be saved', async () => {
    for (let round = 0; round < 4; round++) {
      await WorkLog.deleteMany({});
      const w = await makeWorkspace();
      const results = await Promise.allSettled([
        createWorkLog(w.adminSession, logInput(id(w.task), { minutes: 500 })),
        createWorkLog(w.adminSession, logInput(id(w.task), { minutes: 500 })),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled'), `round ${round}`).toHaveLength(1);
      const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((loser.reason as { code?: string }).code).toBe('VALIDATION_FAILED');
      expect(await summed(w.task._id)).toBe(500);
      expect(await cached(w.task._id)).toBe(500);
    }
  });

  it('reports the day total for the form warning', async () => {
    const w = await makeWorkspace();
    expect(await getDayTotal(w.adminSession, today())).toEqual({ date: today(), minutes: 0 });
    await createWorkLog(w.adminSession, logInput(id(w.task), { minutes: 400 }));
    await createWorkLog(w.superSession, logInput(id(w.task), { minutes: 100 }));
    expect((await getDayTotal(w.adminSession, today())).minutes).toBe(400); // only mine
    expect((await rejects(getDayTotal(w.adminSession, 'soon'))).fields?.date).toBeDefined();
    expect((await rejects(getDayTotal(without(w.adminSession, 'worklog:own'), today()))).code).toBe('FORBIDDEN');
  });
});

describe('the task total stays equal to the sum of its entries', () => {
  it('after every create, edit and delete, including concurrent writes on one task', async () => {
    const w = await makeWorkspace();
    const check = async () => expect(await cached(w.task._id)).toBe(await summed(w.task._id));
    const a = await createWorkLog(w.adminSession, logInput(id(w.task), { minutes: 45 }));
    await check();
    const b = await createWorkLog(w.superSession, logInput(id(w.task), { minutes: 120, workedOn: ymd(dayOffset(-2)) }));
    await check();
    await updateWorkLog(w.adminSession, a.id, { minutes: 75 });
    await check();
    await updateWorkLog(w.adminSession, a.id, { note: 'Only the note changed' });
    await check();
    expect(await cached(w.task._id)).toBe(195);
    await deleteWorkLog(w.superSession, b.id);
    await check();
    expect(await cached(w.task._id)).toBe(75);

    await Promise.all([
      ...Array.from({ length: 5 }, (_, i) => createWorkLog(w.adminSession, logInput(id(w.task), { minutes: 10, workedOn: ymd(dayOffset(-3 - i)) }))),
      ...Array.from({ length: 5 }, (_, i) => createWorkLog(w.superSession, logInput(id(w.task), { minutes: 20, workedOn: ymd(dayOffset(-3 - i)) }))),
    ]);
    await check();
    expect(await cached(w.task._id)).toBe(75 + 50 + 100);
  });

  it('is atomic: a refused write changes neither the entries, the total nor the audit log', async () => {
    const w = await makeWorkspace();
    await createWorkLog(w.adminSession, logInput(id(w.task), { minutes: 720 }));
    await createWorkLog(w.adminSession, logInput(id(w.task), { minutes: 180 }));
    const audits = await AuditLog.countDocuments({});
    await rejects(createWorkLog(w.adminSession, logInput(id(w.task), { minutes: 100 })));
    expect(await cached(w.task._id)).toBe(900);
    expect(await WorkLog.countDocuments({})).toBe(2);
    expect(await AuditLog.countDocuments({})).toBe(audits);
  });
});

describe('who may change an entry, and until when', () => {
  it('the owner may edit and delete within the window, and not after it; a superadmin always may', async () => {
    const w = await makeWorkspace();
    const log = await makeWorkLog(w.admin, w.task, { minutes: 60 });
    expect((await updateWorkLog(w.adminSession, id(log), { minutes: 90 })).minutes).toBe(90);

    await backdateLog(log._id, 8); // window is 7 days by default
    const late = await rejects(updateWorkLog(w.adminSession, id(log), { minutes: 30 }));
    expect(late.code).toBe('FORBIDDEN');
    expect(late.message).toMatch(/7 days/);
    expect((await rejects(deleteWorkLog(w.adminSession, id(log)))).code).toBe('FORBIDDEN');
    expect((await WorkLog.findById(log._id).lean())?.minutes).toBe(90);

    expect((await updateWorkLog(w.superSession, id(log), { minutes: 30 })).minutes).toBe(30);
    await deleteWorkLog(w.superSession, id(log));
    expect(await WorkLog.countDocuments({})).toBe(0);
  });

  it('follows the window in Settings', async () => {
    const w = await makeWorkspace();
    const log = await makeWorkLog(w.admin, w.task);
    await backdateLog(log._id, 10);
    expect((await rejects(updateWorkLog(w.adminSession, id(log), { minutes: 30 }))).code).toBe('FORBIDDEN');
    await Settings.updateOne({ _id: 'global' }, { $set: { workLogEditWindowDays: 30 } }, { upsert: true });
    expect((await updateWorkLog(w.adminSession, id(log), { minutes: 30 })).minutes).toBe(30);
    await Settings.updateOne({ _id: 'global' }, { $set: { workLogEditWindowDays: 0 } });
    expect((await rejects(updateWorkLog(w.adminSession, id(log), { minutes: 45 }))).code).toBe('FORBIDDEN');
  });

  it('nobody can change an entry covered by a paid payout, a superadmin included (ENTRY_LOCKED)', async () => {
    const w = await makeWorkspace();
    const payout = await makeTeamPayout(w.admin);
    const log = await makeWorkLog(w.admin, w.task, { lockedByPayoutId: payout._id });
    for (const viewer of [w.adminSession, w.superSession]) {
      expect((await rejects(updateWorkLog(viewer, id(log), { minutes: 30 }))).code).toBe('ENTRY_LOCKED');
      expect((await rejects(deleteWorkLog(viewer, id(log)))).code).toBe('ENTRY_LOCKED');
    }
    expect((await WorkLog.findById(log._id).lean())?.minutes).toBe(60);
    expect(await cached(w.task._id)).toBe(60);
    // someone with no business with the entry is told so, not that it is locked
    const stranger = await sessionFor(await makeAdmin());
    expect((await rejects(updateWorkLog(stranger, id(log), { minutes: 30 }))).code).toBe('FORBIDDEN');
  });

  it('another admin cannot touch it, even one who may view everyone\'s logs', async () => {
    const w = await makeWorkspace();
    const log = await makeWorkLog(w.admin, w.task);
    const peer = await sessionFor(await makeAdmin());
    const viewer = holding(peer, 'worklog:own', 'worklog:viewAll');
    for (const who of [peer, viewer]) {
      expect((await rejects(updateWorkLog(who, id(log), { minutes: 30 }))).code).toBe('FORBIDDEN');
      expect((await rejects(deleteWorkLog(who, id(log)))).code).toBe('FORBIDDEN');
    }
    expect((await WorkLog.findById(log._id).lean())?.minutes).toBe(60);
  });

  it('a superadmin may change someone else\'s entry, and the audit entry says whose', async () => {
    const w = await makeWorkspace();
    const log = await makeWorkLog(w.admin, w.task);
    await updateWorkLog(w.superSession, id(log), { minutes: 45, note: 'Corrected by a superadmin' });
    const entry = await AuditLog.findOne({ action: 'workLog.update' }).lean();
    expect(entry?.actor.name).toBe(w.superSession.name);
    expect(entry?.summary).toContain(w.admin.name);
    expect(entry?.changes.map((c) => c.path).sort()).toEqual(['minutes', 'note']);
    await deleteWorkLog(w.superSession, id(log));
    expect((await AuditLog.findOne({ action: 'workLog.delete' }).lean())?.summary).toContain(w.admin.name);
  });

  it('exposes the rule as a pure check the lists can use', () => {
    const now = new Date('2026-10-12T10:00:00Z');
    const log = { adminId: new Types.ObjectId(), createdAt: new Date('2026-10-01T10:00:00Z'), lockedByPayoutId: undefined };
    const owner = { id: String(log.adminId), capabilities: new Set(['worklog:own' as const]) };
    expect(workLogAccess(owner, log, 7, now)).toEqual({ canEdit: false, reason: 'window_closed' });
    expect(workLogAccess(owner, log, 14, now)).toEqual({ canEdit: true });
    expect(workLogAccess({ id: String(new Types.ObjectId()), capabilities: new Set(['worklog:own' as const]) }, log, 14, now)).toEqual({ canEdit: false, reason: 'not_yours' });
    expect(workLogAccess({ ...owner, capabilities: new Set(['worklog:editAll' as const]) }, log, 0, now)).toEqual({ canEdit: true });
  });

  it('an entry that changes nothing writes nothing', async () => {
    const w = await makeWorkspace();
    const dto = await createWorkLog(w.adminSession, logInput(id(w.task), { minutes: 60, note: 'Same note' }));
    const audits = await AuditLog.countDocuments({});
    await updateWorkLog(w.adminSession, dto.id, { minutes: 60, note: 'Same note', billable: false, workedOn: today() });
    expect(await AuditLog.countDocuments({})).toBe(audits);
  });
});

describe('payouts', () => {
  it('time cannot be added to, or moved into, a period a paid payout already covers', async () => {
    const w = await makeWorkspace();
    await makeTeamPayout(w.admin, { periodFrom: dayOffset(-30), periodTo: dayOffset(-10) });
    const err = await rejects(createWorkLog(w.adminSession, logInput(id(w.task), { workedOn: ymd(dayOffset(-15)) })));
    expect(err.code).toBe('ENTRY_LOCKED');
    const open = await createWorkLog(w.adminSession, logInput(id(w.task), { workedOn: ymd(dayOffset(-2)) }));
    expect((await rejects(updateWorkLog(w.adminSession, open.id, { workedOn: ymd(dayOffset(-12)) }))).code).toBe('ENTRY_LOCKED');
    expect(await WorkLog.countDocuments({})).toBe(1);
  });

  it('a void or still-due payout, or someone else\'s payout, does not block', async () => {
    const w = await makeWorkspace();
    const peer = await makeAdmin();
    await makeTeamPayout(w.admin, { status: 'void', periodFrom: dayOffset(-30), periodTo: dayOffset(-10) });
    await makeTeamPayout(w.admin, { status: 'due', periodFrom: dayOffset(-30), periodTo: dayOffset(-10) });
    await makeTeamPayout(peer, { periodFrom: dayOffset(-30), periodTo: dayOffset(-10) });
    expect((await createWorkLog(w.adminSession, logInput(id(w.task), { workedOn: ymd(dayOffset(-15)) }))).workedOn).toBe(ymd(dayOffset(-15)));
  });
});

describe('capability matrix', () => {
  it('creating needs worklog:own; changing needs worklog:own or worklog:editAll', async () => {
    const w = await makeWorkspace();
    const log = await makeWorkLog(w.admin, w.task);
    const none = without(w.superSession, 'worklog:own', 'worklog:editAll');
    expect((await rejects(createWorkLog(without(w.superSession, 'worklog:own'), logInput(id(w.task))))).code).toBe('FORBIDDEN');
    expect((await rejects(updateWorkLog(none, id(log), { minutes: 30 }))).code).toBe('FORBIDDEN');
    expect((await rejects(deleteWorkLog(none, id(log)))).code).toBe('FORBIDDEN');
    expect(await WorkLog.countDocuments({})).toBe(1);
    expect(await AuditLog.countDocuments({})).toBe(0);
    // editAll alone is enough to correct someone else's entry
    const fixer = holding(w.superSession, 'worklog:editAll');
    expect((await updateWorkLog(fixer, id(log), { minutes: 30 })).minutes).toBe(30);
  });

  it('reading: everyone\'s logs need worklog:viewAll, otherwise only your own, and with neither nothing', async () => {
    const w = await makeWorkspace();
    const peer = await makeAdmin();
    await makeWorkLog(w.admin, w.task, { minutes: 30 });
    await makeWorkLog(peer, w.task, { minutes: 50 });
    const viaAll = holding(w.adminSession, 'worklog:own', 'worklog:viewAll');
    expect((await listWorkLogs(viaAll)).totals.minutes).toBe(80);
    const own = await listWorkLogs(w.adminSession, { adminId: id(peer) }); // asking for someone else's is ignored
    expect(own.items.map((l) => l.adminId)).toEqual([id(w.admin)]);
    expect(own.totals).toMatchObject({ minutes: 30, entries: 1, people: 1 });
    expect((await rejects(listWorkLogs(without(w.adminSession, 'worklog:own')))).code).toBe('FORBIDDEN');
    expect((await rejects(listTaskWorkLogs(without(w.adminSession, 'worklog:own'), id(w.task)))).code).toBe('FORBIDDEN');
    expect((await rejects(listMyRecentWorkLogs(without(w.adminSession, 'worklog:own')))).code).toBe('FORBIDDEN');

    const onTask = await listTaskWorkLogs(w.adminSession, id(w.task));
    expect(onTask).toMatchObject({ scope: 'own' });
    expect(onTask.logs).toHaveLength(1);
    expect((await listTaskWorkLogs(viaAll, id(w.task))).logs).toHaveLength(2);
  });
});

describe('listing', () => {
  it('filters by person, project, client, date and billable, and totals cover every match, not just the page', async () => {
    const w = await makeWorkspace();
    const peer = await makeAdmin({ name: 'Peer Person' });
    const otherProject = await makeProject(w.client);
    const otherTask = await makeTask(otherProject);
    const viewer = holding(w.superSession, 'worklog:viewAll', 'worklog:own');
    for (let i = 0; i < 4; i++) await makeWorkLog(w.admin, w.task, { minutes: 30, workedOn: dayOffset(-i), billable: i % 2 === 0 });
    await makeWorkLog(peer, otherTask, { minutes: 100, workedOn: dayOffset(-1), billable: true });

    const all = await listWorkLogs(viewer, { pageSize: 2 });
    expect(all.items).toHaveLength(2);
    expect(all).toMatchObject({ total: 5, totals: { minutes: 220, billableMinutes: 160, entries: 5, people: 2 } });
    expect((await listWorkLogs(viewer, { adminId: id(peer) })).total).toBe(1);
    expect((await listWorkLogs(viewer, { projectId: id(w.project) })).total).toBe(4);
    expect((await listWorkLogs(viewer, { clientId: id(w.client) })).total).toBe(5);
    expect((await listWorkLogs(viewer, { taskId: id(otherTask) })).total).toBe(1);
    expect((await listWorkLogs(viewer, { billable: true })).total).toBe(3);
    expect((await listWorkLogs(viewer, { from: ymd(dayOffset(-1)), to: ymd(dayOffset(0)) })).total).toBe(3);
    expect((await listWorkLogs(viewer, { from: ymd(dayOffset(-1)) })).total).toBe(3);
    expect((await rejects(listWorkLogs(viewer, { from: 'bad' }))).fields?.from).toBeDefined();
    expect((await rejects(listWorkLogs(viewer, { adminId: 'nope' }))).code).toBe('NOT_FOUND');
    const page2 = await listWorkLogs(viewer, { pageSize: 2, page: 3 });
    expect(page2.items).toHaveLength(1);
  });

  it('marks what the viewer can still edit, and what is locked', async () => {
    const w = await makeWorkspace();
    const recent = await makeWorkLog(w.admin, w.task);
    const old = await makeWorkLog(w.admin, w.task);
    await backdateLog(old._id, 20);
    const payout = await makeTeamPayout(w.admin);
    const locked = await makeWorkLog(w.admin, w.task, { lockedByPayoutId: payout._id });
    const mine = await listMyRecentWorkLogs(w.adminSession);
    const flag = (l: { _id: Types.ObjectId }) => mine.find((x) => x.id === id(l));
    expect(flag(recent)).toMatchObject({ canEdit: true, locked: false });
    expect(flag(old)).toMatchObject({ canEdit: false, locked: false });
    expect(flag(locked)).toMatchObject({ canEdit: false, locked: true });
    const asSuper = (await listTaskWorkLogs(w.superSession, id(w.task))).logs;
    expect(asSuper.find((x) => x.id === id(old))?.canEdit).toBe(true);
    expect(asSuper.find((x) => x.id === id(locked))?.canEdit).toBe(false);
    expect(JSON.stringify(mine)).not.toMatch(/lockedByPayoutId|"_id"|passwordHash/);
  });
});
