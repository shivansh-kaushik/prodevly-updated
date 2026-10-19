import { describe, expect, it } from 'vitest';
import { GET as contextRoute } from '@/app/api/admin/payments/context/route';
import { GET as listRoute, POST as recordRoute } from '@/app/api/admin/payments/route';
import { GET as readRoute, PATCH as editRoute } from '@/app/api/admin/payments/[id]/route';
import { POST as voidRoute } from '@/app/api/admin/payments/[id]/void/route';
import { AuditLog, ClientPayment } from '@/models';
import { setupTestDb } from '@/test/db';
import { makeClient, makeTask } from '@/test/domain-factories';
import { call, cookieFor, makeAdmin, makeSuperadmin } from '@/test/factories';
import { makeBillableProject, makeFxRate, makePaymentFile, paymentBody } from '@/test/payment-factories';

setupTestDb();

const post = (body: unknown, cookie?: string, headers?: Record<string, string>) => ({ method: 'POST', body, cookie, headers });
const patch = (body: unknown, cookie?: string) => ({ method: 'PATCH', body, cookie });
const get = (cookie?: string) => ({ method: 'GET', cookie });

async function actors() {
  const sa = await makeSuperadmin({ name: 'Sara Super' });
  const recorder = await makeAdmin({ name: 'Rita Recorder', grants: ['payment:record', 'payment:view'] });
  const viewer = await makeAdmin({ name: 'Vik Viewer', grants: ['payment:view'] });
  const plain = await makeAdmin({ name: 'Pat Plain' });
  return {
    sa: await cookieFor(sa),
    recorder: await cookieFor(recorder),
    viewer: await cookieFor(viewer),
    plain: await cookieFor(plain),
    recorderDoc: recorder,
  };
}

const record = (cookie: string, project: { _id: unknown }, extra: Record<string, unknown> = {}) =>
  call(recordRoute, '/api/admin/payments', post(paymentBody(project as never, extra as never), cookie));
const writes = async () => ({ payments: await ClientPayment.countDocuments({}), audits: await AuditLog.countDocuments({ action: /^(payment|project)\./ }) });

describe('every route needs a signed-in admin', () => {
  it('answers 401 without a session and changes nothing', async () => {
    const { project } = await makeBillableProject();
    const id = '5f3a1b2c3d4e5f6a7b8c9d0e';
    const results = await Promise.all([
      call(listRoute, '/api/admin/payments', get()),
      call(recordRoute, '/api/admin/payments', post(paymentBody(project))),
      call(contextRoute, `/api/admin/payments/context?projectId=${String(project._id)}`, get()),
      call(readRoute, `/api/admin/payments/${id}`, get(), { id }),
      call(editRoute, `/api/admin/payments/${id}`, patch({ note: 'x' }), { id }),
      call(voidRoute, `/api/admin/payments/${id}/void`, post({ reason: 'abc' }), { id }),
    ]);
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(401));
    expect(await writes()).toEqual({ payments: 0, audits: 0 });
  });

  it('refuses a write that did not come from our own site', async () => {
    const a = await actors();
    const { project } = await makeBillableProject();
    const res = await call(recordRoute, '/api/admin/payments', post(paymentBody(project), a.recorder, { 'sec-fetch-site': 'cross-site' }));
    expect(res.status).toBe(403);
    expect((await writes()).payments).toBe(0);
  });
});

