import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { GET as getRoute, PATCH as patchRoute } from '@/app/api/admin/expenses/[id]/route';
import { POST as approveRoute } from '@/app/api/admin/expenses/[id]/approve/route';
import { POST as markPaidRoute } from '@/app/api/admin/expenses/[id]/mark-paid/route';
import { POST as rejectRoute } from '@/app/api/admin/expenses/[id]/reject/route';
import { POST as voidRoute } from '@/app/api/admin/expenses/[id]/void/route';
import { GET as listRoute, POST as createRoute } from '@/app/api/admin/expenses/route';
import { AuditLog, Expense } from '@/models';
import { setupTestDb } from '@/test/db';
import { companyPaid, insertExpense, makeExpenseWorld, outOfPocket } from '@/test/expense-factories';
import { call, cookieFor, makeAdmin } from '@/test/factories';

setupTestDb();

const id = (d: { _id: Types.ObjectId }) => String(d._id);
const post = (body: unknown, cookie?: string, headers?: Record<string, string>) => ({ method: 'POST', body, cookie, headers });

/** A date inside the real current financial year that is never in the future, so these tests do not depend on a fixed "now". */
const today = () => new Date().toISOString().slice(0, 10);
const dates = () => ({ spentOn: today() });

async function cookies() {
  const w = await makeExpenseWorld();
  return {
    w,
    plain: await cookieFor(w.plain),
    other: await cookieFor(w.other),
    recorder: await cookieFor(w.recorder),
    sa: await cookieFor(w.superadmin),
  };
}

