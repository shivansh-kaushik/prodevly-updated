import { describe, expect, it } from 'vitest';
import { AuditLog, ThirdParty } from '@/models';
import { GET as getRoute, PATCH as patchRoute } from '@/app/api/admin/third-parties/[id]/route';
import { POST as archiveRoute } from '@/app/api/admin/third-parties/[id]/archive/route';
import { POST as restoreRoute } from '@/app/api/admin/third-parties/[id]/restore/route';
import { GET as listRoute, POST as createRoute } from '@/app/api/admin/third-parties/route';
import { setupTestDb } from '@/test/db';
import { call, cookieFor, makeAdmin, makeSuperadmin } from '@/test/factories';
import { makeOrder, makeParty } from '@/test/third-party-factories';
import { makeClient, makeProject } from '@/test/domain-factories';

setupTestDb();

const NOTE = 'HDFC 5010-0099-1234 IFSC HDFC0001234';
const id = (d: { _id: unknown }) => String(d._id);
const asSuper = async () => cookieFor(await makeSuperadmin());
const asEditor = async () => cookieFor(await makeAdmin({ grants: ['thirdParty:edit'] }));
const asPlain = async () => cookieFor(await makeAdmin());

describe('every third-party route needs a signed-in admin', () => {
  it('answers 401 without a session, whatever the method, and writes nothing', async () => {
    const party = await makeParty();
    const p = { id: id(party) };
    const answers = await Promise.all([
      call(listRoute, '/api/admin/third-parties'),
      call(createRoute, '/api/admin/third-parties', { body: { name: 'Nope Studio', type: 'freelancer' } }),
      call(getRoute, `/api/admin/third-parties/${p.id}`, {}, p),
      call(patchRoute, `/api/admin/third-parties/${p.id}`, { method: 'PATCH', body: { name: 'Nope' } }, p),
      call(archiveRoute, `/api/admin/third-parties/${p.id}/archive`, { method: 'POST', body: {} }, p),
      call(restoreRoute, `/api/admin/third-parties/${p.id}/restore`, { method: 'POST', body: {} }, p),
    ]);
    expect(answers.map((a) => a.status)).toEqual(Array(6).fill(401));
    expect(await ThirdParty.countDocuments({})).toBe(1);
  });

  it('refuses a cross-site write and an account that still has to change its password', async () => {
    const cookie = await asSuper();
    const crossSite = await call(createRoute, '/api/admin/third-parties', { body: { name: 'Cross Site', type: 'freelancer' }, cookie, headers: { 'sec-fetch-site': 'cross-site' } });
    expect(crossSite.status).toBe(403);
    const pending = await call(createRoute, '/api/admin/third-parties', { body: { name: 'Pending Pw', type: 'freelancer' }, cookie: await cookieFor(await makeAdmin({ mustChangePassword: true })) });
    expect(pending.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(await ThirdParty.countDocuments({})).toBe(0);
  });
});

describe('capabilities', () => {
  it('lets every admin read the directory and only thirdParty:edit write', async () => {
    const party = await makeParty();
    const plain = await asPlain();
    expect((await call(listRoute, '/api/admin/third-parties', { cookie: plain })).status).toBe(200);
    expect((await call(getRoute, `/api/admin/third-parties/${id(party)}`, { cookie: plain }, { id: id(party) })).status).toBe(200);
    const writes = await Promise.all([
      call(createRoute, '/api/admin/third-parties', { body: { name: 'Nope Studio', type: 'freelancer' }, cookie: plain }),
      call(patchRoute, `/api/admin/third-parties/${id(party)}`, { method: 'PATCH', body: { name: 'Renamed' }, cookie: plain }, { id: id(party) }),
      call(archiveRoute, `/api/admin/third-parties/${id(party)}/archive`, { method: 'POST', body: {}, cookie: plain }, { id: id(party) }),
    ]);
    expect(writes.map((r) => [r.status, r.body.error.code])).toEqual(Array(3).fill([403, 'FORBIDDEN']));
    expect(await ThirdParty.countDocuments({})).toBe(1);
    expect(await AuditLog.countDocuments({})).toBe(0);
  });
});

describe('create, read, update', () => {
  it('creates (201), lists with filters and reads back, with no raw Mongo fields', async () => {
    const cookie = await asEditor();
    const res = await call(createRoute, '/api/admin/third-parties', { body: { name: 'Pixel Forge', type: 'agency', skills: ['react'], country: 'in' }, cookie });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, data: { thirdParty: { ref: 'TP-0001', name: 'Pixel Forge', type: 'agency', country: 'IN', status: 'active' } } });
    const tid = res.body.data.thirdParty.id as string;
    await makeParty({ name: 'Other Vendor', type: 'vendor' });
    const list = await call(listRoute, '/api/admin/third-parties?type=agency', { cookie });
    expect(list.body.data.meta.total).toBe(1);
    expect((await call(listRoute, '/api/admin/third-parties?q=other&pageSize=1', { cookie })).body.data.items).toHaveLength(1);
    expect((await call(listRoute, '/api/admin/third-parties?status=bogus&type=', { cookie })).body.data.meta.total).toBe(2); // bad filters are ignored
    const read = await call(getRoute, `/api/admin/third-parties/${tid}`, { cookie }, { id: tid });
    expect(read.body.data.thirdParty.id).toBe(tid);
    expect(JSON.stringify(read.body)).not.toMatch(/"_id"|"__v"|nameLower/);
  });

  it('rejects bad input with 422 and field messages, and unknown ids with 404', async () => {
    const cookie = await asEditor();
    const bad = (body: unknown) => call(createRoute, '/api/admin/third-parties', { body, cookie });
    expect((await bad({ type: 'freelancer' })).body.error.fields.name).toBeDefined();
    expect((await bad({ name: 'Valid Name', type: 'wizard' })).body.error.fields.type).toBeDefined();
    expect((await bad({ name: 'Valid Name', type: 'freelancer', email: 'nope' })).body.error.fields.email).toBeDefined();
    expect((await bad({ name: 'Valid Name', type: 'freelancer', ref: 'TP-9' })).status).toBe(422);
    expect((await call(createRoute, '/api/admin/third-parties', { rawBody: '{nope', cookie, headers: { 'content-type': 'application/json' } })).status).toBe(400);
    expect((await call(getRoute, '/api/admin/third-parties/nope', { cookie }, { id: 'nope' })).status).toBe(404);
    const party = await makeParty();
    const patch = (body: unknown) => call(patchRoute, `/api/admin/third-parties/${id(party)}`, { method: 'PATCH', body, cookie }, { id: id(party) });
    expect((await patch({})).status).toBe(422);
    expect((await patch({ ref: 'TP-9999' })).status).toBe(422);
    expect((await patch({ name: 'Renamed Studio', phone: null })).body.data.thirdParty.name).toBe('Renamed Studio');
    expect(await ThirdParty.countDocuments({})).toBe(1);
  });

  it('archives and restores, answering CONFLICT for a repeat and when work is open', async () => {
    const cookie = await asEditor();
    const party = await makeParty();
    const p = { id: id(party) };
    const archive = () => call(archiveRoute, `/api/admin/third-parties/${p.id}/archive`, { method: 'POST', body: {}, cookie }, p);
    const restore = () => call(restoreRoute, `/api/admin/third-parties/${p.id}/restore`, { method: 'POST', body: {}, cookie }, p);
    expect((await restore()).status).toBe(409);
    expect((await archive()).body.data.thirdParty.archived).toBe(true);
    expect((await archive()).body.error.code).toBe('CONFLICT');
    expect((await restore()).body.data.thirdParty.archived).toBe(false);
    const project = await makeProject(await makeClient());
    await makeOrder(party, project);
    expect((await archive()).body.error.code).toBe('CONFLICT');
  });
});

