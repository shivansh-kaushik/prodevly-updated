import { describe, expect, it } from 'vitest';
import { AuditLog, ClientPayment, Project, Task } from '@/models';
import { getPaymentContext, recordPayment, searchPayments, updatePayment, voidPayment } from '@/services/client-payment.service';
import { setupTestDb } from '@/test/db';
import { makeClient, makeTask } from '@/test/domain-factories';
import { NOW, makeBillableProject, type MilestoneFixture, makeFxRate, makePaymentFile, paymentActors, paymentBody, paymentCount, rejects } from '@/test/payment-factories';

setupTestDb();

const record = (viewer: Parameters<typeof recordPayment>[0], body: Parameters<typeof recordPayment>[1]) => recordPayment(viewer, body, {}, NOW);
const edit = (viewer: Parameters<typeof updatePayment>[0], id: string, patch: Parameters<typeof updatePayment>[2]) => updatePayment(viewer, id, patch, {}, NOW);
const updates = () => AuditLog.countDocuments({ action: 'payment.update' });
const stored = (id: string) => ClientPayment.findById(id).lean();
const milestoneStatus = async (projectId: unknown, index = 0) => (await Project.findById(projectId).lean())?.milestones[index]?.status;

describe('editing a received payment', () => {
  it('needs payment:record, and only while the entry is received', async () => {
    const { recorder, viewer, sa } = await paymentActors();
    const { project } = await makeBillableProject();
    const made = await record(recorder, paymentBody(project));
    expect((await rejects(edit(viewer, made.id, { note: 'x' }))).code).toBe('FORBIDDEN');
    expect(await updates()).toBe(0);

    await voidPayment(sa, made.id, { reason: 'Entered twice' });
    const locked = await rejects(edit(recorder, made.id, { note: 'too late' }));
    expect(locked.code).toBe('CONFLICT');
    expect((await stored(made.id))?.note).toBeUndefined();
    expect((await rejects(edit(recorder, '5f3a1b2c3d4e5f6a7b8c9d0e', { note: 'x' }))).code).toBe('NOT_FOUND');
    expect((await rejects(edit(recorder, made.id, {}))).code).toBe('VALIDATION_FAILED');
  });

  it('recomputes a table-rate entry when the amount changes, and audits before and after', async () => {
    const { recorder } = await paymentActors();
    await makeFxRate('USD', 83.42, '2026-09-30');
    const { project } = await makeBillableProject();
    const made = await record(recorder, paymentBody(project, { amountMinor: 100_000, currency: 'USD' }));
    const edited = await edit(recorder, made.id, { amountMinor: 200_000 });
    expect(edited.amount).toMatchObject({ amountMinor: 200_000, fxRate: 83.42, fxSource: 'table', inrMinor: 16_684_000 });
    expect(edited.contractEquivalentMinor).toBe(16_684_000);

    const entry = await AuditLog.findOne({ action: 'payment.update' }).lean();
    expect(entry?.entity).toMatchObject({ type: 'payment', ref: made.ref });
    const change = (path: string) => entry?.changes.find((c) => c.path === path);
    expect(change('amountMinor')).toMatchObject({ before: 100_000, after: 200_000 });
    expect(change('inrMinor')).toMatchObject({ before: 8_342_000, after: 16_684_000 });
    expect(change('contractEquivalentMinor')).toMatchObject({ before: 8_342_000, after: 16_684_000 });
    expect(change('note')).toBeUndefined();
  });

  it('looks the rate up again when the date changes', async () => {
    const { recorder } = await paymentActors();
    await makeFxRate('USD', 83.42, '2026-09-30');
    await makeFxRate('USD', 84, '2026-10-05');
    const { project } = await makeBillableProject();
    const made = await record(recorder, paymentBody(project, { amountMinor: 100_000, currency: 'USD', receivedOn: '2026-10-01' }));
    expect(made.amount.fxRate).toBe(83.42);
    const edited = await edit(recorder, made.id, { receivedOn: '2026-10-06' });
    expect(edited.amount).toMatchObject({ fxRate: 84, fxDate: '2026-10-05', inrMinor: 8_400_000, fxSource: 'table' });
    expect(edited.receivedOn).toBe('2026-10-06');
  });

  it('keeps a rate that was typed by hand or applied by the bank, and only moves the INR value with the amount', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    const manual = await record(recorder, paymentBody(project, { amountMinor: 100_000, currency: 'USD', manualRate: 84.1 }));
    const bank = await record(recorder, paymentBody(project, { amountMinor: 100_000, currency: 'USD', settledInrMinor: 8_300_000 }));
    expect((await edit(recorder, manual.id, { amountMinor: 200_000 })).amount).toMatchObject({ fxRate: 84.1, fxSource: 'manual', inrMinor: 16_820_000 });
    expect((await edit(recorder, bank.id, { amountMinor: 200_000 })).amount).toMatchObject({ fxRate: 83, fxSource: 'bank', inrMinor: 16_600_000 });
    // a new date keeps the rate too, and the entry says it applies to the new date
    expect((await edit(recorder, manual.id, { receivedOn: '2026-10-02' })).amount).toMatchObject({ fxRate: 84.1, fxSource: 'manual', fxDate: '2026-10-02' });
  });

  it('takes a new exact rate or the INR that arrived when the body gives one, and the table again when asked', async () => {
    const { recorder } = await paymentActors();
    await makeFxRate('USD', 83.42, '2026-10-01');
    const { project } = await makeBillableProject();
    const made = await record(recorder, paymentBody(project, { amountMinor: 100_000, currency: 'USD', manualRate: 84.1 }));
    expect((await edit(recorder, made.id, { manualRate: 85 })).amount).toMatchObject({ fxRate: 85, fxSource: 'manual', inrMinor: 8_500_000 });
    expect((await edit(recorder, made.id, { settledInrMinor: 8_330_000 })).amount).toMatchObject({ fxRate: 83.3, fxSource: 'bank', inrMinor: 8_330_000 });
    expect((await edit(recorder, made.id, { useTableRate: true })).amount).toMatchObject({ fxRate: 83.42, fxSource: 'table', inrMinor: 8_342_000 });
    expect((await rejects(edit(recorder, made.id, { manualRate: 85, settledInrMinor: 8_500_000 }))).code).toBe('VALIDATION_FAILED');
    expect((await rejects(edit(recorder, made.id, { manualRate: 85, useTableRate: true }))).code).toBe('VALIDATION_FAILED');
  });

  it('recomputes the rate when the currency changes, even if the old one was typed by hand', async () => {
    const { recorder } = await paymentActors();
    await makeFxRate('EUR', 90, '2026-10-01');
    const { project } = await makeBillableProject();
    const made = await record(recorder, paymentBody(project, { amountMinor: 100_000, currency: 'USD', manualRate: 84.1 }));
    const eur = await edit(recorder, made.id, { currency: 'EUR' });
    expect(eur.amount).toMatchObject({ currency: 'EUR', fxRate: 90, fxSource: 'table', inrMinor: 9_000_000 });
    const inr = await edit(recorder, made.id, { currency: 'INR' });
    expect(inr.amount).toMatchObject({ currency: 'INR', fxRate: 1, fxSource: 'identity', inrMinor: 100_000 });
    // no rate for a currency: FX_RATE_MISSING, and the entry is untouched
    expect((await rejects(edit(recorder, made.id, { currency: 'GBP' }))).code).toBe('FX_RATE_MISSING');
    expect((await stored(made.id))?.amount.currency).toBe('INR');
  });

  it('leaves the money alone when only a reference, mode, note or file changes', async () => {
    const { recorder } = await paymentActors();
    await makeFxRate('USD', 83.42, '2026-10-01');
    await makeFxRate('USD', 99, '2026-10-02'); // a newer table row must not change an entry whose money was not edited
    const { project } = await makeBillableProject();
    const made = await record(recorder, paymentBody(project, { amountMinor: 100_000, currency: 'USD', receivedOn: '2026-10-01' }));
    const file = await makePaymentFile(recorder);
    const edited = await edit(recorder, made.id, { note: 'Remittance advice attached', transactionRef: 'UTR-9', invoiceRef: 'INV-1', mode: 'wise', attachmentMediaIds: [String(file._id)], tdsMinor: 5_000, chargesMinor: 300 });
    expect(edited.amount).toEqual(made.amount);
    expect(edited).toMatchObject({ note: 'Remittance advice attached', transactionRef: 'UTR-9', invoiceRef: 'INV-1', mode: 'wise', tdsMinor: 5_000, chargesMinor: 300, attachmentMediaIds: [String(file._id)] });
    const entry = await AuditLog.findOne({ action: 'payment.update' }).lean();
    expect(entry?.changes.map((c) => c.path).sort()).toEqual(['attachmentMediaIds', 'chargesMinor', 'invoiceRef', 'mode', 'noteLength', 'tdsMinor', 'transactionRef']);

    // empty text and null clear the fields
    const cleared = await edit(recorder, made.id, { note: '', transactionRef: null, tdsMinor: null, chargesMinor: 0, attachmentMediaIds: [] });
    expect(cleared).toMatchObject({ note: null, transactionRef: null, tdsMinor: null, chargesMinor: null, attachmentMediaIds: [] });
  });

  it('writes nothing and audits nothing when nothing changes', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    const made = await record(recorder, paymentBody(project, { note: 'Same' }));
    const stamp = (await stored(made.id))?.updatedAt.getTime();
    const projectStamp = (await Project.findById(project._id).lean())?.updatedAt.getTime();
    await new Promise((r) => setTimeout(r, 15));
    const same = await edit(recorder, made.id, { note: 'Same', amountMinor: made.amount.amountMinor, receivedOn: made.receivedOn, mode: made.mode });
    expect(same.id).toBe(made.id);
    expect(await updates()).toBe(0);
    expect((await stored(made.id))?.updatedAt.getTime()).toBe(stamp);
    // not even the project's "updated" time moves
    expect((await Project.findById(project._id).lean())?.updatedAt.getTime()).toBe(projectStamp);
  });

  it('keeps a mode that Settings no longer lists when something else is edited, and checks one that is chosen', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    const made = await record(recorder, paymentBody(project));
    await ClientPayment.updateOne({ _id: made.id }, { $set: { mode: 'barter' } });
    expect((await edit(recorder, made.id, { note: 'fine' })).mode).toBe('barter');
    expect((await rejects(edit(recorder, made.id, { mode: 'goats' }))).fields).toHaveProperty('mode');
    expect((await edit(recorder, made.id, { mode: 'cheque' })).mode).toBe('cheque');
  });

  it('refuses a date in the future, and does not re-judge a date that did not change', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    const made = await record(recorder, paymentBody(project));
    expect((await rejects(edit(recorder, made.id, { receivedOn: '2026-10-13' }))).fields).toHaveProperty('receivedOn');
    expect((await edit(recorder, made.id, { receivedOn: '2026-09-15' })).receivedOn).toBe('2026-09-15');
  });

  it('applies PAYMENT_EXCEEDS_DUE to an edit that raises the amount, and lets one that lowers it through', async () => {
    const { recorder, sa } = await paymentActors();
    const { project } = await makeBillableProject({ amountMinor: 100_000_000 });
    const made = await record(recorder, paymentBody(project, { amountMinor: 50_000_000 }));
    await record(recorder, paymentBody(project, { amountMinor: 40_000_000 }));
    expect((await rejects(edit(recorder, made.id, { amountMinor: 70_000_000 }))).code).toBe('PAYMENT_EXCEEDS_DUE');
    expect((await rejects(edit(recorder, made.id, { amountMinor: 70_000_000, recordAsAdvance: true }))).code).toBe('PAYMENT_EXCEEDS_DUE');
    expect((await stored(made.id))?.amount.amountMinor).toBe(50_000_000);
    expect((await edit(recorder, made.id, { amountMinor: 60_000_000 })).amount.amountMinor).toBe(60_000_000); // exactly the contract: fine
    const advance = await edit(sa, made.id, { amountMinor: 70_000_000, recordAsAdvance: true });
    expect(advance.recordedAsAdvance).toBe(true);
    // 110 against 100 billable: lowering it again needs no tick, and keeps the flag while it still exceeds
    const lowered = await edit(recorder, made.id, { amountMinor: 65_000_000 });
    expect(lowered.amount.amountMinor).toBe(65_000_000);
    expect(lowered.recordedAsAdvance).toBe(true);
    const fits = await edit(recorder, made.id, { amountMinor: 60_000_000 });
    expect(fits.recordedAsAdvance).toBe(false);
  });

  it('is serialised with a payment recorded at the same moment: together they cannot go over the contract', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject({ amountMinor: 100_000_000 });
    const a = await record(recorder, paymentBody(project, { amountMinor: 50_000_000, receivedOn: '2026-09-01' }));
    // each is fine alone (70 against 100, and 50 + 40 = 90), but not both (70 + 40 = 110)
    const results = await Promise.allSettled([
      edit(recorder, a.id, { amountMinor: 70_000_000 }),
      record(recorder, paymentBody(project, { amountMinor: 40_000_000, receivedOn: '2026-03-15' })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect((failed?.reason as { code?: string }).code).toBe('PAYMENT_EXCEEDS_DUE');
    const net = (await getPaymentContext(recorder, String(project._id))).receivedMinor;
    expect(net).toBeLessThanOrEqual(100_000_000);
  });

  it('cannot take a receipt below what refunds already took', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    const receipt = await record(recorder, paymentBody(project, { amountMinor: 5_000_000 }));
    await record(recorder, paymentBody(project, { type: 'refund', amountMinor: 3_000_000 }));
    expect((await rejects(edit(recorder, receipt.id, { amountMinor: 2_000_000 }))).fields).toHaveProperty('amountMinor');
    expect((await edit(recorder, receipt.id, { amountMinor: 3_000_000 })).amount.amountMinor).toBe(3_000_000);
  });

  it('corrects the contract equivalent, and recomputes it when the amount moves', async () => {
    const { recorder } = await paymentActors();
    await makeFxRate('USD', 83.42, '2026-10-01');
    const { project } = await makeBillableProject({ currency: 'USD', amountMinor: 1_000_000 });
    const made = await record(recorder, paymentBody(project, { amountMinor: 8_342_000, currency: 'INR' }));
    expect(made.contractEquivalentMinor).toBe(100_000);
    expect((await edit(recorder, made.id, { contractEquivalentMinor: 99_000 })).contractEquivalentMinor).toBe(99_000);
    expect((await edit(recorder, made.id, { note: 'unrelated' })).contractEquivalentMinor).toBe(99_000); // untouched
    expect((await edit(recorder, made.id, { amountMinor: 16_684_000 })).contractEquivalentMinor).toBe(200_000); // recomputed
  });
});

