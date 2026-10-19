import { describe, expect, it } from 'vitest';
import { AuditLog, Counter, Project, Task, ThirdParty, ThirdPartyPayout, WorkOrder } from '@/models';
import { archiveThirdParty } from '@/services/third-party.service';
import { createPayout, markPayoutPaid, voidPayout } from '@/services/third-party-payout.service';
import {
  changeWorkOrderStatus,
  createWorkOrder,
  getWorkOrder,
  searchWorkOrders,
  updateWorkOrder,
} from '@/services/work-order.service';
import { setupTestDb } from '@/test/db';
import { makeClient, makeProject, makeTask } from '@/test/domain-factories';
import { setSettings } from '@/test/settings-factories';
import { dayStr, makeOrder, makeParty, makePayout, makeWorld, rejects, viewerHolding } from '@/test/third-party-factories';

setupTestDb();

const id = (d: { _id: unknown }) => String(d._id);
const input = (w: Awaited<ReturnType<typeof makeWorld>>, extra: Record<string, unknown> = {}) => ({
  thirdPartyId: id(w.party),
  projectId: id(w.project),
  title: 'Build the checkout',
  amountMinor: 1_000_000,
  currency: 'INR',
  ...extra,
});

describe('capabilities', () => {
  it('needs payout:record to write and payout:view to read, and a refusal writes nothing', async () => {
    const w = await makeWorld();
    const order = await makeOrder(w.party, w.project);
    const viewOnly = viewerHolding(w.sa, 'payout:view', 'thirdParty:view');
    for (const attempt of [
      () => createWorkOrder(w.plain, input(w)),
      () => createWorkOrder(viewOnly, input(w)),
      () => updateWorkOrder(w.plain, id(order), { title: 'Renamed' }),
      () => changeWorkOrderStatus(viewOnly, id(order), { status: 'delivered' }),
    ]) {
      expect((await rejects(attempt())).code).toBe('FORBIDDEN');
    }
    for (const attempt of [() => searchWorkOrders(w.plain), () => getWorkOrder(w.plain, id(order)), () => searchWorkOrders(viewerHolding(w.sa, 'payout:record'))]) {
      // payout:record alone is not enough on this fixture: the grant dependency (view) is added when the grant is stored, not here
      expect((await rejects(attempt())).code).toBe('FORBIDDEN');
    }
    expect(await WorkOrder.countDocuments({})).toBe(1);
    expect((await WorkOrder.findById(order._id).lean())?.title).toBe(order.title);
    expect(await AuditLog.countDocuments({})).toBe(0);
    expect((await searchWorkOrders(viewOnly)).items).toHaveLength(1);
  });
});

