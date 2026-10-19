import { describe, expect, it, vi } from 'vitest';
import { AuditLog, ClientPayment, Task } from '@/models';
import { getPayment, getPaymentContext, recordPayment, searchPayments, updatePayment, voidPayment } from '@/services/client-payment.service';
import { setupTestDb } from '@/test/db';
import { makeClient, makeProject, makeTask } from '@/test/domain-factories';
import {
  D,
  NOW,
  makeBillableProject,
  makeFxRate,
  makeInternalClient,
  makePaymentFile,
  paymentActors,
  paymentBody,
  paymentCount,
  rejects,
  viewerWith,
} from '@/test/payment-factories';

setupTestDb();

const record = (viewer: Parameters<typeof recordPayment>[0], body: Parameters<typeof recordPayment>[1]) => recordPayment(viewer, body, {}, NOW);
const writes = async () => ({ payments: await paymentCount(), audits: await AuditLog.countDocuments({ action: /^(payment|project)\./ }) });

describe('who may do what', () => {
  it('needs payment:record to record, and writes nothing without it', async () => {
    const { viewer, plain, sa } = await paymentActors();
    const { project } = await makeBillableProject();
    const before = await writes();
    for (const who of [viewer, plain, viewerWith(sa, { remove: ['payment:record'] })]) {
      const error = await rejects(record(who, paymentBody(project)));
      expect(error.code).toBe('FORBIDDEN');
    }
    expect(await writes()).toEqual(before);
  });

  it('needs payment:view to list or read, and shows a viewer everything they may see', async () => {
    const { viewer, plain, recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    const made = await record(recorder, paymentBody(project));
    expect((await rejects(searchPayments(plain))).code).toBe('FORBIDDEN');
    expect((await rejects(getPayment(plain, made.id))).code).toBe('FORBIDDEN');
    expect((await searchPayments(viewer)).items).toHaveLength(1);
    expect((await getPayment(viewer, made.id)).ref).toBe(made.ref);
  });

  it('needs payment:record for the form context, and payment:view alone does not give it', async () => {
    const { viewer, recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    expect((await rejects(getPaymentContext(viewer, String(project._id)))).code).toBe('FORBIDDEN');
    expect((await getPaymentContext(recorder, String(project._id))).contractCurrency).toBe('INR');
  });

  it('needs money:void to void, and money:approve for the advance tick', async () => {
    const { recorder, sa } = await paymentActors();
    const { project } = await makeBillableProject({ amountMinor: 10_000_000 });
    const made = await record(recorder, paymentBody(project, { amountMinor: 10_000_000 }));
    expect((await rejects(voidPayment(recorder, made.id, { reason: 'Entered twice' }))).code).toBe('FORBIDDEN');
    expect((await rejects(voidPayment(viewerWith(sa, { remove: ['money:void'] }), made.id, { reason: 'Entered twice' }))).code).toBe('FORBIDDEN');
    expect((await ClientPayment.findById(made.id).lean())?.status).toBe('received');

    // over the billable total: a recorder cannot, even asking for the advance; a superadmin must ask
    const tooMuch = paymentBody(project, { amountMinor: 1_000, recordAsAdvance: true });
    expect((await rejects(record(recorder, tooMuch))).code).toBe('PAYMENT_EXCEEDS_DUE');
    expect((await rejects(record(sa, { ...tooMuch, recordAsAdvance: undefined }))).code).toBe('PAYMENT_EXCEEDS_DUE');
    expect((await record(sa, tooMuch)).recordedAsAdvance).toBe(true);
    expect(await paymentCount()).toBe(2);
  });
});

describe('links are derived on the server', () => {
  it('derives the client from the project and records who recorded it', async () => {
    const { recorder } = await paymentActors();
    const { client, project } = await makeBillableProject();
    const made = await record(recorder, paymentBody(project));
    expect(made).toMatchObject({
      type: 'receipt',
      status: 'received',
      clientId: String(client._id),
      projectId: String(project._id),
      taskId: null,
      milestoneId: null,
      client: { id: String(client._id), name: 'Acme Robotics' },
      project: { id: String(project._id), name: 'Checkout redesign' },
      task: null,
      milestone: null,
      recordedBy: 'Rita Recorder',
      receivedOn: '2026-10-01',
    });
    expect(made.ref).toBe('PAY-FY27-0001');
    const doc = await ClientPayment.findById(made.id).lean();
    expect(String(doc?.clientId)).toBe(String(client._id));
  });

  it('accepts a client that matches and refuses one that does not (LINK_MISMATCH), writing nothing', async () => {
    const { recorder } = await paymentActors();
    const { client, project } = await makeBillableProject();
    const other = await makeClient({ name: 'Someone else' });
    expect((await record(recorder, paymentBody(project, { clientId: String(client._id) }))).client.id).toBe(String(client._id));
    const before = await writes();
    const error = await rejects(record(recorder, paymentBody(project, { clientId: String(other._id) })));
    expect(error.code).toBe('LINK_MISMATCH');
    expect(error.fields).toHaveProperty('clientId');
    expect(await writes()).toEqual(before);
  });

  it('takes a task of the project, and touches it so a concurrent move conflicts', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    const task = await makeTask(project, { title: 'Payment step' });
    const stamp = (await Task.findById(task._id).lean())?.updatedAt.getTime() ?? 0;
    await new Promise((r) => setTimeout(r, 15));
    const made = await record(recorder, paymentBody(project, { taskId: String(task._id) }));
    expect(made.task).toMatchObject({ id: String(task._id), title: 'Payment step' });
    expect((await Task.findById(task._id).lean())?.updatedAt.getTime()).toBeGreaterThan(stamp);
    const audit = await AuditLog.findOne({ action: 'payment.create' }).lean();
    expect(String(audit?.context?.taskId)).toBe(String(task._id));
    expect(String(audit?.context?.projectId)).toBe(String(project._id));
  });

  it('refuses a task from another project (LINK_MISMATCH), a missing one, an archived one and a cancelled one', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    const { project: other } = await makeBillableProject();
    const foreign = await makeTask(other);
    const archived = await makeTask(project, { archivedAt: new Date() });
    const cancelled = await makeTask(project, { status: 'cancelled' });
    const before = await writes();

    expect((await rejects(record(recorder, paymentBody(project, { taskId: String(foreign._id) })))).code).toBe('LINK_MISMATCH');
    expect((await rejects(record(recorder, paymentBody(project, { taskId: '5f3a1b2c3d4e5f6a7b8c9d0e' })))).code).toBe('VALIDATION_FAILED');
    expect((await rejects(record(recorder, paymentBody(project, { taskId: String(archived._id) })))).code).toBe('CONFLICT');
    expect((await rejects(record(recorder, paymentBody(project, { taskId: String(cancelled._id) })))).code).toBe('VALIDATION_FAILED');
    expect(await writes()).toEqual(before);
  });

  it('takes a milestone of the project and refuses one that is not (LINK_MISMATCH)', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject({ pricingModel: 'milestone', milestones: [{ title: 'Design', amountMinor: 40_000_000 }] });
    const { project: other } = await makeBillableProject({ milestones: [{ title: 'Elsewhere', amountMinor: 1_000_000 }] });
    const mine = project.milestones[0]!;
    const theirs = other.milestones[0]!;

    const made = await record(recorder, paymentBody(project, { milestoneId: String(mine._id), amountMinor: 1_000_000 }));
    expect(made.milestone).toEqual({ id: String(mine._id), title: 'Design' });
    const error = await rejects(record(recorder, paymentBody(project, { milestoneId: String(theirs._id) })));
    expect(error.code).toBe('LINK_MISMATCH');
    expect(error.fields).toHaveProperty('milestoneId');
  });

  it('refuses a project that does not exist, one that is archived, and an internal one', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    const archived = await makeProject(await makeClient(), { archivedAt: new Date(), contract: { pricingModel: 'fixed', amountMinor: 1_000_000, currency: 'INR' } });
    const internal = await makeProject(await makeInternalClient(), { contract: { pricingModel: 'fixed', amountMinor: 1_000_000, currency: 'INR' } });
    const before = await writes();
    expect((await rejects(record(recorder, paymentBody(project, { projectId: '5f3a1b2c3d4e5f6a7b8c9d0e' })))).code).toBe('VALIDATION_FAILED');
    expect((await rejects(record(recorder, paymentBody(archived)))).code).toBe('CONFLICT');
    const internalError = await rejects(record(recorder, paymentBody(internal)));
    expect(internalError.code).toBe('VALIDATION_FAILED');
    expect(internalError.fields).toHaveProperty('projectId');
    expect(await writes()).toEqual(before);
  });
});