describe('every expense route needs a signed-in admin', () => {
  it('answers 401 without a session, whatever the method, and changes nothing', async () => {
    const w = await makeExpenseWorld();
    const e = await insertExpense({ status: 'submitted', paidBy: w.plain });
    const eid = id(e);
    const p = { id: eid };
    const answers = await Promise.all([
      call(listRoute, '/api/admin/expenses'),
      call(createRoute, '/api/admin/expenses', post(outOfPocket())),
      call(getRoute, `/api/admin/expenses/${eid}`, {}, p),
      call(patchRoute, `/api/admin/expenses/${eid}`, { method: 'PATCH', body: { description: 'Nope' } }, p),
      call(approveRoute, `/api/admin/expenses/${eid}/approve`, post({}), p),
      call(rejectRoute, `/api/admin/expenses/${eid}/reject`, post({ reason: 'Nope' }), p),
      call(markPaidRoute, `/api/admin/expenses/${eid}/mark-paid`, post({ paidOn: today(), mode: 'upi' }), p),
      call(voidRoute, `/api/admin/expenses/${eid}/void`, post({ reason: 'Nope' }), p),
    ]);
    expect(answers.map((a) => a.status)).toEqual(Array(8).fill(401));
    expect((await Expense.findById(e._id).lean())?.status).toBe('submitted');
    expect(await Expense.countDocuments()).toBe(1);
  });

  it('refuses a cross-site write and an account that still has to change its password', async () => {
    const { plain } = await cookies();
    expect((await call(createRoute, '/api/admin/expenses', post({ ...outOfPocket(), ...dates() }, plain, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    const fresh = await makeAdmin({ mustChangePassword: true });
    const pending = await call(createRoute, '/api/admin/expenses', post({ ...outOfPocket(), ...dates() }, await cookieFor(fresh)));
    expect(pending.status).toBe(403);
    expect(pending.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(await Expense.countDocuments()).toBe(0);
  });
});

describe('create and read', () => {
  it('submits an out-of-pocket expense (201) as the signed-in admin, and a recorder records a company-paid one', async () => {
    const { w, plain, recorder } = await cookies();
    const sub = await call(createRoute, '/api/admin/expenses', post({ ...outOfPocket(), ...dates() }, plain));
    expect(sub.status).toBe(201);
    expect(sub.body.data.expense).toMatchObject({ status: 'submitted', paidFrom: 'admin', paidBy: { id: id(w.plain) }, can: { edit: true, void: true, approve: false } });
    expect(JSON.stringify(sub.body)).not.toMatch(/"_id"|"__v"/);

    const paid = await call(createRoute, '/api/admin/expenses', post({ ...companyPaid(), ...dates(), paidOn: today() }, recorder));
    expect(paid.status).toBe(201);
    expect(paid.body.data.expense).toMatchObject({ status: 'paid', paidFrom: 'company' });
  });

  it('answers 403 when a plain admin tries to record a company-paid expense, and writes nothing', async () => {
    const { plain } = await cookies();
    const res = await call(createRoute, '/api/admin/expenses', post({ ...companyPaid(), ...dates(), paidOn: today() }, plain));
    expect(res.status).toBe(403);
    expect(await Expense.countDocuments()).toBe(0);
    expect(await AuditLog.countDocuments()).toBe(0);
  });

  it('rejects bad input with 422 and field messages', async () => {
    const { w, recorder, plain } = await cookies();
    const bad = (body: unknown, cookie = recorder) => call(createRoute, '/api/admin/expenses', post(body, cookie));
    const base = { ...companyPaid(), ...dates(), paidOn: today() };
    expect((await bad({ ...base, description: '' })).body.error.fields.description).toBeDefined();
    expect((await bad({ ...base, amountMinor: 0 })).body.error.fields.amountMinor).toBeDefined();
    expect((await bad({ ...base, amountMinor: 12.5 })).status).toBe(422);
    expect((await bad({ ...base, amountMinor: -5 })).status).toBe(422);
    expect((await bad({ ...base, currency: 'XYZ' })).body.error.fields.currency).toBeDefined();
    expect((await bad({ ...base, spentOn: '2026-02-30' })).body.error.fields.spentOn).toBeDefined();
    expect((await bad({ ...base, category: '' })).body.error.fields.category).toBeDefined();
    expect((await bad({ ...base, paidOn: undefined })).body.error.fields.paidOn).toBeDefined();
    expect((await bad({ ...base, scope: 'project' })).body.error.fields.projectId).toBeDefined();
    expect((await bad({ ...base, projectId: 'not-an-id', scope: 'project' })).status).toBe(422);
    expect((await bad({ ...base, receiptMediaIds: ['nope'] })).status).toBe(422);
    expect((await bad({ ...base, inrMinor: 1 })).status).toBe(422); // the INR value is never accepted
    expect((await bad({ ...base, status: 'approved' })).status).toBe(422); // status is not settable
    expect((await bad({ ...base, paidByAdmin: { id: id(w.other), name: 'x' } })).status).toBe(422);
    expect((await bad({ ...outOfPocket(), ...dates(), mode: 'upi' }, plain)).body.error.fields.mode).toBeDefined();
    const garbage = await call(createRoute, '/api/admin/expenses', { rawBody: '{nope', cookie: recorder, headers: { 'content-type': 'application/json' } });
    expect(garbage.status).toBe(400);
    expect(await Expense.countDocuments()).toBe(0);
  });

  it('answers LINK_MISMATCH (422) when the client does not own the project', async () => {
    const { w, recorder } = await cookies();
    const res = await call(createRoute, '/api/admin/expenses', post({ ...companyPaid(), ...dates(), paidOn: today(), scope: 'project', projectId: id(w.project), clientId: id(w.otherClient) }, recorder));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('LINK_MISMATCH');
    expect(await Expense.countDocuments()).toBe(0);
  });

  it('lists only the admin\'s own out-of-pocket expenses to a plain admin, and everything to a recorder', async () => {
    const { w, plain, recorder } = await cookies();
    await insertExpense({ status: 'submitted', paidBy: w.plain, description: 'Mine' });
    await insertExpense({ status: 'submitted', paidBy: w.other, description: 'Theirs' });
    await insertExpense({ status: 'paid', description: 'Company' });
    const mine = await call(listRoute, '/api/admin/expenses', { cookie: plain });
    expect(mine.body.data.items.map((i: { description: string }) => i.description)).toEqual(['Mine']);
    expect(mine.body.data.meta.total).toBe(1);
    expect((await call(listRoute, '/api/admin/expenses?person=' + id(w.other), { cookie: plain })).body.data.meta.total).toBe(1);
    const all = await call(listRoute, '/api/admin/expenses?pageSize=2&page=2&sort=ref&dir=asc', { cookie: recorder });
    expect(all.body.data.meta).toMatchObject({ total: 3, page: 2 });
    expect(all.body.data.items).toHaveLength(1);
    expect((await call(listRoute, '/api/admin/expenses?status=submitted&q=theirs', { cookie: recorder })).body.data.meta.total).toBe(1);
    expect((await call(listRoute, '/api/admin/expenses?status=bogus&projectId=zzz&from=nope', { cookie: recorder })).body.data.meta.total).toBe(3); // bad filters are ignored
  });

  it('answers 404 for someone else\'s expense, a malformed id and an unknown id', async () => {
    const { w, plain, recorder } = await cookies();
    const theirs = id(await insertExpense({ status: 'submitted', paidBy: w.other }));
    expect((await call(getRoute, `/api/admin/expenses/${theirs}`, { cookie: plain }, { id: theirs })).status).toBe(404);
    expect((await call(getRoute, `/api/admin/expenses/${theirs}`, { cookie: recorder }, { id: theirs })).status).toBe(200);
    expect((await call(getRoute, '/api/admin/expenses/nope', { cookie: recorder }, { id: 'nope' })).status).toBe(404);
    const missing = String(new Types.ObjectId());
    expect((await call(getRoute, `/api/admin/expenses/${missing}`, { cookie: recorder }, { id: missing })).status).toBe(404);
    expect((await call(patchRoute, `/api/admin/expenses/${theirs}`, { method: 'PATCH', body: { description: 'Edited by a stranger' }, cookie: plain }, { id: theirs })).status).toBe(404);
    expect((await call(voidRoute, `/api/admin/expenses/${theirs}/void`, post({ reason: 'Not yours' }, plain), { id: theirs })).status).toBe(404);
  });
});

describe('approve, reject, mark paid and void', () => {
  it('answers 403 to everyone but a superadmin on approve, reject and mark-paid, and changes nothing', async () => {
    const { w, plain, recorder } = await cookies();
    const submitted = id(await insertExpense({ status: 'submitted', paidBy: w.plain }));
    const approved = id(await insertExpense({ status: 'approved', paidBy: w.plain }));
    for (const cookie of [plain, recorder]) {
      expect((await call(approveRoute, `/api/admin/expenses/${submitted}/approve`, post({}, cookie), { id: submitted })).status).toBe(403);
      expect((await call(rejectRoute, `/api/admin/expenses/${submitted}/reject`, post({ reason: 'Not allowed' }, cookie), { id: submitted })).status).toBe(403);
      expect((await call(markPaidRoute, `/api/admin/expenses/${approved}/mark-paid`, post({ paidOn: today(), mode: 'upi' }, cookie), { id: approved })).status).toBe(403);
    }
    expect((await Expense.findById(submitted).lean())?.status).toBe('submitted');
    expect((await Expense.findById(approved).lean())?.status).toBe('approved');
    expect(await AuditLog.countDocuments()).toBe(0);
  });

  it('walks submitted to approved to paid, and answers 409 for a move that is not allowed', async () => {
    const { w, plain, sa } = await cookies();
    const sub = await call(createRoute, '/api/admin/expenses', post({ ...outOfPocket(), ...dates() }, plain));
    const eid = sub.body.data.expense.id as string;
    const p = { id: eid };

    expect((await call(markPaidRoute, `/api/admin/expenses/${eid}/mark-paid`, post({ paidOn: today(), mode: 'upi' }, sa), p)).status).toBe(409);
    const approved = await call(approveRoute, `/api/admin/expenses/${eid}/approve`, post({}, sa), p);
    expect(approved.status).toBe(200);
    expect(approved.body.data.expense).toMatchObject({ status: 'approved', approvedBy: w.superadmin.name, can: { markPaid: true, approve: false } });
    expect((await call(approveRoute, `/api/admin/expenses/${eid}/approve`, post({}, sa), p)).status).toBe(409);
    expect((await call(rejectRoute, `/api/admin/expenses/${eid}/reject`, post({ reason: 'Too late now' }, sa), p)).status).toBe(409);

    const bad = await call(markPaidRoute, `/api/admin/expenses/${eid}/mark-paid`, post({ paidOn: today(), mode: 'barter' }, sa), p);
    expect(bad.status).toBe(422);
    expect(bad.body.error.fields.mode).toBeDefined();
    const paid = await call(markPaidRoute, `/api/admin/expenses/${eid}/mark-paid`, post({ paidOn: today(), mode: 'bank_transfer', transactionRef: 'UTR1' }, sa), p);
    expect(paid.status).toBe(200);
    expect(paid.body.data.expense).toMatchObject({ status: 'paid', mode: 'bank_transfer', transactionRef: 'UTR1' });
    expect(paid.body.data.expense.statusHistory.map((h: { to: string }) => h.to)).toEqual(['submitted', 'approved', 'paid']);
  });

  it('rejects with a reason (422 without one) and leaves the expense on record', async () => {
    const { w, sa } = await cookies();
    const eid = id(await insertExpense({ status: 'submitted', paidBy: w.plain }));
    const p = { id: eid };
    expect((await call(rejectRoute, `/api/admin/expenses/${eid}/reject`, post({}, sa), p)).body.error.fields.reason).toBeDefined();
    expect((await call(rejectRoute, `/api/admin/expenses/${eid}/reject`, post({ reason: 'x' }, sa), p)).status).toBe(422);
    const res = await call(rejectRoute, `/api/admin/expenses/${eid}/reject`, post({ reason: 'Personal trip' }, sa), p);
    expect(res.status).toBe(200);
    expect(res.body.data.expense).toMatchObject({ status: 'rejected', rejectReason: 'Personal trip' });
  });

  it('lets a submitter withdraw their own submitted expense, and nobody but a superadmin void a paid one', async () => {
    const { w, plain, other, recorder, sa } = await cookies();
    const sub = await call(createRoute, '/api/admin/expenses', post({ ...outOfPocket(), ...dates() }, plain));
    const eid = sub.body.data.expense.id as string;
    const p = { id: eid };
    expect((await call(voidRoute, `/api/admin/expenses/${eid}/void`, post({ reason: 'Not mine to withdraw' }, other), p)).status).toBe(404);
    expect((await call(voidRoute, `/api/admin/expenses/${eid}/void`, post({}, plain), p)).body.error.fields.reason).toBeDefined();
    const withdrawn = await call(voidRoute, `/api/admin/expenses/${eid}/void`, post({ reason: 'Entered by mistake' }, plain), p);
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.data.expense.status).toBe('void');
    expect((await call(voidRoute, `/api/admin/expenses/${eid}/void`, post({ reason: 'Again please' }, sa), p)).status).toBe(409);

    const paid = id(await insertExpense({ status: 'paid', paidBy: w.plain }));
    const q = { id: paid };
    expect((await call(voidRoute, `/api/admin/expenses/${paid}/void`, post({ reason: 'Wrong entry' }, plain), q)).status).toBe(403);
    expect((await call(voidRoute, `/api/admin/expenses/${paid}/void`, post({ reason: 'Wrong entry' }, recorder), q)).status).toBe(403);
    expect((await call(voidRoute, `/api/admin/expenses/${paid}/void`, post({ reason: 'Wrong entry' }, sa), q)).status).toBe(200);
  });

  it('edits through PATCH, but never status, history or the INR value', async () => {
    const { plain, w, sa } = await cookies();
    const eid = id(await insertExpense({ status: 'submitted', paidBy: w.plain }));
    const p = { id: eid };
    const ok = await call(patchRoute, `/api/admin/expenses/${eid}`, { method: 'PATCH', body: { description: 'Taxi, corrected', payee: null }, cookie: plain }, p);
    expect(ok.status).toBe(200);
    expect(ok.body.data.expense.description).toBe('Taxi, corrected');
    for (const body of [{ status: 'approved' }, { statusHistory: [] }, { amount: { inrMinor: 1 } }, { paidFrom: 'company' }, { paidByAdmin: null }, { approvedBy: null }, {}]) {
      expect((await call(patchRoute, `/api/admin/expenses/${eid}`, { method: 'PATCH', body, cookie: plain }, p)).status, JSON.stringify(body)).toBe(422);
    }
    // after approval a plain admin is refused and a superadmin may edit
    await call(approveRoute, `/api/admin/expenses/${eid}/approve`, post({}, sa), p);
    expect((await call(patchRoute, `/api/admin/expenses/${eid}`, { method: 'PATCH', body: { description: 'After approval' }, cookie: plain }, p)).status).toBe(403);
    expect((await call(patchRoute, `/api/admin/expenses/${eid}`, { method: 'PATCH', body: { description: 'After approval' }, cookie: sa }, p)).status).toBe(200);
  });
});