describe('create', () => {
  it('derives the client from the project, numbers it, records history and audits with context', async () => {
    const w = await makeWorld();
    const dto = await createWorkOrder(w.recorder, input(w, { taskId: id(w.task), scope: 'Cart, payment and receipt', dueOn: '2026-12-01' }));
    expect(dto).toMatchObject({
      ref: 'WO-0001',
      status: 'open',
      thirdPartyId: id(w.party),
      thirdPartyName: w.party.name,
      clientId: id(w.client),
      clientName: w.client.name,
      projectId: id(w.project),
      projectRef: w.project.ref,
      taskId: id(w.task),
      taskRef: w.task.ref,
      agreed: { amountMinor: 1_000_000, currency: 'INR' },
      paidMinor: 0,
      dueMinor: 0,
      balanceMinor: 1_000_000,
      dueOn: '2026-12-01',
      scope: 'Cart, payment and receipt',
      createdBy: w.recorder.name,
    });
    expect(dto.statusHistory).toHaveLength(1);
    expect(dto.statusHistory[0]).toMatchObject({ from: null, to: 'open', by: w.recorder.name });

    const stored = await WorkOrder.findById(dto.id).lean();
    expect(String(stored?.clientId)).toBe(id(w.client));
    expect(stored?.dueOn?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    const entry = await AuditLog.findOne({ action: 'workOrder.create' }).lean();
    expect(entry?.entity).toMatchObject({ type: 'workOrder', ref: 'WO-0001' });
    expect(String(entry?.context.clientId)).toBe(id(w.client));
    expect(String(entry?.context.projectId)).toBe(id(w.project));
    expect(String(entry?.context.taskId)).toBe(id(w.task));
  });

  it('refuses a client that does not own the project, and a task from another project, with LINK_MISMATCH', async () => {
    const w = await makeWorld();
    const other = await makeClient();
    const mismatch = await rejects(createWorkOrder(w.sa, input(w, { clientId: id(other) })));
    expect(mismatch.code).toBe('LINK_MISMATCH');
    const elsewhere = await makeTask(await makeProject(w.client));
    const taskMismatch = await rejects(createWorkOrder(w.sa, input(w, { taskId: id(elsewhere) })));
    expect(taskMismatch.code).toBe('LINK_MISMATCH');
    expect(await WorkOrder.countDocuments({})).toBe(0);
    // the reference counter rolled back with the transaction
    expect((await Counter.findById('workOrder').lean())?.seq ?? 0).toBe(0);
    // the project's own client (any hex case) is accepted
    expect((await createWorkOrder(w.sa, input(w, { clientId: id(w.client).toUpperCase() }))).ref).toBe('WO-0001');
  });

  it('refuses archived projects, cancelled tasks, unusable third parties and disabled currencies', async () => {
    const w = await makeWorld();
    await Task.updateOne({ _id: w.task._id }, { $set: { status: 'cancelled' } });
    expect((await rejects(createWorkOrder(w.sa, input(w, { taskId: id(w.task) })))).code).toBe('CONFLICT');
    await Project.updateOne({ _id: w.project._id }, { $set: { archivedAt: new Date() } });
    expect((await rejects(createWorkOrder(w.sa, input(w)))).code).toBe('CONFLICT');
    await Project.updateOne({ _id: w.project._id }, { $unset: { archivedAt: 1 } });

    const archived = await makeParty({ archivedAt: new Date() });
    const inactive = await makeParty({ status: 'inactive' });
    expect((await rejects(createWorkOrder(w.sa, input(w, { thirdPartyId: id(archived) })))).fields?.thirdPartyId).toBeDefined();
    expect((await rejects(createWorkOrder(w.sa, input(w, { thirdPartyId: id(inactive) })))).fields?.thirdPartyId).toBeDefined();
    await setSettings({ enabledCurrencies: ['INR'] });
    expect((await rejects(createWorkOrder(w.sa, input(w, { currency: 'USD' })))).fields?.currency).toMatch(/not turned on/);
    expect((await rejects(createWorkOrder(w.sa, input(w, { projectId: 'zzz' })))).code).toBe('VALIDATION_FAILED');
    expect((await rejects(createWorkOrder(w.sa, input(w, { amountMinor: 0 })))).fields?.amountMinor).toBeDefined();
    expect((await rejects(createWorkOrder(w.sa, input(w, { amountMinor: 10.5 })))).code).toBe('VALIDATION_FAILED');
    expect((await rejects(createWorkOrder(w.sa, input(w, { paidMinor: 5 })))).code).toBe('VALIDATION_FAILED'); // the cache is not writable
    expect(await WorkOrder.countDocuments({})).toBe(0);
  });
});

describe('update', () => {
  it('edits the details, audits the diff, and a save that changes nothing writes nothing', async () => {
    const w = await makeWorld();
    const wo = await createWorkOrder(w.sa, input(w));
    const { workOrder, warnings } = await updateWorkOrder(w.recorder, wo.id, { title: 'Build checkout v2', scope: 'More', amountMinor: 1_500_000, dueOn: '2026-12-15', taskId: id(w.task) });
    expect(warnings).toEqual([]);
    expect(workOrder).toMatchObject({ title: 'Build checkout v2', scope: 'More', agreed: { amountMinor: 1_500_000, currency: 'INR' }, dueOn: '2026-12-15', taskId: id(w.task) });
    const entry = await AuditLog.findOne({ action: 'workOrder.update' }).lean();
    expect(entry?.changes.map((c) => c.path).sort()).toEqual(['agreed.amountMinor', 'dueOn', 'scope', 'taskId', 'title']);

    const count = await AuditLog.countDocuments({});
    await updateWorkOrder(w.recorder, wo.id, { title: 'Build checkout v2', amountMinor: 1_500_000 });
    expect(await AuditLog.countDocuments({})).toBe(count);

    const cleared = await updateWorkOrder(w.recorder, wo.id, { scope: null, dueOn: null, taskId: null });
    expect(cleared.workOrder).toMatchObject({ scope: null, dueOn: null, taskId: null });
    expect((await rejects(updateWorkOrder(w.recorder, wo.id, {}))).code).toBe('VALIDATION_FAILED');
    expect((await rejects(updateWorkOrder(w.recorder, wo.id, { thirdPartyId: id(w.party) } as never))).code).toBe('VALIDATION_FAILED'); // identity is not editable
  });

  it('warns when the agreed amount drops below what is already paid or due, and blocks currency and task changes once payouts exist', async () => {
    const w = await makeWorld();
    const wo = await createWorkOrder(w.sa, input(w, { taskId: id(w.task) }));
    await createPayout(w.sa, { workOrderId: wo.id, amountMinor: 600_000 });
    const low = await updateWorkOrder(w.sa, wo.id, { amountMinor: 500_000 });
    expect(low.workOrder.agreed.amountMinor).toBe(500_000); // a warning, not a block
    expect(low.warnings[0]).toMatch(/more than the/);
    expect(low.workOrder.balanceMinor).toBe(-100_000);

    expect((await rejects(updateWorkOrder(w.sa, wo.id, { currency: 'USD' }))).code).toBe('CONFLICT');
    const other = await makeTask(w.project);
    expect((await rejects(updateWorkOrder(w.sa, wo.id, { taskId: id(other) }))).code).toBe('CONFLICT');
    expect((await rejects(updateWorkOrder(w.sa, wo.id, { taskId: null }))).code).toBe('CONFLICT');
  });

  it('can change currency and task while no payout exists; a void payout does not count', async () => {
    const w = await makeWorld();
    const wo = await createWorkOrder(w.sa, input(w));
    const payout = await createPayout(w.sa, { workOrderId: wo.id, amountMinor: 100_000 });
    await voidPayout(w.sa, payout.payout.id, 'Entered twice');
    const changed = await updateWorkOrder(w.sa, wo.id, { currency: 'USD', taskId: id(w.task) });
    expect(changed.workOrder).toMatchObject({ agreed: { currency: 'USD' }, taskId: id(w.task) });
    const elsewhere = await makeTask(await makeProject(w.client));
    expect((await rejects(updateWorkOrder(w.sa, wo.id, { taskId: id(elsewhere) }))).code).toBe('LINK_MISMATCH');
  });

  it('cannot be edited once closed or cancelled', async () => {
    const w = await makeWorld();
    for (const status of ['closed', 'cancelled'] as const) {
      const order = await makeOrder(w.party, w.project, { status });
      expect((await rejects(updateWorkOrder(w.sa, id(order), { title: 'Late change' }))).code).toBe('CONFLICT');
    }
  });
});

describe('status', () => {
  it('follows the allowed moves, keeps history, and needs a note to cancel or reopen', async () => {
    const w = await makeWorld();
    const wo = await createWorkOrder(w.sa, input(w));
    const move = (status: 'open' | 'delivered' | 'closed' | 'cancelled', note?: string) => changeWorkOrderStatus(w.recorder, wo.id, { status, note });
    expect((await rejects(move('open'))).fields?.status).toBeDefined(); // already open
    expect((await move('delivered')).status).toBe('delivered');
    expect((await rejects(move('open'))).fields?.note).toMatch(/reopening/);
    expect((await move('closed')).status).toBe('closed');
    expect((await rejects(move('delivered'))).code).toBe('VALIDATION_FAILED'); // closed -> delivered is not a move
    expect((await rejects(move('cancelled'))).code).toBe('VALIDATION_FAILED');
    const reopened = await move('open', 'The client added scope');
    expect(reopened.status).toBe('open');
    expect((await rejects(move('cancelled'))).fields?.note).toMatch(/cancelling/);
    const cancelled = await move('cancelled', 'The client dropped the module');
    expect(cancelled.statusHistory.map((h) => h.to)).toEqual(['open', 'delivered', 'closed', 'open', 'cancelled']);
    expect(cancelled.statusHistory.at(-1)).toMatchObject({ from: 'open', note: 'The client dropped the module', by: w.recorder.name });
    expect(await AuditLog.countDocuments({ action: 'workOrder.status' })).toBe(4);
  });

  it('cannot be cancelled while payouts that are paid or still due refer to it', async () => {
    const w = await makeWorld();
    const wo = await createWorkOrder(w.sa, input(w));
    const payout = (await createPayout(w.sa, { workOrderId: wo.id, amountMinor: 300_000 })).payout;
    const dueBlock = await rejects(changeWorkOrderStatus(w.sa, wo.id, { status: 'cancelled', note: 'Changed our mind' }));
    expect(dueBlock.code).toBe('CONFLICT');
    expect(dueBlock.message).toMatch(/still due/);

    await markPayoutPaid(w.sa, payout.id, { paidOn: dayStr(0), mode: 'bank_transfer', transactionRef: 'UTR100' });
    const paidBlock = await rejects(changeWorkOrderStatus(w.sa, wo.id, { status: 'cancelled', note: 'Changed our mind' }));
    expect(paidBlock.code).toBe('CONFLICT');
    expect(paidBlock.message).toMatch(/already been paid/);
    expect((await WorkOrder.findById(wo.id).lean())?.status).toBe('open');

    // closing is fine, and voiding the payout unlocks cancelling
    expect((await changeWorkOrderStatus(w.sa, wo.id, { status: 'closed' })).status).toBe('closed');
    await changeWorkOrderStatus(w.sa, wo.id, { status: 'open', note: 'Reopened to void' });
    await voidPayout(w.sa, payout.id, 'Paid the wrong person');
    expect((await changeWorkOrderStatus(w.sa, wo.id, { status: 'cancelled', note: 'Now cancel it' })).status).toBe('cancelled');
  });

  it('a cancelled or closed work order takes no new payouts until it is reopened', async () => {
    const w = await makeWorld();
    const wo = await createWorkOrder(w.sa, input(w));
    await changeWorkOrderStatus(w.sa, wo.id, { status: 'cancelled', note: 'Not needed' });
    expect((await rejects(createPayout(w.sa, { workOrderId: wo.id, amountMinor: 1000 }))).code).toBe('CONFLICT');
    await changeWorkOrderStatus(w.sa, wo.id, { status: 'open', note: 'Needed after all' });
    expect((await createPayout(w.sa, { workOrderId: wo.id, amountMinor: 1000 })).payout.status).toBe('due');
  });

  it('a cancel and a payout recorded at the same moment cannot both win', async () => {
    const w = await makeWorld();
    const wo = await createWorkOrder(w.sa, input(w));
    const results = await Promise.allSettled([
      changeWorkOrderStatus(w.sa, wo.id, { status: 'cancelled', note: 'Cancelled while paying' }),
      createPayout(w.sa, { workOrderId: wo.id, amountMinor: 250_000 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const after = await WorkOrder.findById(wo.id).lean();
    const payouts = await ThirdPartyPayout.countDocuments({ workOrderId: wo.id });
    if (after?.status === 'cancelled') expect(payouts).toBe(0);
    else expect(payouts).toBe(1);
  });

  it('an archive of the third party and a new work order cannot both win', async () => {
    const w = await makeWorld();
    const results = await Promise.allSettled([archiveThirdParty(w.sa, id(w.party)), createWorkOrder(w.sa, input(w))]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const archived = Boolean((await ThirdParty.findById(w.party._id).lean())?.archivedAt);
    expect(await WorkOrder.countDocuments({})).toBe(archived ? 0 : 1);
  });
});

describe('search', () => {
  it('filters, matches text literally, sorts with undated last, and pages', async () => {
    const w = await makeWorld();
    const other = await makeParty({ name: 'Beta.Works' });
    const projectB = await makeProject(await makeClient({ name: 'Other Client' }));
    const a = await makeOrder(w.party, w.project, { title: 'Alpha (phase 1)', dueOn: new Date('2026-11-01T00:00:00Z') });
    const b = await makeOrder(other, projectB, { title: 'Beta job', dueOn: new Date('2026-10-01T00:00:00Z'), status: 'delivered' });
    const c = await makeOrder(w.party, w.project, { title: 'Gamma job' });
    await makeOrder(w.party, w.project, { title: 'Closed job', status: 'closed' });

    expect((await searchWorkOrders(w.sa)).meta.total).toBe(4);
    expect((await searchWorkOrders(w.sa, { status: 'current' })).meta.total).toBe(3);
    expect((await searchWorkOrders(w.sa, { status: 'closed' })).items.map((i) => i.title)).toEqual(['Closed job']);
    expect((await searchWorkOrders(w.sa, { thirdPartyId: id(other) })).items.map((i) => i.id)).toEqual([id(b)]);
    expect((await searchWorkOrders(w.sa, { projectId: id(projectB) })).items).toHaveLength(1);
    expect((await searchWorkOrders(w.sa, { clientId: id(w.client) })).meta.total).toBe(3);
    expect((await searchWorkOrders(w.sa, { q: '.*' })).items).toHaveLength(0);
    expect((await searchWorkOrders(w.sa, { q: '(phase 1)' })).items.map((i) => i.id)).toEqual([id(a)]);
    expect((await searchWorkOrders(w.sa, { q: 'beta.works' })).items).toHaveLength(1);

    const asc = await searchWorkOrders(w.sa, { status: 'current', sort: 'dueOn', dir: 'asc' });
    expect(asc.items.map((i) => i.id)).toEqual([id(b), id(a), id(c)]); // undated last
    const desc = await searchWorkOrders(w.sa, { status: 'current', sort: 'dueOn', dir: 'desc' });
    expect(desc.items.map((i) => i.id)).toEqual([id(a), id(b), id(c)]);
    const page = await searchWorkOrders(w.sa, { sort: 'ref', pageSize: 3, page: 2 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.projectName).toBe(w.project.name);
  });

  it('flags a current work order past its due date as overdue and carries the balance', async () => {
    const w = await makeWorld();
    const late = await makeOrder(w.party, w.project, { dueOn: new Date(`${dayStr(-3)}T00:00:00Z`), agreedMinor: 500_000, paidMinor: 100_000, dueMinor: 150_000 });
    await makeOrder(w.party, w.project, { dueOn: new Date(`${dayStr(-3)}T00:00:00Z`), status: 'closed' });
    await makeOrder(w.party, w.project, { dueOn: new Date(`${dayStr(3)}T00:00:00Z`) });
    const items = (await searchWorkOrders(w.sa, { sort: 'ref', dir: 'asc' })).items;
    expect(items.map((i) => i.overdue)).toEqual([true, false, false]);
    expect(items[0]).toMatchObject({ id: id(late), paidMinor: 100_000, dueMinor: 150_000, balanceMinor: 250_000 });
    expect((await getWorkOrder(w.sa, id(late))).balanceMinor).toBe(250_000);
    expect((await rejects(getWorkOrder(w.sa, 'nope'))).code).toBe('NOT_FOUND');
    expect(await ThirdPartyPayout.countDocuments({})).toBe(0);
    void makePayout;
  });
});