describe('ids have one spelling', () => {
  it('treats an UPPERCASE id exactly like the lowercase one, for the project, task, milestone and client', async () => {
    const { recorder } = await paymentActors();
    const { client, project } = await makeBillableProject({ milestones: [{ title: 'Design', amountMinor: 40_000_000 }] });
    const other = await makeClient({ name: 'Someone else' });
    const task = await makeTask(project);
    const up = (id: unknown) => String(id).toUpperCase();
    const made = await record(recorder, paymentBody(project, { projectId: up(project._id), clientId: up(client._id), taskId: up(task._id), milestoneId: up(project.milestones[0]!._id) }));
    expect(made.project.id).toBe(String(project._id));
    expect(made.task?.id).toBe(String(task._id));
    // an uppercase client that is NOT the owner is still a mismatch
    expect((await rejects(record(recorder, paymentBody(project, { clientId: up(other._id) })))).code).toBe('LINK_MISMATCH');
    expect((await getPayment(recorder, made.id.toUpperCase())).id).toBe(made.id);
    expect((await updatePayment(recorder, made.id.toUpperCase(), { note: 'x', taskId: null }, {}, NOW)).task).toBeNull();
  });
});

describe('the exchange rate is captured on the server', () => {
  it('stores an INR entry at rate 1 from the identity source', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    const made = await record(recorder, paymentBody(project, { amountMinor: 12_345_600 }));
    expect(made.amount).toEqual({ amountMinor: 12_345_600, currency: 'INR', fxRate: 1, fxDate: '2026-10-01', fxSource: 'identity', inrMinor: 12_345_600 });
    expect(made.contractEquivalentMinor).toBe(12_345_600);
  });

  it('stores a foreign entry at the table rate for its date, with the INR value computed (USD 1,000.00 at 83.42)', async () => {
    const { recorder } = await paymentActors();
    await makeFxRate('USD', 83.42, '2026-09-30');
    const { project } = await makeBillableProject();
    const made = await record(recorder, paymentBody(project, { amountMinor: 100_000, currency: 'USD', receivedOn: '2026-10-01' }));
    // the row it used is Wednesday's, and the entry says so
    expect(made.amount).toEqual({ amountMinor: 100_000, currency: 'USD', fxRate: 83.42, fxDate: '2026-09-30', fxSource: 'table', inrMinor: 8_342_000 });
    expect(made.warnings).toHaveLength(1);
    expect(made.warnings[0]).toMatch(/Paid in USD against a INR contract/);
  });

  it('answers FX_RATE_MISSING with no rate on file, or only a stale one, and writes nothing', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    const body = paymentBody(project, { amountMinor: 100_000, currency: 'USD' });
    expect((await rejects(record(recorder, body))).code).toBe('FX_RATE_MISSING');
    await makeFxRate('USD', 83.42, '2026-09-01'); // 30 days before: stale
    expect((await rejects(record(recorder, body))).code).toBe('FX_RATE_MISSING');
    expect(await paymentCount()).toBe(0);
  });

  it('takes the exact rate the bank used (manual) or the INR that arrived (bank), and refuses both', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    const manual = await record(recorder, paymentBody(project, { amountMinor: 100_000, currency: 'USD', manualRate: 84.1 }));
    expect(manual.amount).toMatchObject({ fxRate: 84.1, fxSource: 'manual', inrMinor: 8_410_000, fxDate: '2026-10-01' });
    const bank = await record(recorder, paymentBody(project, { amountMinor: 100_000, currency: 'USD', settledInrMinor: 8_300_000 }));
    expect(bank.amount).toMatchObject({ fxRate: 83, fxSource: 'bank', inrMinor: 8_300_000 });
    const both = await rejects(record(recorder, paymentBody(project, { amountMinor: 100_000, currency: 'USD', manualRate: 84, settledInrMinor: 8_400_000 })));
    expect(both.code).toBe('VALIDATION_FAILED');
  });

  it('never lets the browser set the INR value, the status or anything it is not meant to', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    for (const extra of [{ inrMinor: 1 }, { status: 'void' }, { recordedBy: { name: 'Someone' } }, { amount: { inrMinor: 1 } }, { ref: 'PAY-FY27-9999' }]) {
      const error = await rejects(record(recorder, { ...paymentBody(project), ...extra } as never));
      expect(error.code).toBe('VALIDATION_FAILED');
    }
    expect(await paymentCount()).toBe(0);
  });

  it('refuses a currency that is not enabled, an amount of zero, and a fraction of a minor unit', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    expect((await rejects(record(recorder, paymentBody(project, { currency: 'JPY', manualRate: 0.55 })))).fields).toHaveProperty('currency');
    expect((await rejects(record(recorder, paymentBody(project, { amountMinor: 0 })))).code).toBe('VALIDATION_FAILED');
    expect((await rejects(record(recorder, paymentBody(project, { amountMinor: 10.5 })))).code).toBe('VALIDATION_FAILED');
    expect(await paymentCount()).toBe(0);
  });
});