describe('the payment note', () => {
  it('is refused for thirdParty:edit alone, written by a superadmin, and shown only to a superadmin', async () => {
    const editor = await asEditor();
    const sa = await asSuper();
    const refused = await call(createRoute, '/api/admin/third-parties', { body: { name: 'Sneaky Studio', type: 'freelancer', paymentNote: NOTE }, cookie: editor });
    expect([refused.status, refused.body.error.code]).toEqual([403, 'FORBIDDEN']);
    expect(await ThirdParty.countDocuments({})).toBe(0);

    const created = await call(createRoute, '/api/admin/third-parties', { body: { name: 'Pixel Forge', type: 'agency', paymentNote: NOTE }, cookie: sa });
    expect(created.status).toBe(201);
    const tid = created.body.data.thirdParty.id as string;
    const p = { id: tid };
    const edit = await call(patchRoute, `/api/admin/third-parties/${tid}`, { method: 'PATCH', body: { paymentNote: 'Changed' }, cookie: editor }, p);
    expect([edit.status, edit.body.error.code]).toEqual([403, 'FORBIDDEN']);

    const asEditorRead = await call(getRoute, `/api/admin/third-parties/${tid}`, { cookie: editor }, p);
    expect(asEditorRead.body.data.thirdParty.payDetails).toBeNull();
    const asSuperRead = await call(getRoute, `/api/admin/third-parties/${tid}`, { cookie: sa }, p);
    expect(asSuperRead.body.data.thirdParty.payDetails).toEqual({ note: NOTE });

    for (const cookie of [editor, sa, await asPlain()]) {
      const list = await call(listRoute, '/api/admin/third-parties', { cookie });
      expect(JSON.stringify(list.body)).not.toContain('HDFC');
      expect(JSON.stringify(list.body)).not.toContain('paymentNote');
    }
    expect(JSON.stringify(asEditorRead.body)).not.toContain('HDFC');
    expect(JSON.stringify(await AuditLog.find({}).lean())).not.toContain('HDFC');
  });
});