describe('the capability matrix at the route', () => {
  it('shows nothing to someone with no payment access, and writes nothing for them', async () => {
    const a = await actors();
    const { project } = await makeBillableProject();
    const made = await record(a.recorder, project);
    const id = made.body.data.payment.id as string;
    const before = await writes();
    const results = await Promise.all([
      call(listRoute, '/api/admin/payments', get(a.plain)),
      call(readRoute, `/api/admin/payments/${id}`, get(a.plain), { id }),
      record(a.plain, project),
      call(contextRoute, `/api/admin/payments/context?projectId=${String(project._id)}`, get(a.plain)),
      call(editRoute, `/api/admin/payments/${id}`, patch({ note: 'x' }, a.plain), { id }),
      call(voidRoute, `/api/admin/payments/${id}/void`, post({ reason: 'abcd' }, a.plain), { id }),
    ]);
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(403));
    expect(results.every((r) => r.body.ok === false && r.body.error.code === 'FORBIDDEN')).toBe(true);
    expect(await writes()).toEqual(before);
  });

  it('lets payment:view read but not record, edit, void or use the form context', async () => {
    const a = await actors();
    const { project } = await makeBillableProject();
    const made = await record(a.recorder, project);
    const id = made.body.data.payment.id as string;
    const before = await writes();
    expect((await call(listRoute, '/api/admin/payments', get(a.viewer))).status).toBe(200);
    expect((await call(readRoute, `/api/admin/payments/${id}`, get(a.viewer), { id })).status).toBe(200);
    const denied = await Promise.all([
      record(a.viewer, project),
      call(contextRoute, `/api/admin/payments/context?projectId=${String(project._id)}`, get(a.viewer)),
      call(editRoute, `/api/admin/payments/${id}`, patch({ note: 'x' }, a.viewer), { id }),
      call(voidRoute, `/api/admin/payments/${id}/void`, post({ reason: 'abcd' }, a.viewer), { id }),
    ]);
    expect(denied.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    expect(await writes()).toEqual(before);
  });

  it('lets payment:record record and edit but not void; only money:void voids', async () => {
    const a = await actors();
    const { project } = await makeBillableProject();
    const made = await record(a.recorder, project);
    expect(made.status).toBe(201);
    const id = made.body.data.payment.id as string;
    expect((await call(editRoute, `/api/admin/payments/${id}`, patch({ note: 'Remittance received' }, a.recorder), { id })).status).toBe(200);
    expect((await call(contextRoute, `/api/admin/payments/context?projectId=${String(project._id)}`, get(a.recorder))).status).toBe(200);
    expect((await call(voidRoute, `/api/admin/payments/${id}/void`, post({ reason: 'Entered twice' }, a.recorder), { id })).status).toBe(403);
    expect((await ClientPayment.findById(id).lean())?.status).toBe('received');
    const voided = await call(voidRoute, `/api/admin/payments/${id}/void`, post({ reason: 'Entered twice' }, a.sa), { id });
    expect(voided.status).toBe(200);
    expect(voided.body.data.payment).toMatchObject({ status: 'void', voidReason: 'Entered twice', voidedBy: 'Sara Super' });
  });

  it('keeps the advance tick for superadmins at the route as well', async () => {
    const a = await actors();
    const { project } = await makeBillableProject({ amountMinor: 1_000_000 });
    await record(a.recorder, project, { amountMinor: 1_000_000 });
    const tick = { amountMinor: 1_000, recordAsAdvance: true };
    const refused = await record(a.recorder, project, tick);
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('PAYMENT_EXCEEDS_DUE');
    const allowed = await record(a.sa, project, tick);
    expect(allowed.status).toBe(201);
    expect(allowed.body.data.payment.recordedAsAdvance).toBe(true);
  });
});