describe('the date, the mode and the optional fields', () => {
  it('refuses a date after today in the organisation zone, and accepts today', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    const error = await rejects(record(recorder, paymentBody(project, { receivedOn: '2026-10-13' })));
    expect(error.fields).toHaveProperty('receivedOn');
    expect((await record(recorder, paymentBody(project, { receivedOn: '2026-10-12' }))).receivedOn).toBe('2026-10-12');
    // 20:00 UTC on 12 Oct is already 13 Oct in India
    const late = new Date('2026-10-12T20:00:00Z');
    expect((await recordPayment(recorder, paymentBody(project, { receivedOn: '2026-10-13' }), {}, late)).receivedOn).toBe('2026-10-13');
  });

  it('refuses a mode that Settings does not list', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    const error = await rejects(record(recorder, paymentBody(project, { mode: 'barter' })));
    expect(error.fields).toHaveProperty('mode');
    expect((await record(recorder, paymentBody(project, { mode: 'upi' }))).mode).toBe('upi');
  });

  it('stores TDS, charges, references and a note, and leaves empty text unset', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    const made = await record(
      recorder,
      paymentBody(project, { tdsMinor: 100_000, chargesMinor: 5_000, transactionRef: ' UTR123 ', invoiceRef: 'INV-7', note: 'Second instalment', mode: 'bank_transfer' }),
    );
    expect(made).toMatchObject({ tdsMinor: 100_000, chargesMinor: 5_000, transactionRef: 'UTR123', invoiceRef: 'INV-7', note: 'Second instalment' });
    const bare = await record(recorder, paymentBody(project, { tdsMinor: 0, transactionRef: '', note: '   ' }));
    expect(bare).toMatchObject({ tdsMinor: null, chargesMinor: null, transactionRef: null, note: null });
  });

  it('numbers each financial year from 1: PAY-FY27-0001, then PAY-FY27-0002, and FY26 on its own', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    const a = await record(recorder, paymentBody(project, { receivedOn: '2026-04-01', amountMinor: 1_000 }));
    const b = await record(recorder, paymentBody(project, { receivedOn: '2026-05-01', amountMinor: 1_000 }));
    const c = await record(recorder, paymentBody(project, { receivedOn: '2026-03-31', amountMinor: 1_000 }));
    expect([a.ref, b.ref, c.ref]).toEqual(['PAY-FY27-0001', 'PAY-FY27-0002', 'PAY-FY26-0001']);
  });
});