describe('moving a payment between links', () => {
  it('sets and clears the task and the milestone, and checks them against the project', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject({ pricingModel: 'milestone', milestones: [{ title: 'Design', amountMinor: 40_000_000 }] });
    const { project: other } = await makeBillableProject();
    const task = await makeTask(project, { title: 'Checkout' });
    const foreign = await makeTask(other);
    const made = await record(recorder, paymentBody(project, { amountMinor: 1_000_000 }));
    const mid = String(project.milestones[0]!._id);

    const linked = await edit(recorder, made.id, { taskId: String(task._id), milestoneId: mid });
    expect(linked.task?.id).toBe(String(task._id));
    expect(linked.milestone?.id).toBe(mid);
    expect((await rejects(edit(recorder, made.id, { taskId: String(foreign._id) }))).code).toBe('LINK_MISMATCH');
    const cleared = await edit(recorder, made.id, { taskId: null, milestoneId: null });
    expect(cleared.task).toBeNull();
    expect(cleared.milestone).toBeNull();
    const entry = await AuditLog.findOne({ action: 'payment.update' }).sort({ at: -1 }).lean();
    expect(entry?.changes.map((c) => c.path).sort()).toEqual(['milestoneId', 'taskId']);
  });

  it('moves to another project of another client, deriving the client again and refusing a stale task or milestone', async () => {
    const { recorder } = await paymentActors();
    const first = await makeBillableProject({ client: await makeClient({ name: 'First' }), milestones: [{ title: 'M1', amountMinor: 1_000_000 }] });
    const second = await makeBillableProject({ client: await makeClient({ name: 'Second' }) });
    const task = await makeTask(first.project);
    const made = await record(recorder, paymentBody(first.project, { amountMinor: 1_000_000, taskId: String(task._id), milestoneId: String(first.project.milestones[0]!._id) }));

    // the old task and milestone hang from the old project: the move must say what to do with them
    expect((await rejects(edit(recorder, made.id, { projectId: String(second.project._id) }))).code).toBe('LINK_MISMATCH');
    const moved = await edit(recorder, made.id, { projectId: String(second.project._id), taskId: null, milestoneId: null });
    expect(moved.project.id).toBe(String(second.project._id));
    expect(moved.client).toMatchObject({ id: String(second.client._id), name: 'Second' });
    expect((await rejects(edit(recorder, made.id, { projectId: String(second.project._id), clientId: String(first.client._id) }))).code).toBe('LINK_MISMATCH');
    const entry = await AuditLog.findOne({ action: 'payment.update' }).lean();
    expect(entry?.changes.map((c) => c.path)).toEqual(expect.arrayContaining(['projectId', 'clientId', 'taskId', 'milestoneId']));
    expect(String(entry?.context?.projectId)).toBe(String(second.project._id));
  });

  it('is judged against the new project: too much for it is refused, and a project left with more refunded than received blocks the move', async () => {
    const { recorder } = await paymentActors();
    const big = await makeBillableProject({ amountMinor: 100_000_000 });
    const small = await makeBillableProject({ amountMinor: 1_000_000 });
    const made = await record(recorder, paymentBody(big.project, { amountMinor: 5_000_000 }));
    expect((await rejects(edit(recorder, made.id, { projectId: String(small.project._id) }))).code).toBe('PAYMENT_EXCEEDS_DUE');

    await record(recorder, paymentBody(big.project, { type: 'refund', amountMinor: 4_000_000 }));
    const roomy = await makeBillableProject({ amountMinor: 100_000_000 });
    expect((await rejects(edit(recorder, made.id, { projectId: String(roomy.project._id) }))).code).toBe('CONFLICT');
  });

  it('can be made on an archived project (a correction), but cannot move onto one', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    const made = await record(recorder, paymentBody(project));
    await Project.updateOne({ _id: project._id }, { $set: { archivedAt: new Date() } });
    expect((await edit(recorder, made.id, { note: 'Fixed the reference' })).note).toBe('Fixed the reference');
    const { project: other } = await makeBillableProject();
    await Project.updateOne({ _id: other._id }, { $set: { archivedAt: new Date() } });
    expect((await rejects(edit(recorder, made.id, { projectId: String(other._id) }))).code).toBe('CONFLICT');
  });

  it('touches the old and the new task, so a concurrent task move conflicts', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    const a = await makeTask(project);
    const b = await makeTask(project);
    const made = await record(recorder, paymentBody(project, { taskId: String(a._id) }));
    const stamps = async () => [(await Task.findById(a._id).lean())?.updatedAt.getTime() ?? 0, (await Task.findById(b._id).lean())?.updatedAt.getTime() ?? 0];
    const before = await stamps();
    await new Promise((r) => setTimeout(r, 15));
    await edit(recorder, made.id, { taskId: String(b._id) });
    const after = await stamps();
    expect(after[0]).toBeGreaterThan(before[0]!);
    expect(after[1]).toBeGreaterThan(before[1]!);
  });
});

