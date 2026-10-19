import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Admin, AuditLog, ClientPayment, Counter, Expense, Project, Task, ThirdParty, WorkLog } from '@/models';
import {
  archiveTask,
  cancelTask,
  changeTaskStatus,
  countNewlyAssigned,
  createTask,
  deleteTask,
  getBoard,
  getTask,
  listMyTasks,
  reorderTasks,
  restoreTask,
  searchTasks,
  setAssignees,
  updateTask,
} from '@/services/task.service';
import { createWorkLog } from '@/services/work-log.service';
import { setupTestDb } from '@/test/db';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { makeClient, makeProject, makeTask, makeThirdParty } from '@/test/domain-factories';
import { dayOffset, holding, makeWorkLog, makeWorkspace, without, ymd } from '@/test/task-factories';

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

describe('derived links', () => {
  it('derives the client from the project, numbers the task per project and records who and where', async () => {
    const w = await makeWorkspace();
    const dto = await createTask(w.adminSession, { projectId: id(w.project), title: 'Build the form', priority: 'high', dueOn: '2026-12-01', estimateMinutes: 90 });
    expect(dto.ref).toBe(`${w.project.ref}-T002`); // T001 is the fixture task
    expect(dto.project).toMatchObject({ id: id(w.project), clientId: id(w.client), clientName: w.client.name });
    expect(dto).toMatchObject({ status: 'todo', priority: 'high', dueOn: '2026-12-01', estimateMinutes: 90, loggedMinutes: 0, createdBy: w.adminSession.name });
    expect(dto.statusHistory).toHaveLength(1);
    expect(dto.statusHistory[0]).toMatchObject({ from: null, to: 'todo', by: w.adminSession.name });

    const stored = await Task.findById(dto.id).lean();
    expect(String(stored?.clientId)).toBe(id(w.client));
    expect(stored?.dueOn?.toISOString()).toBe('2026-12-01T00:00:00.000Z');

    const entry = await AuditLog.findOne({ action: 'task.create' }).lean();
    expect(entry?.actor.name).toBe(w.adminSession.name);
    expect(String(entry?.context.clientId)).toBe(id(w.client));
    expect(String(entry?.context.projectId)).toBe(id(w.project));
    expect(String(entry?.context.taskId)).toBe(dto.id);
  });

  it('rejects a client that does not own the project with LINK_MISMATCH, and writes nothing', async () => {
    const w = await makeWorkspace();
    const other = await makeClient();
    const before = await Task.countDocuments({});
    const err = await rejects(createTask(w.adminSession, { projectId: id(w.project), clientId: id(other), title: 'Mismatched' }));
    expect(err.code).toBe('LINK_MISMATCH');
    expect(await Task.countDocuments({})).toBe(before);
    expect(await AuditLog.countDocuments({ action: 'task.create' })).toBe(0);
    // the project's counter did not advance either: the transaction rolled back
    expect((await Counter.findById(`task:${w.project.ref}`).lean())?.seq ?? 0).toBe(1); // only the fixture task used T001
  });

  it('accepts the project\'s own client (any hex case) and refuses unknown or archived projects', async () => {
    const w = await makeWorkspace();
    const ok = await createTask(w.adminSession, { projectId: id(w.project), clientId: id(w.client).toUpperCase(), title: 'Same client' });
    expect(ok.project.clientId).toBe(id(w.client));
    expect((await rejects(createTask(w.adminSession, { projectId: String(new Types.ObjectId()), title: 'Nowhere' }))).fields?.projectId).toMatch(/does not exist/);
    await Project.updateOne({ _id: w.project._id }, { $set: { archivedAt: new Date() } });
    expect((await rejects(createTask(w.adminSession, { projectId: id(w.project), title: 'Too late' }))).code).toBe('CONFLICT');
  });

  it('treats a malformed project id as not found, never a cast error', async () => {
    const w = await makeWorkspace();
    expect((await rejects(createTask(w.adminSession, { projectId: 'nope', title: 'Bad id' }))).code).toBe('NOT_FOUND');
  });
});