describe('attachments are private payment files', () => {
  it('accepts private payment files and refuses public ones, other purposes and ids that do not exist', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    const good = await makePaymentFile(recorder);
    const publicFile = await makePaymentFile(recorder, { visibility: 'public' });
    const receipt = await makePaymentFile(recorder, { purpose: 'expense' });

    const made = await record(recorder, paymentBody(project, { attachmentMediaIds: [String(good._id), String(good._id)] }));
    expect(made.attachmentMediaIds).toEqual([String(good._id)]);
    for (const id of [String(publicFile._id), String(receipt._id), '5f3a1b2c3d4e5f6a7b8c9d0e']) {
      const error = await rejects(record(recorder, paymentBody(project, { attachmentMediaIds: [id] })));
      expect(error.fields).toHaveProperty('attachmentMediaIds');
    }
    expect(await paymentCount()).toBe(1);
  });
});

describe('the contract equivalent', () => {
  it('equals the amount in the contract currency, and refuses a different figure there', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject({ currency: 'USD', amountMinor: 1_000_000 });
    await makeFxRate('USD', 83.42, '2026-10-01');
    const made = await record(recorder, paymentBody(project, { amountMinor: 250_000, currency: 'USD' }));
    expect(made.contractEquivalentMinor).toBe(250_000);
    expect(made.contractCurrency).toBe('USD');
    expect(made.warnings).toEqual([]);
    const error = await rejects(record(recorder, paymentBody(project, { amountMinor: 250_000, currency: 'USD', contractEquivalentMinor: 240_000 })));
    expect(error.fields).toHaveProperty('contractEquivalentMinor');
  });

  it('works an INR payment out against a USD contract from the contract currency rate on that day', async () => {
    const { recorder } = await paymentActors();
    await makeFxRate('USD', 83.42, '2026-10-01');
    const { project } = await makeBillableProject({ currency: 'USD', amountMinor: 1_000_000 });
    // INR 83,420.00 = USD 1,000.00
    const made = await record(recorder, paymentBody(project, { amountMinor: 8_342_000, currency: 'INR' }));
    expect(made.contractEquivalentMinor).toBe(100_000);
    expect(made.warnings[0]).toMatch(/Paid in INR against a USD contract: it counts as USD 1,000.00/);
  });

  it('works one foreign currency out against another through their two INR rates', async () => {
    const { recorder } = await paymentActors();
    await makeFxRate('EUR', 90, '2026-10-01');
    await makeFxRate('USD', 80, '2026-10-01');
    const { project } = await makeBillableProject({ currency: 'USD', amountMinor: 1_000_000 });
    // EUR 100.00 = INR 9,000.00 = USD 112.50
    const made = await record(recorder, paymentBody(project, { amountMinor: 10_000, currency: 'EUR' }));
    expect(made.amount.inrMinor).toBe(900_000);
    expect(made.contractEquivalentMinor).toBe(11_250);
  });

  it('asks the person to say it when the contract currency has no usable rate, and takes their figure', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject({ currency: 'USD', amountMinor: 1_000_000 });
    const body = paymentBody(project, { amountMinor: 8_342_000, currency: 'INR' });
    const error = await rejects(record(recorder, body));
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.fields).toHaveProperty('contractEquivalentMinor');
    expect(await paymentCount()).toBe(0);
    expect((await record(recorder, { ...body, contractEquivalentMinor: 99_000 })).contractEquivalentMinor).toBe(99_000);
  });

  it('lets a corrected figure win over the one the rates give', async () => {
    const { recorder } = await paymentActors();
    await makeFxRate('USD', 83.42, '2026-10-01');
    const { project } = await makeBillableProject({ currency: 'USD', amountMinor: 1_000_000 });
    const made = await record(recorder, paymentBody(project, { amountMinor: 8_342_000, currency: 'INR', contractEquivalentMinor: 99_500 }));
    expect(made.contractEquivalentMinor).toBe(99_500);
  });
});