describe('voiding', () => {
  it('needs a reason of 3 to 300 characters, and changes nothing without one', async () => {
    const { recorder, sa } = await paymentActors();
    const { project } = await makeBillableProject();
    const made = await record(recorder, paymentBody(project));
    for (const reason of ['', '  ', 'ab', 'x'.repeat(301)]) {
      const error = await rejects(voidPayment(sa, made.id, { reason }));
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.fields).toHaveProperty('reason');
    }
    expect((await stored(made.id))?.status).toBe('received');
    expect(await AuditLog.countDocuments({ action: 'payment.void' })).toBe(0);
    expect((await voidPayment(sa, made.id, { reason: 'x'.repeat(300) })).status).toBe('void');
  });

  it('keeps the entry with status void, who voided it and when, and writes one audit entry with the reason', async () => {
    const { recorder, sa } = await paymentActors();
    const { project } = await makeBillableProject();
    const made = await record(recorder, paymentBody(project));
    const voided = await voidPayment(sa, made.id, { reason: '  Cheque bounced  ' });
    expect(voided).toMatchObject({ status: 'void', voidReason: 'Cheque bounced', voidedBy: 'Sara Super' });
    expect(voided.voidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await paymentCount()).toBe(1); // never deleted
    const doc = await stored(made.id);
    expect(doc?.status).toBe('void');
    expect(doc?.voidedBy?.name).toBe('Sara Super');
    const entries = await AuditLog.find({ action: 'payment.void' }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ summary: 'Cheque bounced', entity: { type: 'payment', ref: made.ref } });
    expect(entries[0]?.changes).toEqual([{ path: 'status', before: 'received', after: 'void' }]);
  });

  it('cannot be done twice, or to something that does not exist', async () => {
    const { recorder, sa } = await paymentActors();
    const { project } = await makeBillableProject();
    const made = await record(recorder, paymentBody(project));
    await voidPayment(sa, made.id, { reason: 'First time' });
    expect((await rejects(voidPayment(sa, made.id, { reason: 'Second time' }))).code).toBe('CONFLICT');
    expect((await rejects(voidPayment(sa, '5f3a1b2c3d4e5f6a7b8c9d0e', { reason: 'Nothing here' }))).code).toBe('NOT_FOUND');
    expect((await rejects(voidPayment(sa, 'nope', { reason: 'Bad id' }))).code).toBe('NOT_FOUND');
    expect(await AuditLog.countDocuments({ action: 'payment.void' })).toBe(1);
  });

  it('stays in the list with its status, and is in no total', async () => {
    const { recorder, sa, viewer } = await paymentActors();
    const { project } = await makeBillableProject();
    const keep = await record(recorder, paymentBody(project, { amountMinor: 3_000_000 }));
    const gone = await record(recorder, paymentBody(project, { amountMinor: 9_000_000 }));
    await voidPayment(sa, gone.id, { reason: 'Wrong client' });
    const page = await searchPayments(viewer);
    expect(page.items.map((p) => [p.id, p.status])).toEqual(expect.arrayContaining([[keep.id, 'received'], [gone.id, 'void']]));
    expect(page.summary).toMatchObject({ receivedInr: 3_000_000, receipts: 1, voided: 1 });
    expect((await getPaymentContext(recorder, String(project._id))).receivedMinor).toBe(3_000_000);
  });

  it('can be done on a project that is archived', async () => {
    const { recorder, sa } = await paymentActors();
    const { project } = await makeBillableProject();
    const made = await record(recorder, paymentBody(project));
    await Project.updateOne({ _id: project._id }, { $set: { archivedAt: new Date() } });
    expect((await voidPayment(sa, made.id, { reason: 'Project was cancelled' })).status).toBe('void');
  });
});

