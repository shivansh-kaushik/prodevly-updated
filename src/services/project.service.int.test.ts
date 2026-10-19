import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { PROJECT_STATUSES, PROJECT_TRANSITIONS, type ProjectStatus } from '@/config/statuses';
import { todayDateOnly } from '@/lib/dates/date-only';
import { withTransaction } from '@/lib/db/mongoose';
import { isReopen, moveNeedsNote, moveNeedsSuperadmin } from '@/lib/validation/project';
import { AuditLog, Client, Counter, Project, Task } from '@/models';
import {
  addMilestone,
  archiveProject,
  changeProjectStatus,
  createProject,
  createProjectInTx,
  getClientOption,
  getProject,
  listProjects,
  removeMilestone,
  restoreProject,
  updateMilestone,
  updateProject,
} from '@/services/project.service';
import { setupTestDb } from '@/test/db';
import { makeClient, makeProject, makeTask } from '@/test/domain-factories';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import {
  D,
  makeExpense,
  makePayment,
  makeTeamPayout,
  makeThirdPartyPayout,
  makeWorkLog,
  makeWorkOrder,
  viewerWith,
} from '@/test/project-factories';

setupTestDb();

const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; fields?: Record<string, string>; message?: string };
  }
  throw new Error('expected the call to be rejected');
};

const superadmin = async () => sessionFor(await makeSuperadmin());
const plainAdmin = async () => sessionFor(await makeAdmin());
/** An admin granted payment access: payment:record (which brings payment:view). */
const payer = async () => sessionFor(await makeAdmin({ grants: ['payment:record', 'payment:view'] }));

const base = (clientId: unknown, o: Record<string, unknown> = {}) => ({ clientId: String(clientId), name: 'Website rebuild', type: 'website' as const, ...o });
const FIXED = { pricingModel: 'fixed' as const, amountMinor: 1_000_000, currency: 'INR' };

async function setup() {
  const viewer = await superadmin();
  const client = await makeClient({ name: 'Acme Robotics' });
  return { viewer, client };
}

const writes = async () => ({ projects: await Project.countDocuments({}), audits: await AuditLog.countDocuments({ action: /^project\./ }) });

describe('who may do what', () => {
  it('needs project:view to list or read, and answers FORBIDDEN', async () => {
    const { viewer, client } = await setup();
    const project = await makeProject(client);
    const blind = viewerWith(viewer, { remove: ['project:view'] });
    expect((await rejects(listProjects(blind))).code).toBe('FORBIDDEN');
    expect((await rejects(getProject(blind, String(project._id)))).code).toBe('FORBIDDEN');
  });

  it('needs project:edit for every write, and writes nothing without it', async () => {
    const { viewer, client } = await setup();
    const project = await makeProject(client, { contract: { ...FIXED }, status: 'proposal' });
    const noEdit = viewerWith(viewer, { remove: ['project:edit'] });
    const id = String(project._id);
    const before = await writes();
    const calls = [
      createProject(noEdit, base(client._id)),
      updateProject(noEdit, id, { name: 'Renamed' }),
      changeProjectStatus(noEdit, id, { to: 'active' }),
      addMilestone(noEdit, id, { title: 'First', amountMinor: 100 }),
      updateMilestone(noEdit, id, String(new Types.ObjectId()), { title: 'x1' }),
      removeMilestone(noEdit, id, String(new Types.ObjectId())),
    ];
    for (const c of calls) expect((await rejects(c)).code).toBe('FORBIDDEN');
    expect(await writes()).toEqual(before);
    expect((await Project.findById(project._id).lean())?.name).toBe(project.name);
  });

  it('needs payment:record to set a contract, a cost budget or a milestone', async () => {
    const { client } = await setup();
    const admin = await plainAdmin();
    const project = await makeProject(client, { contract: { ...FIXED } });
    const id = String(project._id);

    expect((await rejects(createProject(admin, base(client._id, { contract: FIXED })))).code).toBe('FORBIDDEN');
    expect((await rejects(createProject(admin, base(client._id, { costBudgetInrMinor: 5000 })))).code).toBe('FORBIDDEN');
    expect((await rejects(updateProject(admin, id, { contract: { amountMinor: 5 } }))).code).toBe('FORBIDDEN');
    expect((await rejects(updateProject(admin, id, { costBudgetInrMinor: 5 }))).code).toBe('FORBIDDEN');
    expect((await rejects(addMilestone(admin, id, { title: 'First', amountMinor: 100 }))).code).toBe('FORBIDDEN');
    expect(await Project.countDocuments({})).toBe(1);

    // everything that is not money still works for them
    expect((await updateProject(admin, id, { name: 'A better name' })).name).toBe('A better name');
    expect((await createProject(admin, base(client._id))).status).toBe('proposal');
  });

  it('shows contract, milestones, the agreed price and the budget only with payment:view', async () => {
    const { viewer, client } = await setup();
    const created = await createProject(viewer, base(client._id, { status: 'active', contract: FIXED, costBudgetInrMinor: 400_000 }));
    await addMilestone(viewer, created.id, { title: 'Design', amountMinor: 250_000 });

    const plain = await getProject(await plainAdmin(), created.id);
    expect(plain.money).toBeNull();
    expect(JSON.stringify(plain)).not.toMatch(/1000000|250000|400000/);
    expect(plain.agreed).toMatchObject({ capturedBy: viewer.name }); // scope and deadline are not money

    const paid = await getProject(await payer(), created.id);
    expect(paid.money?.contract).toMatchObject({ amountMinor: 1_000_000, currency: 'INR', pricingModel: 'fixed' });
    expect(paid.money?.milestones).toHaveLength(1);
    expect(paid.money).toMatchObject({ costBudgetInrMinor: 400_000, agreedAmount: { amountMinor: 1_000_000, currency: 'INR' } });
  });

  it('archives and restores only with project:archive', async () => {
    const { client } = await setup();
    const project = await makeProject(client);
    const id = String(project._id);
    expect((await rejects(archiveProject(await plainAdmin(), id))).code).toBe('FORBIDDEN');
    expect((await rejects(restoreProject(await plainAdmin(), id))).code).toBe('FORBIDDEN');
    const granted = await sessionFor(await makeAdmin({ grants: ['project:archive'] }));
    expect((await archiveProject(granted, id, 'Done')).archivedAt).not.toBeNull();
  });

  it('answers 404 for a malformed id, never a cast error', async () => {
    const { viewer } = await setup();
    expect((await rejects(getProject(viewer, 'nope'))).code).toBe('NOT_FOUND');
    expect((await rejects(updateProject(viewer, 'nope', { name: 'Whatever' }))).code).toBe('NOT_FOUND');
    expect((await rejects(changeProjectStatus(viewer, 'nope', { to: 'active' }))).code).toBe('NOT_FOUND');
    expect((await rejects(getProject(viewer, String(new Types.ObjectId())))).code).toBe('NOT_FOUND');
  });
});