describe('PAYMENT_EXCEEDS_DUE', () => {
  it('lets receipts add up to the contract and refuses the one that goes over, writing nothing', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject({ amountMinor: 100_000_000 });
    await record(recorder, paymentBody(project, { amountMinor: 60_000_000 }));
    await record(recorder, paymentBody(project, { amountMinor: 40_000_000 })); // exactly the contract: fine
    const before = await writes();
    const error = await rejects(record(recorder, paymentBody(project, { amountMinor: 1 })));
    expect(error.code).toBe('PAYMENT_EXCEEDS_DUE');
    expect(error.message).toMatch(/more than the INR 10,00,000.00 billable/);
    expect(await writes()).toEqual(before);
  });

  it('records an advance only when a superadmin ticks it, flags it and says so', async () => {
    const { sa } = await paymentActors();
    const { project } = await makeBillableProject({ amountMinor: 10_000_000 });
    await record(sa, paymentBody(project, { amountMinor: 10_000_000 }));
    expect((await rejects(record(sa, paymentBody(project, { amountMinor: 500_000 })))).code).toBe('PAYMENT_EXCEEDS_DUE');
    const advance = await record(sa, paymentBody(project, { amountMinor: 500_000, recordAsAdvance: true }));
    expect(advance.recordedAsAdvance).toBe(true);
    expect(advance.warnings.some((w) => /advance/.test(w))).toBe(true);
    const audit = await AuditLog.findOne({ action: 'payment.create', 'entity.id': advance.id }).lean();
    expect(audit?.changes.some((c) => c.path === 'recordedAsAdvance' && c.after === true)).toBe(true);
    // ticking it when nothing exceeds is harmless and leaves no flag
    const { project: roomy } = await makeBillableProject();
    expect((await record(sa, paymentBody(roomy, { amountMinor: 1_000, recordAsAdvance: true }))).recordedAsAdvance).toBe(false);
  });

  it('counts an hourly project by its invoiced and paid milestones only, and nothing billable means nothing to receive', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject({
      pricingModel: 'hourly',
      amountMinor: 0,
      milestones: [
        { title: 'March invoice', amountMinor: 3_000_000, status: 'invoiced' },
        { title: 'February invoice', amountMinor: 2_000_000, status: 'paid' },
        { title: 'Not yet billed', amountMinor: 9_000_000, status: 'pending' },
      ],
    });
    await record(recorder, paymentBody(project, { amountMinor: 5_000_000 }));
    expect((await rejects(record(recorder, paymentBody(project, { amountMinor: 1 })))).code).toBe('PAYMENT_EXCEEDS_DUE');

    const { project: unbilled } = await makeBillableProject({ pricingModel: 'retainer', amountMinor: 0 });
    const error = await rejects(record(recorder, paymentBody(unbilled, { amountMinor: 1_000 })));
    expect(error.code).toBe('PAYMENT_EXCEEDS_DUE');
    expect(error.message).toMatch(/Nothing is billable/);
  });

  it('never blocks another currency than the contract: it returns a warning', async () => {
    const { recorder } = await paymentActors();
    await makeFxRate('USD', 83.42, '2026-10-01');
    const { project } = await makeBillableProject({ amountMinor: 1_000_000 }); // INR 10,000.00
    const made = await record(recorder, paymentBody(project, { amountMinor: 100_000, currency: 'USD' })); // INR 83,42,000: far over
    expect(made.status).toBe('received');
    expect(made.warnings).toHaveLength(1);
    expect(made.warnings[0]).toMatch(/above what is billable/);
  });

  it('gives the room back when an entry is voided', async () => {
    const { recorder, sa } = await paymentActors();
    const { project } = await makeBillableProject({ amountMinor: 10_000_000 });
    const full = await record(recorder, paymentBody(project, { amountMinor: 10_000_000 }));
    expect((await rejects(record(recorder, paymentBody(project, { amountMinor: 1_000 })))).code).toBe('PAYMENT_EXCEEDS_DUE');
    await voidPayment(sa, full.id, { reason: 'Bounced cheque' });
    expect((await record(recorder, paymentBody(project, { amountMinor: 10_000_000 }))).status).toBe('received');
  });

  it('lets only one of two receipts recorded at the same moment through when together they are too much', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject({ amountMinor: 100_000_000 });
    // Different financial years, so they do not share a reference counter: only the project lock can stop them.
    const results = await Promise.allSettled([
      record(recorder, paymentBody(project, { amountMinor: 60_000_000, receivedOn: '2026-09-01' })),
      record(recorder, paymentBody(project, { amountMinor: 60_000_000, receivedOn: '2026-03-15' })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect((failed?.reason as { code?: string }).code).toBe('PAYMENT_EXCEEDS_DUE');
    expect(await paymentCount()).toBe(1);
  });
});