describe('reference numbers under concurrency', () => {
  it('twelve tasks created at the same instant get twelve distinct, gap-free numbers', async () => {
    const w = await makeWorkspace();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => createTask(w.adminSession, { projectId: id(w.project), title: `Parallel ${i}` })));
    const refs = results.map((r) => r.ref).sort();
    expect(new Set(refs).size).toBe(12);
    const numbers = refs.map((r) => Number(r.slice(-3))).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => i + 2)); // T001 is the fixture
  });
});

describe('status rules', () => {
  it('sets startedAt on the first move to in progress and keeps it; completedAt on done and clears it on reopen', async () => {
    const w = await makeWorkspace();
    const t = await createTask(w.adminSession, { projectId: id(w.project), title: 'Flow' });
    const a = await changeTaskStatus(w.adminSession, t.id, { status: 'in_progress' });
    expect(a.startedAt).not.toBeNull();
    const startedAt = a.startedAt;
    await changeTaskStatus(w.adminSession, t.id, { status: 'blocked' });
    const back = await changeTaskStatus(w.adminSession, t.id, { status: 'in_progress' });
    expect(back.startedAt).toBe(startedAt);
    const done = await changeTaskStatus(w.adminSession, t.id, { status: 'done' });
    expect(done.completedAt).not.toBeNull();
    const reopened = await changeTaskStatus(w.adminSession, t.id, { status: 'in_progress', note: 'Client found a bug' });
    expect(reopened.completedAt).toBeNull();
    expect(reopened.startedAt).toBe(startedAt);
    expect(reopened.statusHistory.map((h) => `${h.from}>${h.to}`)).toEqual(['null>todo', 'todo>in_progress', 'in_progress>blocked', 'blocked>in_progress', 'in_progress>done', 'done>in_progress']);
    expect(reopened.statusHistory.at(-1)).toMatchObject({ note: 'Client found a bug', by: w.adminSession.name });
  });

  it('needs a note to reopen a done or cancelled task, and to cancel', async () => {
    const w = await makeWorkspace();
    const t = await createTask(w.adminSession, { projectId: id(w.project), title: 'Notes' });
    expect((await rejects(changeTaskStatus(w.adminSession, t.id, { status: 'cancelled' }))).fields?.note).toMatch(/cancelling/);
    expect((await rejects(cancelTask(w.adminSession, t.id, '  '))).fields?.note).toBeDefined();
    await cancelTask(w.adminSession, t.id, 'Client dropped the feature');
    expect((await rejects(changeTaskStatus(w.adminSession, t.id, { status: 'todo' }))).fields?.note).toMatch(/reopening/);
    await changeTaskStatus(w.adminSession, t.id, { status: 'todo', note: 'Back on' });
    await changeTaskStatus(w.adminSession, t.id, { status: 'done' });
    expect((await rejects(changeTaskStatus(w.adminSession, t.id, { status: 'in_review' }))).fields?.note).toBeDefined();
    expect((await Task.findById(t.id).lean())?.status).toBe('done'); // refused moves changed nothing
  });

  it('refuses a move to the status it is already in, and lands a moved task at the bottom of its column', async () => {
    const w = await makeWorkspace();
    const a = await createTask(w.adminSession, { projectId: id(w.project), title: 'Task A', status: 'in_progress' });
    const b = await createTask(w.adminSession, { projectId: id(w.project), title: 'Task B' });
    expect((await rejects(changeTaskStatus(w.adminSession, b.id, { status: 'todo' }))).fields?.status).toBeDefined();
    const moved = await changeTaskStatus(w.adminSession, b.id, { status: 'in_progress' });
    expect(moved.order).toBeGreaterThan(a.order);
    expect(a.startedAt).not.toBeNull(); // created in progress
  });

  it('two people moving the same card at once: one wins, the other is told it already moved', async () => {
    const w = await makeWorkspace();
    const t = await createTask(w.adminSession, { projectId: id(w.project), title: 'Contended' });
    const other = await sessionFor(await makeAdmin());
    const results = await Promise.allSettled([changeTaskStatus(w.adminSession, t.id, { status: 'in_progress' }), changeTaskStatus(other, t.id, { status: 'in_progress' })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((loser.reason as { code?: string }).code).toBe('VALIDATION_FAILED');
    expect((await Task.findById(t.id).lean())?.statusHistory).toHaveLength(2);
  });

  it('writes one audit entry per move with before and after', async () => {
    const w = await makeWorkspace();
    await changeTaskStatus(w.adminSession, id(w.task), { status: 'in_review' });
    const entry = await AuditLog.findOne({ action: 'task.status' }).lean();
    expect(entry?.changes).toEqual([{ path: 'status', before: 'todo', after: 'in_review' }]);
  });
});

describe('assignees', () => {
  it('takes names from the records, accepts admins and third parties, and dedupes', async () => {
    const w = await makeWorkspace();
    const dev = await makeAdmin({ name: 'Riya Sen' });
    const vendor = await makeThirdParty({ name: 'Pixel Studio' });
    const dto = await setAssignees(w.adminSession, id(w.task), {
      assignees: [
        { kind: 'admin', id: id(dev) },
        { kind: 'admin', id: id(dev).toUpperCase() },
        { kind: 'thirdParty', id: id(vendor) },
      ],
    });
    expect(dto.assignees.map((a) => `${a.kind}:${a.name}`)).toEqual(['admin:Riya Sen', 'thirdParty:Pixel Studio']);
    expect(dto.assignees.every((a) => a.assignedAt !== null)).toBe(true);
  });

  it('rejects deactivated admins, inactive or archived third parties and unknown ids', async () => {
    const w = await makeWorkspace();
    const gone = await makeAdmin({ status: 'deactivated' });
    const idle = await makeThirdParty({ status: 'inactive' });
    const archived = await makeThirdParty();
    await ThirdParty.updateOne({ _id: archived._id }, { $set: { archivedAt: new Date() } });
    for (const ref of [
      { kind: 'admin' as const, id: id(gone) },
      { kind: 'admin' as const, id: String(new Types.ObjectId()) },
      { kind: 'thirdParty' as const, id: id(idle) },
      { kind: 'thirdParty' as const, id: id(archived) },
      { kind: 'thirdParty' as const, id: id(gone) }, // an admin id offered as a third party
    ]) {
      expect((await rejects(setAssignees(w.adminSession, id(w.task), { assignees: [ref] }))).code).toBe('VALIDATION_FAILED');
    }
    expect((await Task.findById(w.task._id).lean())?.assignees).toHaveLength(0);
  });

  it('keeps someone already on the task even after they are deactivated, and keeps their assignedAt', async () => {
    const w = await makeWorkspace();
    const dev = await makeAdmin();
    const first = await setAssignees(w.adminSession, id(w.task), { assignees: [{ kind: 'admin', id: id(dev) }] });
    await Admin.updateOne({ _id: dev._id }, { $set: { status: 'deactivated' } });
    const colleague = await makeAdmin();
    const next = await setAssignees(w.adminSession, id(w.task), { assignees: [{ kind: 'admin', id: id(dev) }, { kind: 'admin', id: id(colleague) }] });
    expect(next.assignees).toHaveLength(2);
    expect(next.assignees[0]?.assignedAt).toBe(first.assignees[0]?.assignedAt);
  });

  it('audits each person added and removed with task, project and client in context, and nothing when unchanged', async () => {
    const w = await makeWorkspace();
    const a = await makeAdmin({ name: 'Asha' });
    const b = await makeAdmin({ name: 'Bhaskar' });
    await setAssignees(w.adminSession, id(w.task), { assignees: [{ kind: 'admin', id: id(a) }] });
    await setAssignees(w.adminSession, id(w.task), { assignees: [{ kind: 'admin', id: id(b) }] });
    const added = await AuditLog.find({ action: 'task.assign' }).sort({ at: 1 }).lean();
    const removed = await AuditLog.find({ action: 'task.unassign' }).lean();
    expect(added.map((e) => e.summary)).toEqual(['Assigned Asha', 'Assigned Bhaskar']);
    expect(removed.map((e) => e.summary)).toEqual(['Removed Asha']);
    for (const e of [...added, ...removed]) {
      expect(String(e.context.taskId)).toBe(id(w.task));
      expect(String(e.context.projectId)).toBe(id(w.project));
      expect(String(e.context.clientId)).toBe(id(w.client));
    }
    const count = await AuditLog.countDocuments({});
    await setAssignees(w.adminSession, id(w.task), { assignees: [{ kind: 'admin', id: id(b) }] });
    expect(await AuditLog.countDocuments({})).toBe(count);
  });

  it('is atomic: one bad assignee in the list leaves the task and the audit log untouched', async () => {
    const w = await makeWorkspace();
    const good = await makeAdmin();
    await rejects(setAssignees(w.adminSession, id(w.task), { assignees: [{ kind: 'admin', id: id(good) }, { kind: 'admin', id: String(new Types.ObjectId()) }] }));
    expect((await Task.findById(w.task._id).lean())?.assignees).toHaveLength(0);
    expect(await AuditLog.countDocuments({ action: 'task.assign' })).toBe(0);
  });
});

describe('update and moving between projects', () => {
  it('edits fields, clears the due date and estimate with null, and audits only what changed', async () => {
    const w = await makeWorkspace();
    const t = await createTask(w.adminSession, { projectId: id(w.project), title: 'Old title', dueOn: '2026-11-01', estimateMinutes: 60, labels: ['api'] });
    const dto = await updateTask(w.adminSession, t.id, { title: 'New title', dueOn: null, estimateMinutes: null, priority: 'urgent', description: 'Details here' });
    expect(dto).toMatchObject({ title: 'New title', dueOn: null, estimateMinutes: null, priority: 'urgent', description: 'Details here' });
    const entry = await AuditLog.findOne({ action: 'task.update' }).lean();
    expect(entry?.changes.map((c) => c.path).sort()).toEqual(['description', 'dueOn', 'estimateMinutes', 'priority', 'title']);
    const count = await AuditLog.countDocuments({});
    const stamp = (await Task.findById(t.id).lean())?.updatedAt.getTime();
    await updateTask(w.adminSession, t.id, { title: 'New title', priority: 'urgent', dueOn: null, labels: ['api'] });
    expect(await AuditLog.countDocuments({})).toBe(count); // no change, no entry
    expect((await Task.findById(t.id).lean())?.updatedAt.getTime()).toBe(stamp); // and no write at all
  });

  it('moves a task to another project: the client is re-derived and the reference follows the new project', async () => {
    const w = await makeWorkspace();
    const otherClient = await makeClient();
    const target = await makeProject(otherClient);
    const dto = await updateTask(w.adminSession, id(w.task), { projectId: id(target) });
    expect(dto.project.id).toBe(id(target));
    expect(dto.project.clientId).toBe(id(otherClient));
    expect(dto.ref).toBe(`${target.ref}-T001`);
    const entry = await AuditLog.findOne({ action: 'task.update' }).lean();
    expect(entry?.changes.map((c) => c.path)).toEqual(expect.arrayContaining(['ref', 'projectId', 'clientId']));
  });

  it('cannot move once a work log or any money record references the task (HAS_LINKED_RECORDS)', async () => {
    const target = await makeProject(await makeClient());
    const links: Array<[string, (taskId: Types.ObjectId) => Promise<unknown>]> = [
      ['work log', async (taskId) => WorkLog.collection.insertOne({ taskId })],
      ['client payment', async (taskId) => ClientPayment.collection.insertOne({ taskId })],
      ['expense', async (taskId) => Expense.collection.insertOne({ taskId })],
      ['payout', async (taskId) => ThirdParty.db.collection('thirdpartypayouts').insertOne({ taskId })],
      ['work order', async (taskId) => ThirdParty.db.collection('workorders').insertOne({ taskId })],
    ];
    for (const [label, link] of links) {
      const w = await makeWorkspace();
      await link(w.task._id);
      const err = await rejects(updateTask(w.adminSession, id(w.task), { projectId: id(target) }));
      expect(err.code, label).toBe('HAS_LINKED_RECORDS');
      expect(String((await Task.findById(w.task._id).lean())?.projectId), label).toBe(id(w.project));
    }
  });

  it('cannot move into an archived project, and a task that is archived cannot be edited', async () => {
    const w = await makeWorkspace();
    const archivedTarget = await makeProject(w.client, { archivedAt: new Date() });
    expect((await rejects(updateTask(w.adminSession, id(w.task), { projectId: id(archivedTarget) }))).code).toBe('CONFLICT');
    await archiveTask(w.adminSession, id(w.task));
    expect((await rejects(updateTask(w.adminSession, id(w.task), { title: 'Edit while archived' }))).code).toBe('CONFLICT');
    expect((await rejects(changeTaskStatus(w.adminSession, id(w.task), { status: 'done' }))).code).toBe('CONFLICT');
    expect((await rejects(setAssignees(w.adminSession, id(w.task), { assignees: [] }))).code).toBe('CONFLICT');
  });
});

describe('reordering a board column', () => {
  it('sets the order top to bottom, appends unlisted tasks, and does not touch updatedAt', async () => {
    const w = await makeWorkspace();
    const mk = (title: string) => createTask(w.adminSession, { projectId: id(w.project), title, status: 'backlog' });
    const [a, b, c] = [await mk('Task A'), await mk('Task B'), await mk('Task C')];
    const before = await Task.findById(c.id).lean();
    const result = await reorderTasks(w.adminSession, { projectId: id(w.project), status: 'backlog', orderedIds: [c.id, a.id] });
    expect(result.orderedIds).toEqual([c.id, a.id, b.id]);
    const orders = Object.fromEntries((await Task.find({ projectId: w.project._id, status: 'backlog' }).lean()).map((t) => [t.title, t.order]));
    expect(orders).toEqual({ 'Task C': 1, 'Task A': 2, 'Task B': 3 });
    expect((await Task.findById(c.id).lean())?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
    expect(await AuditLog.countDocuments({ action: 'task.reorder' })).toBe(1);
    await reorderTasks(w.adminSession, { projectId: id(w.project), status: 'backlog', orderedIds: [c.id, a.id, b.id] });
    expect(await AuditLog.countDocuments({ action: 'task.reorder' })).toBe(1); // no change, no entry
  });

  it('refuses ids that are not in that column of that project', async () => {
    const w = await makeWorkspace();
    const other = await makeTask(await makeProject(w.client));
    const err = await rejects(reorderTasks(w.adminSession, { projectId: id(w.project), status: 'todo', orderedIds: [id(w.task), id(other)] }));
    expect(err.code).toBe('LINK_MISMATCH');
    const wrongColumn = await rejects(reorderTasks(w.adminSession, { projectId: id(w.project), status: 'done', orderedIds: [id(w.task)] }));
    expect(wrongColumn.code).toBe('LINK_MISMATCH');
  });
});

describe('archive, restore and permanent delete', () => {
  it('archives and restores, keeping the task, and refuses doing either twice', async () => {
    const w = await makeWorkspace();
    expect((await archiveTask(w.adminSession, id(w.task))).archived).toBe(true);
    expect((await rejects(archiveTask(w.adminSession, id(w.task)))).code).toBe('CONFLICT');
    expect((await searchTasks(w.adminSession)).items).toHaveLength(0);
    expect((await searchTasks(w.adminSession, { archived: true })).items).toHaveLength(1);
    expect((await restoreTask(w.adminSession, id(w.task))).archived).toBe(false);
    expect((await rejects(restoreTask(w.adminSession, id(w.task)))).code).toBe('CONFLICT');
  });

  it('only a superadmin deletes, and only when nothing links to the task', async () => {
    const w = await makeWorkspace();
    expect((await rejects(deleteTask(w.adminSession, id(w.task)))).code).toBe('FORBIDDEN');
    expect(await Task.countDocuments({ _id: w.task._id })).toBe(1);

    await makeWorkLog(w.admin, w.task);
    expect((await rejects(deleteTask(w.superSession, id(w.task)))).code).toBe('HAS_LINKED_RECORDS');
    await WorkLog.deleteMany({});
    await Expense.collection.insertOne({ taskId: w.task._id });
    expect((await rejects(deleteTask(w.superSession, id(w.task)))).code).toBe('HAS_LINKED_RECORDS');
    await Expense.collection.deleteMany({});

    await deleteTask(w.superSession, id(w.task));
    expect(await Task.countDocuments({ _id: w.task._id })).toBe(0);
    const entry = await AuditLog.findOne({ action: 'task.delete' }).lean();
    expect(entry?.entity.ref).toBe(w.task.ref);
    expect(String(entry?.context.projectId)).toBe(id(w.project));
  });
});

describe('capability matrix', () => {
  it('every write needs task:edit, delete needs task:delete, reads need task:view: FORBIDDEN and nothing written', async () => {
    const w = await makeWorkspace();
    const noEdit = without(w.superSession, 'task:edit');
    const calls: Array<[string, () => Promise<unknown>]> = [
      ['create', () => createTask(noEdit, { projectId: id(w.project), title: 'Nope' })],
      ['update', () => updateTask(noEdit, id(w.task), { title: 'Nope' })],
      ['status', () => changeTaskStatus(noEdit, id(w.task), { status: 'done' })],
      ['cancel', () => cancelTask(noEdit, id(w.task), 'reason here')],
      ['assignees', () => setAssignees(noEdit, id(w.task), { assignees: [] })],
      ['reorder', () => reorderTasks(noEdit, { projectId: id(w.project), status: 'todo', orderedIds: [id(w.task)] })],
      ['archive', () => archiveTask(noEdit, id(w.task))],
      ['restore', () => restoreTask(noEdit, id(w.task))],
      ['delete (plain admin)', () => deleteTask(w.adminSession, id(w.task))],
      ['delete (no capability)', () => deleteTask(without(w.superSession, 'task:delete'), id(w.task))],
    ];
    for (const [label, run] of calls) expect((await rejects(run())).code, label).toBe('FORBIDDEN');
    const noView = without(w.superSession, 'task:view');
    for (const run of [() => searchTasks(noView), () => getBoard(noView), () => getTask(noView, id(w.task)), () => listMyTasks(noView)]) {
      expect((await rejects(run())).code).toBe('FORBIDDEN');
    }
    expect(await Task.countDocuments({})).toBe(1);
    expect(await AuditLog.countDocuments({})).toBe(0);
    expect((await Task.findById(w.task._id).lean())?.title).toBe(w.task.title);
  });

  it('a plain admin can do every day-to-day write on any task, not just their own', async () => {
    const w = await makeWorkspace();
    const dto = await createTask(w.adminSession, { projectId: id(w.project), title: 'Admin made this' });
    await updateTask(w.adminSession, dto.id, { priority: 'low' });
    await changeTaskStatus(w.adminSession, id(w.task), { status: 'in_progress' }); // a task they did not create
    await cancelTask(w.adminSession, dto.id, 'Not needed any more');
    expect((await Task.findById(dto.id).lean())?.status).toBe('cancelled');
  });
});

describe('reading', () => {
  it('filters by status, assignee, project and overdue, and matches search text literally', async () => {
    const w = await makeWorkspace();
    const dev = await makeAdmin();
    const other = await makeProject(w.client);
    await makeTask(w.project, { title: 'a.b literal', status: 'in_progress', dueOn: dayOffset(-3), assignees: [{ kind: 'admin', id: dev._id, name: dev.name }] });
    await makeTask(w.project, { title: 'axb not a match', status: 'done', dueOn: dayOffset(-5) });
    await makeTask(other, { title: 'Elsewhere', status: 'backlog' });

    expect((await searchTasks(w.adminSession, { q: 'a.b' })).items.map((t) => t.title)).toEqual(['a.b literal']);
    expect((await searchTasks(w.adminSession, { q: '.*' })).total).toBe(0);
    expect((await searchTasks(w.adminSession, { status: 'open' })).total).toBe(3); // fixture + in progress + backlog
    expect((await searchTasks(w.adminSession, { status: 'done' })).total).toBe(1);
    expect((await searchTasks(w.adminSession, { projectId: id(other) })).total).toBe(1);
    expect((await searchTasks(w.adminSession, { assignee: { kind: 'admin', id: id(dev) } })).total).toBe(1);
    expect((await searchTasks(w.adminSession, { assignee: 'unassigned', status: 'open' })).total).toBe(2);
    const overdue = await searchTasks(w.adminSession, { overdue: true });
    expect(overdue.items.map((t) => t.title)).toEqual(['a.b literal']); // the done task is not overdue
    expect(overdue.items[0]?.overdue).toBe(true);
    expect((await searchTasks(w.adminSession, { clientId: id(w.client) })).total).toBe(4);
  });

  it('sorts by due date with undated tasks last either way, and pages with a true total', async () => {
    const w = await makeWorkspace({ task: { title: 'No date' } });
    await makeTask(w.project, { title: 'Later', dueOn: dayOffset(10) });
    await makeTask(w.project, { title: 'Sooner', dueOn: dayOffset(2) });
    const asc = await searchTasks(w.adminSession, { sort: 'dueOn', dir: 'asc' });
    expect(asc.items.map((t) => t.title)).toEqual(['Sooner', 'Later', 'No date']);
    const desc = await searchTasks(w.adminSession, { sort: 'dueOn', dir: 'desc' });
    expect(desc.items.map((t) => t.title)).toEqual(['Later', 'Sooner', 'No date']);
    const page = await searchTasks(w.adminSession, { sort: 'title', dir: 'asc', pageSize: 2, page: 2 });
    expect(page).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(page.items).toHaveLength(1);
  });

  it('builds a board with every status, honest totals and the board order inside open columns', async () => {
    const w = await makeWorkspace({ task: { title: 'First', status: 'todo', order: 1 } });
    await makeTask(w.project, { title: 'Second', status: 'todo', order: 2 });
    await makeTask(w.project, { title: 'Zero', status: 'todo', order: 0 });
    await makeTask(w.project, { title: 'Shipped', status: 'done' });
    const board = await getBoard(w.adminSession, {}, 2);
    expect(board.map((c) => c.status)).toEqual(['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled']);
    const todo = board.find((c) => c.status === 'todo');
    expect(todo?.total).toBe(3);
    expect(todo?.tasks.map((t) => t.title)).toEqual(['Zero', 'First']); // limit 2 of 3, in board order
    expect(board.find((c) => c.status === 'done')?.total).toBe(1);
    expect(board.find((c) => c.status === 'blocked')).toMatchObject({ total: 0, tasks: [] });
  });

  it('lists my open tasks soonest-due first and flags those assigned since my last visit', async () => {
    const w = await makeWorkspace();
    const me = w.adminSession;
    const mine = { kind: 'admin' as const, id: w.admin._id, name: w.admin.name };
    const old = new Date(Date.now() - 3 * 86_400_000);
    await makeTask(w.project, { title: 'Old', dueOn: dayOffset(9), assignees: [{ ...mine, assignedAt: old }] });
    await makeTask(w.project, { title: 'Fresh', dueOn: dayOffset(1), assignees: [{ ...mine, assignedAt: new Date() }] });
    await makeTask(w.project, { title: 'Done already', status: 'done', assignees: [{ ...mine, assignedAt: new Date() }] });
    await makeTask(w.project, { title: 'Not mine' });
    const since = new Date(Date.now() - 86_400_000);
    const { tasks, newCount } = await listMyTasks(me, { since });
    expect(tasks.map((t) => t.title)).toEqual(['Fresh', 'Old']);
    expect(tasks.map((t) => t.isNew)).toEqual([true, false]);
    expect(newCount).toBe(1);
    expect(await countNewlyAssigned(me, since)).toBe(1);
    expect(await countNewlyAssigned(me, null)).toBe(0);
    expect((await listMyTasks(me)).newCount).toBe(0); // no baseline: nothing is "new"
  });

  it('getTask returns the full DTO with history, and 404s a bad or unknown id', async () => {
    const w = await makeWorkspace();
    const dto = await getTask(w.adminSession, id(w.task));
    expect(dto.statusHistory).toEqual([]); // fixtures bypass the service
    expect(JSON.stringify(dto)).not.toMatch(/"_id"|"__v"/);
    expect((await rejects(getTask(w.adminSession, 'nope'))).code).toBe('NOT_FOUND');
    expect((await rejects(getTask(w.adminSession, String(new Types.ObjectId())))).code).toBe('NOT_FOUND');
  });

  it('never exposes anything beyond the task\'s own fields (no hashes, no admin records)', async () => {
    const w = await makeWorkspace();
    const dev = await makeSuperadmin();
    await setAssignees(w.adminSession, id(w.task), { assignees: [{ kind: 'admin', id: id(dev) }] });
    const json = JSON.stringify(await getTask(holding(w.adminSession, 'task:view'), id(w.task)));
    expect(json).not.toMatch(/passwordHash|email|\$2[aby]\$/);
    expect(ymd(dayOffset(0))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('races with work logs', () => {
  const today = () => ymd(dayOffset(0));

  it('a task deleted while time is being logged on it never leaves an orphan entry', async () => {
    for (let round = 0; round < 5; round++) {
      await WorkLog.deleteMany({});
      const w = await makeWorkspace();
      const results = await Promise.allSettled([
        deleteTask(w.superSession, id(w.task)),
        createWorkLog(w.superSession, { taskId: id(w.task), workedOn: today(), minutes: 30, note: 'Racing the delete' }),
      ]);
      const taskLeft = await Task.countDocuments({ _id: w.task._id });
      const logs = await WorkLog.countDocuments({ taskId: w.task._id });
      // either the log won (task stays, delete refused) or the delete won (no log): never a log without its task
      expect(taskLeft === 1 ? logs === 1 : logs === 0, `round ${round}: task ${taskLeft}, logs ${logs}`).toBe(true);
      expect(results.filter((r) => r.status === 'fulfilled').length, `round ${round}`).toBe(1);
    }
  });

  it('a task moved to another project while time is being logged keeps the log\'s project equal to the task\'s', async () => {
    for (let round = 0; round < 5; round++) {
      await WorkLog.deleteMany({});
      const w = await makeWorkspace();
      const target = await makeProject(await makeClient());
      await Promise.allSettled([
        updateTask(w.adminSession, id(w.task), { projectId: id(target) }),
        createWorkLog(w.adminSession, { taskId: id(w.task), workedOn: today(), minutes: 30, note: 'Racing the move' }),
      ]);
      const task = await Task.findById(w.task._id).lean();
      for (const log of await WorkLog.find({ taskId: w.task._id }).lean()) {
        expect(String(log.projectId), `round ${round}`).toBe(String(task?.projectId));
        expect(String(log.clientId), `round ${round}`).toBe(String(task?.clientId));
      }
    }
  });

  it('will not restore a task into an archived project', async () => {
    const w = await makeWorkspace();
    await archiveTask(w.adminSession, id(w.task));
    await Project.updateOne({ _id: w.project._id }, { $set: { archivedAt: new Date() } });
    expect((await rejects(restoreTask(w.adminSession, id(w.task)))).code).toBe('CONFLICT');
  });
});