describe('create', () => {
  it('derives the client name and a PRJ reference, records the first status and audits it', async () => {
    const { viewer, client } = await setup();
    const first = await createProject(viewer, base(client._id));
    expect(first).toMatchObject({ ref: 'PRJ-0001', clientId: String(client._id), clientName: 'Acme Robotics', status: 'proposal', health: 'on_track', priority: 'medium', agreed: null });
    expect(first.statusHistory).toMatchObject([{ from: null, to: 'proposal', by: viewer.name }]);
    expect((await createProject(viewer, base(client._id, { name: 'Second one' }))).ref).toBe('PRJ-0002');

    const entry = await AuditLog.findOne({ action: 'project.create', 'entity.ref': 'PRJ-0001' }).lean();
    expect(entry).toMatchObject({ actor: { name: viewer.name }, entity: { type: 'project', label: 'Website rebuild' } });
    expect(String(entry?.context.projectId)).toBe(first.id);
    expect(String(entry?.context.clientId)).toBe(String(client._id));
  });

  it('refuses a client that does not exist or is archived', async () => {
    const { viewer, client } = await setup();
    expect((await rejects(createProject(viewer, base(new Types.ObjectId())))).fields?.clientId).toBeDefined();
    await Client.updateOne({ _id: client._id }, { $set: { archivedAt: new Date() } });
    expect((await rejects(createProject(viewer, base(client._id)))).fields?.clientId).toBeDefined();
    expect(await Project.countDocuments({})).toBe(0);
  });

  it('refuses a contract currency that is not enabled', async () => {
    const { viewer, client } = await setup();
    const err = await rejects(createProject(viewer, base(client._id, { contract: { ...FIXED, currency: 'CHF' } })));
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields?.['contract.currency']).toMatch(/not enabled/);
    const ok = await createProject(viewer, base(client._id, { contract: { ...FIXED, currency: 'USD', amountMinor: 500_000 } }));
    expect(ok.money?.contract).toMatchObject({ currency: 'USD', amountMinor: 500_000 });
  });

  it('keeps a lead as a member, and only accepts active admins', async () => {
    const { viewer, client } = await setup();
    const lead = await makeAdmin({ name: 'Lena Lead' });
    const member = await makeAdmin({ name: 'Mo Member' });
    const created = await createProject(viewer, base(client._id, { leadId: String(lead._id), memberIds: [String(member._id), String(member._id)] }));
    expect(created.lead).toEqual({ id: String(lead._id), name: 'Lena Lead' });
    expect(created.memberIds.sort()).toEqual([String(lead._id), String(member._id)].sort());

    const gone = await makeAdmin({ status: 'deactivated' });
    expect((await rejects(createProject(viewer, base(client._id, { leadId: String(gone._id) })))).fields?.leadId).toBeDefined();
    expect((await rejects(createProject(viewer, base(client._id, { memberIds: [String(new Types.ObjectId())] })))).fields?.memberIds).toBeDefined();
  });

  it('refuses a deadline before the start date', async () => {
    const { viewer, client } = await setup();
    const err = await rejects(createProject(viewer, base(client._id, { startOn: '2026-08-10', deadlineOn: '2026-08-01' })));
    expect(err.fields?.deadlineOn).toMatch(/before the start/);
    const ok = await createProject(viewer, base(client._id, { startOn: '2026-08-01', deadlineOn: '2026-08-01' }));
    expect(ok).toMatchObject({ startOn: '2026-08-01', deadlineOn: '2026-08-01' });
  });

  it('captures the agreed snapshot at creation only when the project starts active', async () => {
    const { viewer, client } = await setup();
    const proposal = await createProject(viewer, base(client._id, { contract: FIXED }));
    expect(proposal.agreed).toBeNull();
    const active = await createProject(
      viewer,
      base(client._id, { status: 'active', contract: FIXED, deadlineOn: '2026-12-01', scopeSummary: 'Marketing site, five pages' }),
    );
    expect(active.agreed).toMatchObject({ scope: 'Marketing site, five pages', deadlineOn: '2026-12-01', capturedBy: viewer.name });
    expect(active.money?.agreedAmount).toEqual({ amountMinor: 1_000_000, currency: 'INR' });
  });

  it('keeps only web links with a real address, and tidies tags', async () => {
    const { viewer, client } = await setup();
    const created = await createProject(viewer, base(client._id, { links: { live: 'https://acme.example', repo: '' }, tags: ['a', 'a', ' b '] }));
    expect(created.links).toEqual({ repo: null, staging: null, live: 'https://acme.example', design: null });
    expect(created.tags).toEqual(['a', 'b']);
  });

  it('is atomic: a failed create leaves no project, no audit entry and does not advance the counter', async () => {
    const { viewer, client } = await setup();
    await rejects(createProject(viewer, base(client._id, { leadId: String(new Types.ObjectId()) })));
    expect(await writes()).toEqual({ projects: 0, audits: 0 });
    expect(await Counter.findById('project').lean()).toBeNull();
    expect((await createProject(viewer, base(client._id))).ref).toBe('PRJ-0001');
  });

  it('createProjectInTx joins the caller\'s transaction and rolls back with it', async () => {
    const { viewer, client } = await setup();
    const boom = new Error('later step failed');
    const err = await rejects(
      withTransaction(async (session) => {
        await createProjectInTx(viewer, base(client._id), session, {}, { summary: 'Converted from enquiry ENQ-0001' });
        throw boom;
      }),
    );
    expect(err).toBe(boom);
    expect(await writes()).toEqual({ projects: 0, audits: 0 });
    expect(await Counter.findById('project').lean()).toBeNull();

    const kept = await withTransaction((session) => createProjectInTx(viewer, base(client._id), session, {}, { summary: 'Converted from enquiry ENQ-0001' }));
    expect(kept.ref).toBe('PRJ-0001');
    expect((await AuditLog.findOne({ action: 'project.create' }).lean())?.summary).toBe('Converted from enquiry ENQ-0001');
  });

  it('createProjectInTx sees a client created in the same transaction', async () => {
    const viewer = await superadmin();
    const project = await withTransaction(async (session) => {
      const [client] = await Client.create([{ ref: 'CL-9001', name: 'Fresh Client', kind: 'company', status: 'prospect' }], { session });
      return createProjectInTx(viewer, base(client!._id), session);
    });
    expect(project.clientName).toBe('Fresh Client');
  });

  it('createProjectInTx checks the capability itself', async () => {
    const { viewer, client } = await setup();
    const noEdit = viewerWith(viewer, { remove: ['project:edit'] });
    const err = await rejects(withTransaction((session) => createProjectInTx(noEdit, base(client._id), session)));
    expect(err.code).toBe('FORBIDDEN');
  });
});