describe('recording over the API', () => {
  it('answers 201 with the entry, the INR value computed on the server and the warnings', async () => {
    const a = await actors();
    await makeFxRate('USD', 83.42, '2026-10-01');
    const { client, project } = await makeBillableProject();
    const res = await record(a.recorder, project, { amountMinor: 100_000, currency: 'USD', receivedOn: '2026-10-01', transactionRef: 'UTR1' });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.payment).toMatchObject({
      ref: 'PAY-FY27-0001',
      type: 'receipt',
      status: 'received',
      client: { id: String(client._id) },
      amount: { amountMinor: 100_000, currency: 'USD', fxRate: 83.42, fxSource: 'table', inrMinor: 8_342_000 },
      contractEquivalentMinor: 8_342_000,
      transactionRef: 'UTR1',
    });
    expect(res.body.data.payment.warnings).toHaveLength(1);
  });

  it('answers 422 with a field message for a body that is not valid, and writes nothing', async () => {
    const a = await actors();
    const { project } = await makeBillableProject();
    const bad = [
      { amountMinor: 0 },
      { amountMinor: 12.5 },
      { currency: 'ZZZ' },
      { receivedOn: '31/12/2026' },
      { mode: '' },
      { projectId: 'nope' },
      { inrMinor: 1 }, // never accepted from the browser
      { status: 'void' },
    ];
    for (const extra of bad) {
      const res = await record(a.recorder, project, extra);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
    const field = await record(a.recorder, project, { amountMinor: 0 });
    expect(field.body.error.fields).toHaveProperty('amountMinor');
    expect((await writes()).payments).toBe(0);
  });

  it('answers the typed money errors with their codes', async () => {
    const a = await actors();
    const { project } = await makeBillableProject({ amountMinor: 1_000_000 });
    const { project: other } = await makeBillableProject();
    const foreignTask = await makeTask(other);
    const mismatch = await record(a.recorder, project, { taskId: String(foreignTask._id) });
    expect([mismatch.status, mismatch.body.error.code]).toEqual([422, 'LINK_MISMATCH']);
    const noRate = await record(a.recorder, project, { currency: 'USD', amountMinor: 1_000 });
    expect([noRate.status, noRate.body.error.code]).toEqual([422, 'FX_RATE_MISSING']);
    const over = await record(a.recorder, project, { amountMinor: 1_000_001 });
    expect([over.status, over.body.error.code]).toEqual([422, 'PAYMENT_EXCEEDS_DUE']);
    expect((await writes()).payments).toBe(0);
  });

  it('edits through PATCH, refuses an empty or unknown body, and answers 409 for a void entry', async () => {
    const a = await actors();
    const { project } = await makeBillableProject();
    const made = await record(a.recorder, project);
    const id = made.body.data.payment.id as string;
    const ok = await call(editRoute, `/api/admin/payments/${id}`, patch({ amountMinor: 12_000_000, note: 'Corrected' }, a.recorder), { id });
    expect(ok.status).toBe(200);
    expect(ok.body.data.payment).toMatchObject({ note: 'Corrected', amount: { amountMinor: 12_000_000, inrMinor: 12_000_000 } });
    expect((await call(editRoute, `/api/admin/payments/${id}`, patch({}, a.recorder), { id })).status).toBe(422);
    expect((await call(editRoute, `/api/admin/payments/${id}`, patch({ type: 'refund' }, a.recorder), { id })).status).toBe(422);
    expect((await call(editRoute, `/api/admin/payments/${id}`, patch({ status: 'void' }, a.recorder), { id })).status).toBe(422);
    await call(voidRoute, `/api/admin/payments/${id}/void`, post({ reason: 'Entered twice' }, a.sa), { id });
    const locked = await call(editRoute, `/api/admin/payments/${id}`, patch({ note: 'Too late' }, a.recorder), { id });
    expect([locked.status, locked.body.error.code]).toEqual([409, 'CONFLICT']);
  });

  it('answers 404 for an id that is malformed or unknown', async () => {
    const a = await actors();
    for (const id of ['not-an-id', '5f3a1b2c3d4e5f6a7b8c9d0e']) {
      expect((await call(readRoute, `/api/admin/payments/${id}`, get(a.viewer), { id })).status).toBe(404);
      expect((await call(editRoute, `/api/admin/payments/${id}`, patch({ note: 'x' }, a.recorder), { id })).status).toBe(404);
      expect((await call(voidRoute, `/api/admin/payments/${id}/void`, post({ reason: 'abcd' }, a.sa), { id })).status).toBe(404);
    }
  });
});

describe('voiding over the API', () => {
  it('needs a reason of 3 to 300 characters and is final', async () => {
    const a = await actors();
    const { project } = await makeBillableProject();
    const id = (await record(a.recorder, project)).body.data.payment.id as string;
    for (const reason of [undefined, '', 'ab', 'x'.repeat(301)]) {
      const res = await call(voidRoute, `/api/admin/payments/${id}/void`, post({ reason }, a.sa), { id });
      expect(res.status).toBe(422);
      expect(res.body.error.fields).toHaveProperty('reason');
    }
    expect((await call(voidRoute, `/api/admin/payments/${id}/void`, post({ reason: 'Bounced', extra: 1 }, a.sa), { id })).status).toBe(422);
    expect((await ClientPayment.findById(id).lean())?.status).toBe('received');
    expect((await call(voidRoute, `/api/admin/payments/${id}/void`, post({ reason: 'Bounced' }, a.sa), { id })).status).toBe(200);
    expect((await call(voidRoute, `/api/admin/payments/${id}/void`, post({ reason: 'Again' }, a.sa), { id })).status).toBe(409);
    expect(await ClientPayment.countDocuments({})).toBe(1); // never deleted
  });
});