describe('refunds', () => {
  it('reduce what counts as received, so the room comes back', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject({ amountMinor: 100_000_000 });
    await record(recorder, paymentBody(project, { amountMinor: 100_000_000 }));
    const refund = await record(recorder, paymentBody(project, { type: 'refund', amountMinor: 30_000_000 }));
    expect(refund.type).toBe('refund');
    expect((await getPaymentContext(recorder, String(project._id))).receivedMinor).toBe(70_000_000);
    await record(recorder, paymentBody(project, { amountMinor: 30_000_000 })); // fits again
    expect((await rejects(record(recorder, paymentBody(project, { amountMinor: 1 })))).code).toBe('PAYMENT_EXCEEDS_DUE');
  });

  it('cannot be more than was received, and the receipt they depend on cannot be voided first', async () => {
    const { recorder, sa } = await paymentActors();
    const { project } = await makeBillableProject();
    const receipt = await record(recorder, paymentBody(project, { amountMinor: 5_000_000 }));
    const error = await rejects(record(recorder, paymentBody(project, { type: 'refund', amountMinor: 5_000_001 })));
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.fields).toHaveProperty('amountMinor');
    const refund = await record(recorder, paymentBody(project, { type: 'refund', amountMinor: 2_000_000 }));
    expect((await rejects(voidPayment(sa, receipt.id, { reason: 'Wrong project' }))).code).toBe('CONFLICT');
    await voidPayment(sa, refund.id, { reason: 'Refund never sent' });
    expect((await voidPayment(sa, receipt.id, { reason: 'Wrong project' })).status).toBe('void');
  });

  it('count in INR as negative: the list summary nets them out', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    await record(recorder, paymentBody(project, { amountMinor: 5_000_000 }));
    await record(recorder, paymentBody(project, { type: 'refund', amountMinor: 1_000_000 }));
    const page = await searchPayments(recorder);
    expect(page.summary).toMatchObject({ receivedInr: 4_000_000, receipts: 1, refunds: 1, refundsInr: 1_000_000 });
  });
});