describe('update', () => {
  it('audits exactly what changed, with before and after', async () => {
    const { viewer, client } = await setup();
    const created = await createProject(viewer, base(client._id));
    const after = await updateProject(viewer, created.id, { name: 'Renamed project', health: 'at_risk', deadlineOn: '2026-12-31' });
    expect(after).toMatchObject({ name: 'Renamed project', health: 'at_risk', deadlineOn: '2026-12-31' });

    const entry = await AuditLog.findOne({ action: 'project.update' }).lean();
    expect(entry?.changes.map((c) => c.path).sort()).toEqual(['deadlineOn', 'health', 'name']);
    expect(entry?.changes.find((c) => c.path === 'health')).toMatchObject({ before: 'on_track', after: 'at_risk' });
  });

  it('clears optional fields with null or an empty string', async () => {
    const { viewer, client } = await setup();
    const created = await createProject(viewer, base(client._id, { startOn: '2026-08-01', deadlineOn: '2026-09-01', scopeSummary: 'Scope', links: { live: 'https://a.example' } }));
    const cleared = await updateProject(viewer, created.id, { deadlineOn: null, scopeSummary: '', links: { live: '' } });
    expect(cleared).toMatchObject({ deadlineOn: null, scopeSummary: null, startOn: '2026-08-01' });
    expect(cleared.links.live).toBeNull();
  });

  it('writes nothing when nothing changed', async () => {
    const { viewer, client } = await setup();
    const created = await createProject(viewer, base(client._id));
    await updateProject(viewer, created.id, { name: created.name });
    expect(await AuditLog.countDocuments({ action: 'project.update' })).toBe(0);
  });

  it('checks the deadline against the stored start date', async () => {
    const { viewer, client } = await setup();
    const created = await createProject(viewer, base(client._id, { startOn: '2026-08-10' }));
    expect((await rejects(updateProject(viewer, created.id, { deadlineOn: '2026-08-01' }))).fields?.deadlineOn).toBeDefined();
  });

  it('refuses to change an archived project until it is restored', async () => {
    const { viewer, client } = await setup();
    const created = await createProject(viewer, base(client._id));
    await archiveProject(viewer, created.id);
    expect((await rejects(updateProject(viewer, created.id, { name: 'Nope' }))).code).toBe('CONFLICT');
    expect((await rejects(changeProjectStatus(viewer, created.id, { to: 'active' }))).code).toBe('CONFLICT');
    await restoreProject(viewer, created.id);
    expect((await updateProject(viewer, created.id, { name: 'Fine now' })).name).toBe('Fine now');
  });

  it('changes the lead, keeps the old one as a member, and ignores a deactivated member on unrelated edits', async () => {
    const { viewer, client } = await setup();
    const a = await makeAdmin({ name: 'Ann Lead' });
    const b = await makeAdmin({ name: 'Bo Newlead' });
    const created = await createProject(viewer, base(client._id, { leadId: String(a._id) }));

    const changed = await updateProject(viewer, created.id, { leadId: String(b._id) });
    expect(changed.lead).toEqual({ id: String(b._id), name: 'Bo Newlead' });
    expect(changed.memberIds.sort()).toEqual([String(a._id), String(b._id)].sort());

    await updateProject(viewer, created.id, { leadId: null });
    expect((await getProject(viewer, created.id)).lead).toBeNull();

    // Ann leaves the company; an unrelated edit must still work, and re-adding her must not
    await (await import('@/models')).Admin.updateOne({ _id: a._id }, { $set: { status: 'deactivated' } });
    expect((await updateProject(viewer, created.id, { priority: 'high' })).priority).toBe('high');
    expect((await rejects(updateProject(viewer, created.id, { memberIds: [String(a._id), String(b._id), String(new Types.ObjectId())] }))).fields?.memberIds).toBeDefined();
  });

  describe('moving to another client', () => {
    it('is allowed while nothing refers to the project, and the tasks and the name snapshot follow', async () => {
      const { viewer, client } = await setup();
      const other = await makeClient({ name: 'Other Client' });
      const project = await makeProject(client, { contract: { ...FIXED } });
      const task = await makeTask(project);

      const moved = await updateProject(viewer, String(project._id), { clientId: String(other._id) });
      expect(moved).toMatchObject({ clientId: String(other._id), clientName: 'Other Client' });
      expect(String((await Task.findById(task._id).lean())?.clientId)).toBe(String(other._id));
      const entry = await AuditLog.findOne({ action: 'project.update' }).lean();
      expect(entry?.changes.map((c) => c.path)).toEqual(expect.arrayContaining(['clientId', 'clientName']));
      expect(String(entry?.context.clientId)).toBe(String(other._id));
    });

    const referenced: Array<[string, (p: Awaited<ReturnType<typeof makeProject>>, c: Awaited<ReturnType<typeof makeClient>>) => Promise<unknown>]> = [
      ['a work log', async (p) => makeWorkLog(p, await makeTask(p), await makeAdmin())],
      ['a client payment', (p) => makePayment(p, { amountMinor: 1000 })],
      ['a third-party payout', (p) => makeThirdPartyPayout(p, { amountMinor: 1000, status: 'due', dueOn: '2026-07-01' })],
      ['a project expense', (p) => makeExpense({ project: p, amountMinor: 1000 })],
      ['a team payout allocation', (p) => makeTeamPayout({ amountMinor: 1000, allocations: [{ project: p, amountMinor: 500 }] })],
      ['a work order', (p) => makeWorkOrder(p, { agreedMinor: 1000 })],
    ];
    it.each(referenced)('is refused once %s refers to the project', async (_name, reference) => {
      const { viewer, client } = await setup();
      const other = await makeClient({ name: 'Other Client' });
      const project = await makeProject(client);
      await reference(project, client);
      const err = await rejects(updateProject(viewer, String(project._id), { clientId: String(other._id) }));
      expect(err.code).toBe('LINK_MISMATCH');
      expect(err.fields?.clientId).toMatch(/cannot move to another client/);
      expect(String((await Project.findById(project._id).lean())?.clientId)).toBe(String(client._id));
    });

    it('is refused to an archived client, and staying put is not a move', async () => {
      const { viewer, client } = await setup();
      const other = await makeClient({ name: 'Other Client' });
      await Client.updateOne({ _id: other._id }, { $set: { archivedAt: new Date() } });
      const project = await makeProject(client);
      await makePayment(project, { amountMinor: 1000 });
      expect((await rejects(updateProject(viewer, String(project._id), { clientId: String(other._id) }))).code).toBe('LINK_MISMATCH');
      // the same client is fine even with money recorded
      expect((await updateProject(viewer, String(project._id), { clientId: String(client._id), name: 'Same client' })).name).toBe('Same client');
    });
  });

  describe('contract', () => {
    it('edits the contract and audits the money change', async () => {
      const { viewer, client } = await setup();
      const created = await createProject(viewer, base(client._id, { contract: FIXED }));
      const after = await updateProject(viewer, created.id, { contract: { amountMinor: 2_000_000, hourlyRateMinor: 150_000 }, costBudgetInrMinor: 900_000 });
      expect(after.money).toMatchObject({ contract: { amountMinor: 2_000_000, hourlyRateMinor: 150_000, currency: 'INR' }, costBudgetInrMinor: 900_000 });
      const paths = (await AuditLog.findOne({ action: 'project.update' }).lean())?.changes.map((c) => c.path);
      expect(paths).toEqual(expect.arrayContaining(['contract.amountMinor', 'contract.hourlyRateMinor', 'costBudgetInrMinor']));
    });

    it('fixes the contract currency once milestones or payments exist', async () => {
      const { viewer, client } = await setup();
      const withMilestone = await createProject(viewer, base(client._id, { contract: FIXED }));
      expect((await updateProject(viewer, withMilestone.id, { contract: { currency: 'USD' } })).money?.contract.currency).toBe('USD');
      await addMilestone(viewer, withMilestone.id, { title: 'Design', amountMinor: 1000 });
      expect((await rejects(updateProject(viewer, withMilestone.id, { contract: { currency: 'EUR' } }))).code).toBe('CONFLICT');

      const withPayment = await makeProject(client, { contract: { ...FIXED } });
      await makePayment(withPayment, { amountMinor: 1000 });
      expect((await rejects(updateProject(viewer, String(withPayment._id), { contract: { currency: 'USD' } }))).code).toBe('CONFLICT');
    });

    it('cannot drop below the milestones already added, for fixed and milestone pricing only', async () => {
      const { viewer, client } = await setup();
      const created = await createProject(viewer, base(client._id, { contract: FIXED }));
      await addMilestone(viewer, created.id, { title: 'Design', amountMinor: 600_000 });
      expect((await rejects(updateProject(viewer, created.id, { contract: { amountMinor: 500_000 } }))).fields?.['contract.amountMinor']).toBeDefined();
      // an hourly project bills by the milestone, so there is no cap
      const hourly = await updateProject(viewer, created.id, { contract: { pricingModel: 'hourly', amountMinor: 0 } });
      expect(hourly.money?.contract).toMatchObject({ pricingModel: 'hourly', amountMinor: 0 });
    });

    it('never touches the agreed snapshot', async () => {
      const { viewer, client } = await setup();
      const created = await createProject(viewer, base(client._id, { status: 'active', contract: FIXED, deadlineOn: '2026-12-01', scopeSummary: 'Original scope' }));
      await updateProject(viewer, created.id, { contract: { amountMinor: 9_000_000 }, deadlineOn: '2027-03-01', scopeSummary: 'Bigger scope' });
      const doc = await Project.findById(created.id).lean();
      expect(doc?.agreed).toMatchObject({ amountMinor: 1_000_000, scope: 'Original scope' });
      expect(doc?.agreed?.deadlineOn?.toISOString().slice(0, 10)).toBe('2026-12-01');
      expect(doc?.contract.amountMinor).toBe(9_000_000);
    });
  });
});