describe('milestones follow the money linked to them', () => {
  const setup = async (milestones: MilestoneFixture[] = [{ title: 'Design sign-off', amountMinor: 40_000_000 }, { title: 'Launch', amountMinor: 60_000_000 }]) => {
    const actors = await paymentActors();
    const { project } = await makeBillableProject({ pricingModel: 'milestone', amountMinor: 100_000_000, milestones });
    return { ...actors, project, m1: String(project.milestones[0]!._id), m2: String(project.milestones[1]?._id ?? '') };
  };

  it('marks a milestone paid when its payments cover it, and writes an audit entry on the project that names it', async () => {
    const w = await setup();
    await record(w.recorder, paymentBody(w.project, { amountMinor: 15_000_000, milestoneId: w.m1 }));
    expect(await milestoneStatus(w.project._id)).toBe('invoiced'); // part-paid: not yet
    expect(await AuditLog.countDocuments({ action: 'project.update' })).toBe(0);
    const second = await record(w.recorder, paymentBody(w.project, { amountMinor: 25_000_000, milestoneId: w.m1 }));
    expect(await milestoneStatus(w.project._id)).toBe('paid');
    expect(await milestoneStatus(w.project._id, 1)).toBe('invoiced'); // the other one is untouched

    const entry = await AuditLog.findOne({ action: 'project.update' }).lean();
    expect(entry?.entity).toMatchObject({ type: 'project', ref: w.project.ref });
    expect(String(entry?.context?.projectId)).toBe(String(w.project._id));
    expect(entry?.summary).toBe('Milestone "Design sign-off" updated from its payments');
    expect(entry?.changes).toEqual([
      { path: `milestones.${w.m1}.status`, before: 'invoiced', after: 'paid' },
      { path: `milestones.${w.m1}.cause`, after: `${second.ref} recorded` },
    ]);
    // every part of that is money: a project viewer without payment:view must not read the status or the payment
    expect(entry?.summary).not.toMatch(/paid|invoiced|PAY-/);
  });

  it('marks a pending milestone paid straight away when one payment covers it, and counts a foreign payment by its contract equivalent', async () => {
    const w = await setup([{ title: 'Pending one', amountMinor: 8_342_000, status: 'pending' }]);
    await makeFxRate('USD', 83.42, '2026-10-01');
    await record(w.recorder, paymentBody(w.project, { amountMinor: 100_000, currency: 'USD', milestoneId: w.m1 })); // USD 1,000 = INR 83,420
    expect(await milestoneStatus(w.project._id)).toBe('paid');
  });

  it('puts a milestone back to invoiced when a void uncovers it, with an audit entry', async () => {
    const w = await setup();
    const covering = await record(w.recorder, paymentBody(w.project, { amountMinor: 40_000_000, milestoneId: w.m1 }));
    expect(await milestoneStatus(w.project._id)).toBe('paid');
    await voidPayment(w.sa, covering.id, { reason: 'Bounced' });
    expect(await milestoneStatus(w.project._id)).toBe('invoiced');
    const entries = await AuditLog.find({ action: 'project.update' }).sort({ at: 1 }).lean();
    expect(entries.map((e) => e.changes[0]?.after)).toEqual(['paid', 'invoiced']);
    expect(entries[1]?.changes[1]?.after).toBe(`${covering.ref} voided`);
  });

  it('leaves a milestone someone marked paid by hand alone while only a part-payment is linked to it', async () => {
    const w = await setup([{ title: 'Settled outside', amountMinor: 40_000_000, status: 'paid' }, { title: 'Other', amountMinor: 60_000_000 }]);
    const part = await record(w.recorder, paymentBody(w.project, { amountMinor: 5_000_000, milestoneId: w.m1 }));
    expect(await milestoneStatus(w.project._id)).toBe('paid');
    await voidPayment(w.sa, part.id, { reason: 'Entered in error' });
    expect(await milestoneStatus(w.project._id)).toBe('paid'); // it was never covered by payments, so nothing to uncover
    expect(await AuditLog.countDocuments({ action: 'project.update' })).toBe(0);
  });

  it('uncovers a milestone when a refund is linked to it, and covers it again when that refund is voided', async () => {
    const w = await setup();
    await record(w.recorder, paymentBody(w.project, { amountMinor: 40_000_000, milestoneId: w.m1 }));
    const refund = await record(w.recorder, paymentBody(w.project, { type: 'refund', amountMinor: 10_000_000, milestoneId: w.m1 }));
    expect(await milestoneStatus(w.project._id)).toBe('invoiced');
    await voidPayment(w.sa, refund.id, { reason: 'Refund was never sent' });
    expect(await milestoneStatus(w.project._id)).toBe('paid');
  });

  it('rolls both milestones when a payment is moved from one to the other', async () => {
    const w = await setup();
    const made = await record(w.recorder, paymentBody(w.project, { amountMinor: 40_000_000, milestoneId: w.m1 }));
    expect(await milestoneStatus(w.project._id, 0)).toBe('paid');
    await edit(w.recorder, made.id, { milestoneId: w.m2 });
    expect(await milestoneStatus(w.project._id, 0)).toBe('invoiced'); // uncovered
    expect(await milestoneStatus(w.project._id, 1)).toBe('invoiced'); // 40 of 60: not covered
    await edit(w.recorder, made.id, { milestoneId: w.m1, amountMinor: 45_000_000 });
    expect(await milestoneStatus(w.project._id, 0)).toBe('paid');
  });

  it('rolls back with the payment: a refused payment moves no milestone', async () => {
    const w = await setup([{ title: 'Whole contract', amountMinor: 100_000_000 }]);
    await record(w.recorder, paymentBody(w.project, { amountMinor: 100_000_000, milestoneId: w.m1 }));
    expect(await milestoneStatus(w.project._id)).toBe('paid');
    const audits = await AuditLog.countDocuments({});
    await rejects(record(w.recorder, paymentBody(w.project, { amountMinor: 1, milestoneId: w.m1 })));
    expect(await AuditLog.countDocuments({})).toBe(audits);
    expect(await paymentCount()).toBe(1);
  });

  it('shows the roll-up on the payment form context', async () => {
    const w = await setup();
    await record(w.recorder, paymentBody(w.project, { amountMinor: 40_000_000, milestoneId: w.m1 }));
    const context = await getPaymentContext(w.recorder, String(w.project._id));
    expect(context.milestones.map((m) => [m.title, m.status, m.receivedMinor])).toEqual([['Design sign-off', 'paid', 40_000_000], ['Launch', 'invoiced', 0]]);
  });
});