describe('the audit trail', () => {
  it('writes one payment.create entry with the project, client and amount in context', async () => {
    const { recorder } = await paymentActors();
    const { client, project } = await makeBillableProject();
    const made = await record(recorder, paymentBody(project, { amountMinor: 12_300_000 }));
    const entries = await AuditLog.find({ action: 'payment.create' }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entity: { type: 'payment', ref: made.ref }, actor: { name: 'Rita Recorder' } });
    expect(String(entries[0]?.context?.clientId)).toBe(String(client._id));
    expect(entries[0]?.summary).toBe(`Received INR 1,23,000.00 on ${project.ref}`);
  });

  it('rolls the payment and its reference number back when the audit entry cannot be written', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject();
    const spy = vi.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('audit store is down'));
    await expect(record(recorder, paymentBody(project))).rejects.toThrow('audit store is down');
    spy.mockRestore();
    expect(await paymentCount()).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'payment.create' })).toBe(0);
    // the number the failed attempt would have used is still free
    expect((await record(recorder, paymentBody(project))).ref).toBe('PAY-FY27-0001');
  });

  it('does not burn a reference number on a refused payment', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject({ amountMinor: 1_000 });
    await record(recorder, paymentBody(project, { amountMinor: 1_000 }));
    await rejects(record(recorder, paymentBody(project, { amountMinor: 1 })));
    expect((await record(recorder, paymentBody(project, { type: 'refund', amountMinor: 1 }))).ref).toBe('PAY-FY27-0002');
  });
});