describe('status transitions', () => {
  async function projectIn(status: ProjectStatus) {
    const client = await makeClient();
    return makeProject(client, { status, contract: { ...FIXED }, statusHistory: [] });
  }
  const reset = (id: Types.ObjectId, status: ProjectStatus) =>
    Project.updateOne({ _id: id }, { $set: { status, statusHistory: [] }, $unset: { deliveredOn: 1, agreed: 1 } });

  it('allows exactly the moves in the transition table, for every pair', async () => {
    const sa = await superadmin();
    const project = await projectIn('proposal');
    const id = String(project._id);
    const wrong: string[] = [];
    for (const from of PROJECT_STATUSES) {
      for (const to of PROJECT_STATUSES) {
        await reset(project._id, from);
        const allowed = PROJECT_TRANSITIONS[from].includes(to);
        let outcome: string;
        try {
          await changeProjectStatus(sa, id, { to, note: 'Because it is needed' });
          outcome = 'ok';
        } catch (e) {
          outcome = (e as { code?: string }).code ?? 'error';
        }
        if (allowed !== (outcome === 'ok')) wrong.push(`${from} -> ${to}: ${outcome}`);
        if (!allowed && outcome !== 'CONFLICT') wrong.push(`${from} -> ${to}: expected CONFLICT, got ${outcome}`);
        const stored = (await Project.findById(id).lean())?.status;
        if (stored !== (allowed ? to : from)) wrong.push(`${from} -> ${to}: stored ${stored}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('asks for a note exactly when the move is to on hold, cancelled or a reopen', async () => {
    const sa = await superadmin();
    const project = await projectIn('proposal');
    const id = String(project._id);
    const wrong: string[] = [];
    for (const from of PROJECT_STATUSES) {
      for (const to of PROJECT_TRANSITIONS[from]) {
        await reset(project._id, from);
        let outcome = 'ok';
        let fields: Record<string, string> | undefined;
        try {
          await changeProjectStatus(sa, id, { to });
        } catch (e) {
          outcome = (e as { code?: string }).code ?? 'error';
          fields = (e as { fields?: Record<string, string> }).fields;
        }
        const needs = to === 'on_hold' || to === 'cancelled' || (to === 'active' && ['delivered', 'closed', 'cancelled'].includes(from));
        if (needs !== (outcome === 'VALIDATION_FAILED' && Boolean(fields?.note))) wrong.push(`${from} -> ${to} needs=${needs} got ${outcome}`);
        if (!needs && outcome !== 'ok') wrong.push(`${from} -> ${to} should not need a note`);
        // the pure rule the dialog uses agrees with the service
        if (moveNeedsNote(from, to) !== needs) wrong.push(`${from} -> ${to} moveNeedsNote disagrees`);
      }
    }
    expect(wrong).toEqual([]);
    expect(isReopen('closed', 'active')).toBe(true);
    expect(moveNeedsSuperadmin('delivered', 'active')).toBe(false);
  });

  it('treats a note of only spaces as no note', async () => {
    const sa = await superadmin();
    const project = await projectIn('active');
    expect((await rejects(changeProjectStatus(sa, String(project._id), { to: 'on_hold', note: '   ' }))).fields?.note).toBeDefined();
  });

  it('lets only a superadmin reopen a closed or cancelled project, but any editor take a delivered one back to active', async () => {
    const admin = await plainAdmin();
    const sa = await superadmin();
    for (const from of ['closed', 'cancelled'] as const) {
      const project = await projectIn(from);
      const id = String(project._id);
      expect((await rejects(changeProjectStatus(admin, id, { to: 'active', note: 'Client came back' }))).code).toBe('FORBIDDEN');
      expect((await Project.findById(id).lean())?.status).toBe(from);
      expect((await changeProjectStatus(sa, id, { to: 'active', note: 'Client came back' })).status).toBe('active');
    }
    const delivered = await projectIn('delivered');
    expect((await rejects(changeProjectStatus(admin, String(delivered._id), { to: 'active' }))).fields?.note).toBeDefined();
    expect((await changeProjectStatus(admin, String(delivered._id), { to: 'active', note: 'Found a defect' })).status).toBe('active');
  });

  it('does not tell a viewer who may not reopen that a note is missing', async () => {
    const admin = await plainAdmin();
    const project = await projectIn('closed');
    expect((await rejects(changeProjectStatus(admin, String(project._id), { to: 'active' }))).code).toBe('FORBIDDEN');
  });

  it('answers CONFLICT for the status it is already in', async () => {
    const sa = await superadmin();
    const project = await projectIn('active');
    expect((await rejects(changeProjectStatus(sa, String(project._id), { to: 'active' }))).code).toBe('CONFLICT');
  });

  it('keeps a history entry and an audit entry for every move', async () => {
    const sa = await superadmin();
    const project = await projectIn('active');
    const id = String(project._id);
    await changeProjectStatus(sa, id, { to: 'on_hold', note: 'Waiting for content' });
    await changeProjectStatus(sa, id, { to: 'active' });

    const history = (await getProject(sa, id)).statusHistory;
    expect(history).toMatchObject([
      { from: 'active', to: 'on_hold', by: sa.name, note: 'Waiting for content' },
      { from: 'on_hold', to: 'active', by: sa.name, note: null },
    ]);
    const audits = await AuditLog.find({ action: 'project.status' }).sort({ at: 1 }).lean();
    expect(audits.map((a) => a.changes[0])).toMatchObject([{ path: 'status', before: 'active', after: 'on_hold' }, { path: 'status', before: 'on_hold', after: 'active' }]);
    expect(audits[0]?.summary).toBe('Waiting for content');
  });

  it('sets deliveredOn when delivered, and clears it when the project goes back to active', async () => {
    const sa = await superadmin();
    const project = await projectIn('in_review');
    const id = String(project._id);
    const delivered = await changeProjectStatus(sa, id, { to: 'delivered' });
    const today = todayDateOnly(new Date(), 'Asia/Kolkata').toISOString().slice(0, 10);
    expect(delivered.deliveredOn).toBe(today);

    const maintained = await changeProjectStatus(sa, id, { to: 'maintenance' });
    expect(maintained.deliveredOn).toBe(today); // still a delivered project
    await reset(project._id, 'delivered');
    await Project.updateOne({ _id: project._id }, { $set: { deliveredOn: D('2026-01-01') } });
    const back = await changeProjectStatus(sa, id, { to: 'active', note: 'Defect found' });
    expect(back.deliveredOn).toBeNull();
  });

  describe('the agreed snapshot', () => {
    it('is written once, when the project first becomes active', async () => {
      const sa = await superadmin();
      const client = await makeClient();
      const created = await createProject(sa, base(client._id, { contract: FIXED, deadlineOn: '2026-12-01', scopeSummary: 'Original scope' }));
      expect(created.agreed).toBeNull();

      const active = await changeProjectStatus(sa, created.id, { to: 'active' });
      expect(active.agreed).toMatchObject({ scope: 'Original scope', deadlineOn: '2026-12-01', capturedBy: sa.name });
      expect(active.money?.agreedAmount).toEqual({ amountMinor: 1_000_000, currency: 'INR' });
    });

    it('never changes afterwards, however the project moves or the contract drifts', async () => {
      const sa = await superadmin();
      const client = await makeClient();
      const created = await createProject(sa, base(client._id, { contract: FIXED, deadlineOn: '2026-12-01', scopeSummary: 'Original scope' }));
      await changeProjectStatus(sa, created.id, { to: 'active' });
      const first = (await Project.findById(created.id).lean())?.agreed;

      await updateProject(sa, created.id, { contract: { amountMinor: 7_000_000 }, deadlineOn: '2027-06-01', scopeSummary: 'Much bigger' });
      await changeProjectStatus(sa, created.id, { to: 'in_review' });
      await changeProjectStatus(sa, created.id, { to: 'active' }); // active again
      await changeProjectStatus(sa, created.id, { to: 'on_hold', note: 'Paused' });
      await changeProjectStatus(sa, created.id, { to: 'active' });
      await changeProjectStatus(sa, created.id, { to: 'cancelled', note: 'Client left' });
      await changeProjectStatus(sa, created.id, { to: 'active', note: 'Client returned' }); // reopened

      const last = (await Project.findById(created.id).lean())?.agreed;
      expect(last).toEqual(first);
      expect(last).toMatchObject({ amountMinor: 1_000_000, scope: 'Original scope' });
    });

    it('is written at the first activation even when that comes after a cancellation', async () => {
      const sa = await superadmin();
      const client = await makeClient();
      const created = await createProject(sa, base(client._id, { contract: FIXED }));
      await changeProjectStatus(sa, created.id, { to: 'cancelled', note: 'Never started' });
      expect((await Project.findById(created.id).lean())?.agreed).toBeUndefined();
      await updateProject(sa, created.id, { contract: { amountMinor: 3_000_000 } }); // a cancelled project can still be edited
      const reopened = await changeProjectStatus(sa, created.id, { to: 'active', note: 'Client confirmed' });
      expect(reopened.agreed).not.toBeNull();
    });
  });
});

describe('milestones', () => {
  async function fixedProject(amountMinor = 1_000_000) {
    const sa = await superadmin();
    const client = await makeClient();
    const created = await createProject(sa, base(client._id, { contract: { pricingModel: 'fixed', amountMinor, currency: 'INR' } }));
    return { sa, client, created };
  }

  it('adds a pending milestone in the contract currency, and audits it', async () => {
    const { sa, created } = await fixedProject();
    const after = await addMilestone(sa, created.id, { title: 'Design sign-off', amountMinor: 250_000, dueOn: '2026-09-15', invoiceRef: 'INV-12' });
    expect(after.money?.milestones).toMatchObject([{ title: 'Design sign-off', amountMinor: 250_000, status: 'pending', dueOn: '2026-09-15', invoiceRef: 'INV-12' }]);
    const entry = await AuditLog.findOne({ action: 'project.update' }).lean();
    expect(entry?.summary).toBe('Added milestone "Design sign-off"');
    expect(entry?.changes[0]).toMatchObject({ path: 'milestones', after: { amountMinor: 250_000, currency: 'INR' } });
  });

  it('cannot add up to more than a fixed or milestone contract', async () => {
    const { sa, created } = await fixedProject(1_000_000);
    await addMilestone(sa, created.id, { title: 'Half', amountMinor: 600_000 });
    expect((await rejects(addMilestone(sa, created.id, { title: 'Too much', amountMinor: 500_000 }))).fields?.amountMinor).toMatch(/more than the contract/);
    expect((await addMilestone(sa, created.id, { title: 'Exactly the rest', amountMinor: 400_000 })).money?.milestones).toHaveLength(2);
  });

  it('asks for the contract amount first when it is still zero', async () => {
    const { sa, created } = await fixedProject(0);
    expect((await rejects(addMilestone(sa, created.id, { title: 'First', amountMinor: 1000 }))).fields?.amountMinor).toMatch(/Set the contract amount first/);
  });

  it('has no cap on an hourly or retainer project, where each milestone is an invoice', async () => {
    const sa = await superadmin();
    const client = await makeClient();
    const created = await createProject(sa, base(client._id, { contract: { pricingModel: 'hourly', amountMinor: 0, currency: 'INR' } }));
    await addMilestone(sa, created.id, { title: 'June invoice', amountMinor: 5_000_000 });
    expect((await addMilestone(sa, created.id, { title: 'July invoice', amountMinor: 7_000_000 })).money?.milestones).toHaveLength(2);
  });

  it('allows at most 50 milestones', async () => {
    const sa = await superadmin();
    const client = await makeClient();
    const created = await createProject(sa, base(client._id, { contract: { pricingModel: 'hourly', amountMinor: 0, currency: 'INR' } }));
    await Project.updateOne({ _id: created.id }, { $set: { milestones: Array.from({ length: 50 }, (_, i) => ({ title: `Invoice ${i + 1}`, amountMinor: 100, status: 'pending' })) } });
    expect((await rejects(addMilestone(sa, created.id, { title: 'One more', amountMinor: 100 }))).code).toBe('VALIDATION_FAILED');
  });

  it('updates title, amount, due date, invoice reference and status, and can clear the optional ones', async () => {
    const { sa, created } = await fixedProject();
    const withOne = await addMilestone(sa, created.id, { title: 'Design', amountMinor: 200_000, dueOn: '2026-09-01', invoiceRef: 'INV-1' });
    const mid = withOne.money!.milestones[0]!.id;

    const invoiced = await updateMilestone(sa, created.id, mid, { status: 'invoiced', amountMinor: 300_000, title: 'Design and prototype' });
    expect(invoiced.money?.milestones[0]).toMatchObject({ status: 'invoiced', amountMinor: 300_000, title: 'Design and prototype', dueOn: '2026-09-01' });
    const cleared = await updateMilestone(sa, created.id, mid, { dueOn: null, invoiceRef: null, status: 'paid' });
    expect(cleared.money?.milestones[0]).toMatchObject({ status: 'paid', dueOn: null, invoiceRef: null });
    expect(await AuditLog.countDocuments({ action: 'project.update' })).toBe(3);
  });

  it('keeps the contract cap when a milestone amount grows', async () => {
    const { sa, created } = await fixedProject(1_000_000);
    await addMilestone(sa, created.id, { title: 'A', amountMinor: 400_000 });
    const withB = await addMilestone(sa, created.id, { title: 'B', amountMinor: 400_000 });
    expect((await rejects(updateMilestone(sa, created.id, withB.money!.milestones[1]!.id, { amountMinor: 700_000 }))).fields?.amountMinor).toBeDefined();
    expect((await updateMilestone(sa, created.id, withB.money!.milestones[1]!.id, { amountMinor: 600_000 })).money?.milestones[1]?.amountMinor).toBe(600_000);
  });

  it('removes a pending milestone with nothing against it', async () => {
    const { sa, created } = await fixedProject();
    const withOne = await addMilestone(sa, created.id, { title: 'Design', amountMinor: 200_000 });
    const gone = await removeMilestone(sa, created.id, withOne.money!.milestones[0]!.id);
    expect(gone.money?.milestones).toEqual([]);
    expect((await AuditLog.findOne({ summary: 'Removed milestone "Design"' }).lean())?.changes[0]?.path).toMatch(/^milestones\./);
  });

  it('will not remove an invoiced or paid milestone, or one a payment refers to', async () => {
    const { sa, created } = await fixedProject();
    let state = await addMilestone(sa, created.id, { title: 'Invoiced', amountMinor: 100_000 });
    state = await addMilestone(sa, created.id, { title: 'Pending with payment', amountMinor: 100_000 });
    const [invoiced, withPayment] = state.money!.milestones;
    await updateMilestone(sa, created.id, invoiced!.id, { status: 'invoiced' });
    expect((await rejects(removeMilestone(sa, created.id, invoiced!.id))).code).toBe('CONFLICT');

    const project = await Project.findById(created.id).lean();
    await makePayment(project!, { amountMinor: 1000, milestoneId: new Types.ObjectId(withPayment!.id) });
    expect((await rejects(removeMilestone(sa, created.id, withPayment!.id))).code).toBe('HAS_LINKED_RECORDS');
    expect((await getProject(sa, created.id)).money?.milestones).toHaveLength(2);
  });

  it('answers 404 for a milestone that is not on this project, and for a malformed id', async () => {
    const { sa, created } = await fixedProject();
    expect((await rejects(updateMilestone(sa, created.id, String(new Types.ObjectId()), { title: 'Nothing' }))).code).toBe('NOT_FOUND');
    expect((await rejects(removeMilestone(sa, created.id, 'bad'))).code).toBe('NOT_FOUND');
  });

  it('needs project:edit and payment:record, and refuses an archived project', async () => {
    const { sa, created } = await fixedProject();
    const noPay = viewerWith(sa, { remove: ['payment:record'] });
    expect((await rejects(addMilestone(noPay, created.id, { title: 'Nope', amountMinor: 100 }))).code).toBe('FORBIDDEN');
    expect((await rejects(addMilestone(await plainAdmin(), created.id, { title: 'Nope', amountMinor: 100 }))).code).toBe('FORBIDDEN');
    await archiveProject(sa, created.id);
    expect((await rejects(addMilestone(sa, created.id, { title: 'Nope', amountMinor: 100 }))).code).toBe('CONFLICT');
    expect((await Project.findById(created.id).lean())?.milestones).toHaveLength(0);
  });
});

describe('archive and restore', () => {
  it('hides an archived project from default lists, keeps it readable, and audits both ways', async () => {
    const { viewer, client } = await setup();
    const created = await createProject(viewer, base(client._id));
    await createProject(viewer, base(client._id, { name: 'Another project' }));

    const archived = await archiveProject(viewer, created.id, 'Finished and billed');
    expect(archived.archivedAt).not.toBeNull();
    expect((await listProjects(viewer)).items.map((i) => i.name)).toEqual(['Another project']);
    expect((await listProjects(viewer, { archived: 'only' })).items.map((i) => i.id)).toEqual([created.id]);
    expect((await listProjects(viewer, { archived: 'include' })).meta.total).toBe(2);
    expect((await getProject(viewer, created.id)).archivedAt).not.toBeNull();

    expect((await rejects(archiveProject(viewer, created.id))).code).toBe('CONFLICT');
    expect((await restoreProject(viewer, created.id)).archivedAt).toBeNull();
    expect((await rejects(restoreProject(viewer, created.id))).code).toBe('CONFLICT');
    expect((await AuditLog.find({ action: /^project\.(archive|restore)$/ }).lean()).map((a) => a.action).sort()).toEqual(['project.archive', 'project.restore']);
  });
});

describe('list', () => {
  it('filters by status, health, type, client, lead and member', async () => {
    const { viewer, client } = await setup();
    const other = await makeClient({ name: 'Zed Industries' });
    const lead = await makeAdmin({ name: 'Lead Person' });
    await makeProject(client, { name: 'Alpha', status: 'active', health: 'at_risk', type: 'website', lead: { id: lead._id, name: lead.name }, memberIds: [lead._id] });
    await makeProject(client, { name: 'Beta', status: 'proposal', type: 'saas' });
    await makeProject(other, { name: 'Gamma', status: 'active', type: 'saas' });

    const names = async (q: Parameters<typeof listProjects>[1]) => (await listProjects(viewer, { ...q, sort: 'name', dir: 'asc' })).items.map((i) => i.name);
    expect(await names({ status: 'active' })).toEqual(['Alpha', 'Gamma']);
    expect(await names({ health: 'at_risk' })).toEqual(['Alpha']);
    expect(await names({ type: 'saas' })).toEqual(['Beta', 'Gamma']);
    expect(await names({ clientId: String(other._id) })).toEqual(['Gamma']);
    expect(await names({ leadId: String(lead._id) })).toEqual(['Alpha']);
    expect(await names({ memberId: String(lead._id) })).toEqual(['Alpha']);
    expect(await names({ status: 'active', type: 'saas' })).toEqual(['Gamma']);
  });

  it('searches name, reference and client name, and reads the text literally', async () => {
    const { viewer, client } = await setup();
    const p = await makeProject(client, { name: 'Checkout redesign' });
    await makeProject(await makeClient({ name: 'Zed Industries' }), { name: 'Other' });
    const found = async (q: string) => (await listProjects(viewer, { q })).items.map((i) => i.name);
    expect(await found('checkout')).toEqual(['Checkout redesign']);
    expect(await found(p.ref.toLowerCase())).toEqual(['Checkout redesign']);
    expect(await found('acme rob')).toEqual(['Checkout redesign']);
    expect(await found('.*')).toEqual([]);
    expect(await found('(')).toEqual([]);
    expect(await found('a|z')).toEqual([]);
  });

  it('pages and clamps to the last page', async () => {
    const { viewer, client } = await setup();
    for (let i = 1; i <= 7; i++) await makeProject(client, { name: `Project ${i}` });
    const page2 = await listProjects(viewer, { pageSize: 3, page: 2, sort: 'name', dir: 'asc' });
    expect(page2.items.map((i) => i.name)).toEqual(['Project 4', 'Project 5', 'Project 6']);
    expect(page2.meta).toMatchObject({ page: 2, pages: 3, total: 7, from: 4, to: 6 });
    const beyond = await listProjects(viewer, { pageSize: 3, page: 99, sort: 'name', dir: 'asc' });
    expect(beyond.meta.page).toBe(3);
    expect(beyond.items.map((i) => i.name)).toEqual(['Project 7']);
  });

  it('marks overdue projects only while the work is not delivered', async () => {
    const { viewer, client } = await setup();
    const now = new Date('2026-10-12T10:00:00Z');
    await makeProject(client, { name: 'Late', status: 'active', deadlineOn: D('2026-10-01') });
    await makeProject(client, { name: 'Due today', status: 'active', deadlineOn: D('2026-10-12') });
    await makeProject(client, { name: 'Delivered late', status: 'delivered', deadlineOn: D('2026-10-01') });
    await makeProject(client, { name: 'No deadline', status: 'active' });
    const rows = (await listProjects(viewer, { now, sort: 'name', dir: 'asc' })).items;
    expect(Object.fromEntries(rows.map((r) => [r.name, r.overdue]))).toEqual({ Late: true, 'Due today': false, 'Delivered late': false, 'No deadline': false });
  });

  it('shows the contract price only with payment:view', async () => {
    const { viewer, client } = await setup();
    await makeProject(client, { contract: { ...FIXED } });
    expect((await listProjects(await plainAdmin())).items[0]?.contract).toBeNull();
    expect((await listProjects(viewer)).items[0]?.contract).toEqual({ pricingModel: 'fixed', amountMinor: 1_000_000, currency: 'INR' });
  });

  it('treats a malformed id filter as not found rather than ignoring it', async () => {
    const { viewer } = await setup();
    expect((await rejects(listProjects(viewer, { clientId: 'nope' }))).code).toBe('NOT_FOUND');
  });
});

describe('getClientOption', () => {
  it('returns a picker value for a live client, null for archived or malformed, and needs client:view', async () => {
    const { viewer, client } = await setup();
    expect(await getClientOption(viewer, String(client._id))).toMatchObject({ id: String(client._id), label: 'Acme Robotics' });
    expect(await getClientOption(viewer, 'nope')).toBeNull();
    await Client.updateOne({ _id: client._id }, { $set: { archivedAt: new Date() } });
    expect(await getClientOption(viewer, String(client._id))).toBeNull();
    expect((await rejects(getClientOption(viewerWith(viewer, { remove: ['client:view'] }), String(client._id)))).code).toBe('FORBIDDEN');
  });
});