describe('reading over the API', () => {
  it('lists with filters, a summary and paging, and rejects a filter it does not understand', async () => {
    const a = await actors();
    const { client, project } = await makeBillableProject();
    const first = await record(a.recorder, project, { amountMinor: 1_000_000, receivedOn: '2026-08-01', mode: 'upi' });
    const second = await record(a.recorder, project, { amountMinor: 2_000_000, receivedOn: '2026-09-01' });
    await call(voidRoute, `/api/admin/payments/${second.body.data.payment.id}/void`, post({ reason: 'Wrong client' }, a.sa), { id: second.body.data.payment.id });
    await record(a.recorder, project, { amountMinor: 500_000, receivedOn: '2026-09-15', type: 'refund' });

    const all = await call(listRoute, '/api/admin/payments', get(a.viewer));
    expect(all.status).toBe(200);
    expect(all.body.data.payments).toHaveLength(3);
    expect(all.body.data.summary).toMatchObject({ receivedInr: 1_000_000 - 500_000, receipts: 1, refunds: 1, refundsInr: 500_000, voided: 1 });
    expect(all.body.data.meta).toMatchObject({ total: 3, page: 1 });

    const filtered = await call(listRoute, `/api/admin/payments?clientId=${String(client._id)}&status=received&mode=upi&q=&from=2026-08-01&to=2026-08-31`, get(a.viewer));
    expect(filtered.body.data.payments.map((p: { id: string }) => p.id)).toEqual([first.body.data.payment.id]);
    const paged = await call(listRoute, '/api/admin/payments?pageSize=1&page=2&sort=receivedOn&dir=asc', get(a.viewer));
    expect(paged.body.data.payments).toHaveLength(1);
    expect(paged.body.data.meta).toMatchObject({ page: 2, pages: 3, total: 3 });

    for (const query of ['status=paid', 'pageSize=500', 'sort=inr', 'from=yesterday', 'currency=dollars']) {
      expect((await call(listRoute, `/api/admin/payments?${query}`, get(a.viewer))).status).toBe(422);
    }
  });

  it('returns one entry with the attachments the viewer may open, as plain JSON', async () => {
    const a = await actors();
    const { project } = await makeBillableProject();
    const file = await makePaymentFile({ id: String(a.recorderDoc._id), name: a.recorderDoc.name });
    const made = await record(a.recorder, project, { attachmentMediaIds: [String(file._id)] });
    const id = made.body.data.payment.id as string;
    const res = await call(readRoute, `/api/admin/payments/${id}`, get(a.viewer), { id });
    expect(res.status).toBe(200);
    expect(res.body.data.payment.id).toBe(id);
    expect(res.body.data.attachments).toEqual([expect.objectContaining({ id: String(file._id), filename: 'remittance.pdf', url: `/media/${String(file._id)}/remittance.pdf`, visibility: 'private', purpose: 'payment' })]);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/passwordHash|ipHash|"_id"|"__v"|sha256|fileId/);
  });

  it('gives the form context for a project, and refuses a missing or malformed project id', async () => {
    const a = await actors();
    const { client, project } = await makeBillableProject({ currency: 'USD', amountMinor: 2_000_000 });
    const res = await call(contextRoute, `/api/admin/payments/context?projectId=${String(project._id)}`, get(a.recorder));
    expect(res.body.data.context).toMatchObject({ contractCurrency: 'USD', billableMinor: 2_000_000, receivedMinor: 0, client: { id: String(client._id) } });
    expect((await call(contextRoute, '/api/admin/payments/context', get(a.recorder))).status).toBe(422);
    expect((await call(contextRoute, '/api/admin/payments/context?projectId=zzz', get(a.recorder))).status).toBe(422);
    expect((await call(contextRoute, '/api/admin/payments/context?projectId=5f3a1b2c3d4e5f6a7b8c9d0e', get(a.recorder))).status).toBe(404);
  });

  it('never shows a client payment to a viewer of another module', async () => {
    const a = await actors();
    const { project } = await makeBillableProject();
    await record(a.recorder, project);
    const other = await cookieFor(await makeAdmin({ grants: ['payout:view', 'expense:view', 'client:archive'] }));
    expect((await call(listRoute, '/api/admin/payments', get(other))).status).toBe(403);
    // an unrelated client record is not a way in either
    await makeClient();
    expect((await call(listRoute, '/api/admin/payments', get(other))).status).toBe(403);
  });
});

describe('money is never deleted', () => {
  it('has no route that deletes a payment: only void', async () => {
    const modules = [
      await import('@/app/api/admin/payments/route'),
      await import('@/app/api/admin/payments/[id]/route'),
      await import('@/app/api/admin/payments/[id]/void/route'),
      await import('@/app/api/admin/payments/context/route'),
    ];
    for (const m of modules) {
      for (const method of ['DELETE', 'PUT']) expect(m).not.toHaveProperty(method);
    }
  });
});