describe('reading the ledger', () => {
  async function ledger() {
    const actors = await paymentActors();
    await makeFxRate('USD', 83.42, '2026-07-10');
    const a = await makeBillableProject({ client: await makeClient({ name: 'Alpha Ltd' }), amountMinor: 900_000_000 });
    const b = await makeBillableProject({ client: await makeClient({ name: 'Beta Inc' }), amountMinor: 900_000_000 });
    const first = await record(actors.recorder, paymentBody(a.project, { amountMinor: 10_000_000, receivedOn: '2026-06-10', mode: 'bank_transfer', transactionRef: 'UTR-AAA' }));
    const second = await record(actors.recorder, paymentBody(a.project, { amountMinor: 100_000, currency: 'USD', receivedOn: '2026-07-10', mode: 'wise', invoiceRef: 'INV-77' }));
    const third = await record(actors.recorder, paymentBody(b.project, { amountMinor: 20_000_000, receivedOn: '2026-08-10', mode: 'upi' }));
    await voidPayment(actors.sa, third.id, { reason: 'Entered on the wrong client' });
    const fourth = await record(actors.recorder, paymentBody(b.project, { amountMinor: 3_000_000, receivedOn: '2026-09-10', mode: 'upi' }));
    return { ...actors, a, b, first, second, third, fourth };
  }

  it('lists everything newest first, shows void rows, and totals only what is not void', async () => {
    const w = await ledger();
    const page = await searchPayments(w.viewer);
    expect(page.items.map((p) => p.id)).toEqual([w.fourth.id, w.third.id, w.second.id, w.first.id]);
    expect(page.items.find((p) => p.id === w.third.id)?.status).toBe('void');
    expect(page.summary).toEqual({ receivedInr: 10_000_000 + 8_342_000 + 3_000_000, receipts: 3, refunds: 0, refundsInr: 0, voided: 1 });
    expect(page.meta).toMatchObject({ total: 4, page: 1, pages: 1 });
  });

  it('filters by client, project, status, mode, currency, type and period, and searches references literally', async () => {
    const w = await ledger();
    const ids = async (f: Parameters<typeof searchPayments>[1]) => (await searchPayments(w.viewer, f)).items.map((p) => p.id);
    expect(await ids({ clientId: String(w.a.client._id) })).toEqual([w.second.id, w.first.id]);
    expect(await ids({ projectId: String(w.b.project._id) })).toEqual([w.fourth.id, w.third.id]);
    expect(await ids({ status: 'void' })).toEqual([w.third.id]);
    expect(await ids({ status: 'received', mode: 'upi' })).toEqual([w.fourth.id]);
    expect(await ids({ currency: 'usd' })).toEqual([w.second.id]);
    expect(await ids({ type: 'refund' })).toEqual([]);
    expect(await ids({ from: D('2026-07-01'), to: D('2026-08-31') })).toEqual([w.third.id, w.second.id]);
    expect(await ids({ q: 'utr-aaa' })).toEqual([w.first.id]);
    expect(await ids({ q: 'INV-77' })).toEqual([w.second.id]);
    expect(await ids({ q: w.fourth.ref })).toEqual([w.fourth.id]);
    expect(await ids({ q: '.*' })).toEqual([]); // matched literally, never as a pattern
  });

  it('sorts and pages, and rejects values it does not understand', async () => {
    const w = await ledger();
    const byAmount = await searchPayments(w.viewer, { sort: 'amount', dir: 'desc', pageSize: 2 });
    expect(byAmount.items.map((p) => p.id)).toEqual([w.third.id, w.first.id]);
    expect(byAmount.meta).toMatchObject({ total: 4, pages: 2, page: 1, from: 1, to: 2 });
    const second = await searchPayments(w.viewer, { sort: 'amount', dir: 'desc', pageSize: 2, page: 2 });
    expect(second.items.map((p) => p.id)).toEqual([w.second.id, w.fourth.id]);
    expect((await rejects(searchPayments(w.viewer, { status: 'bogus' as never }))).code).toBe('VALIDATION_FAILED');
    expect((await rejects(searchPayments(w.viewer, { mode: '{"$ne":1}' }))).code).toBe('VALIDATION_FAILED');
    expect((await rejects(searchPayments(w.viewer, { currency: 'US' }))).code).toBe('VALIDATION_FAILED');
    // an operator object where a value belongs is refused, never turned into a filter
    for (const bad of [{ mode: { $ne: null } }, { q: { $ne: 1 } }, { status: { $ne: 'void' } }, { currency: { $ne: 'INR' } }, { clientId: { $ne: null } }, { from: { $gt: 0 } }]) {
      const error = await rejects(searchPayments(w.viewer, bad as never));
      expect(['VALIDATION_FAILED', 'NOT_FOUND']).toContain(error.code);
    }
    expect((await searchPayments(w.viewer, { page: 99 })).meta.page).toBe(1);
  });

  it('returns plain objects: string ids, ISO dates, no document internals', async () => {
    const w = await ledger();
    const dto = await getPayment(w.viewer, w.second.id);
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
    expect(Object.keys(dto)).not.toContain('_id');
    expect(Object.keys(dto)).not.toContain('__v');
    expect(dto.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(dto.client.name).toBe('Alpha Ltd');
    expect((await rejects(getPayment(w.viewer, 'not-an-id'))).code).toBe('NOT_FOUND');
    expect((await rejects(getPayment(w.viewer, '5f3a1b2c3d4e5f6a7b8c9d0e'))).code).toBe('NOT_FOUND');
  });

  it('gives the form what it needs: contract currency, billable, received and each milestone with what it has received', async () => {
    const { recorder } = await paymentActors();
    const { project } = await makeBillableProject({
      pricingModel: 'milestone',
      amountMinor: 50_000_000,
      milestones: [
        { title: 'Design', amountMinor: 20_000_000, dueOn: '2026-11-01' },
        { title: 'Build', amountMinor: 30_000_000, status: 'pending' },
      ],
    });
    await record(recorder, paymentBody(project, { amountMinor: 5_000_000, milestoneId: String(project.milestones[0]!._id) }));
    const context = await getPaymentContext(recorder, String(project._id));
    expect(context).toMatchObject({ contractCurrency: 'INR', pricingModel: 'milestone', billableMinor: 50_000_000, receivedMinor: 5_000_000, outstandingMinor: 45_000_000 });
    expect(context.milestones).toEqual([
      expect.objectContaining({ title: 'Design', amountMinor: 20_000_000, dueOn: '2026-11-01', status: 'invoiced', receivedMinor: 5_000_000 }),
      expect.objectContaining({ title: 'Build', status: 'pending', receivedMinor: 0 }),
    ]);
  });
});

describe('the capability is checked before the id is looked at', () => {
  it('answers FORBIDDEN, not NOT_FOUND, to someone who may not act', async () => {
    const { plain, viewer } = await paymentActors();
    expect((await rejects(updatePayment(viewer, 'zzz', { note: 'x' }))).code).toBe('FORBIDDEN');
    expect((await rejects(voidPayment(plain, 'zzz', { reason: 'abc' }))).code).toBe('FORBIDDEN');
  });
});
