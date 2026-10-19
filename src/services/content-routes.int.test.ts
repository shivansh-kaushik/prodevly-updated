import { describe, expect, it, vi } from 'vitest';
import { GET as getOneRoute, PATCH as patchRoute } from '@/app/api/admin/content/[type]/[id]/route';
import { POST as archiveRoute } from '@/app/api/admin/content/[type]/[id]/archive/route';
import { POST as publishRoute } from '@/app/api/admin/content/[type]/[id]/publish/route';
import { POST as restoreRoute } from '@/app/api/admin/content/[type]/[id]/restore/route';
import { POST as unpublishRoute } from '@/app/api/admin/content/[type]/[id]/unpublish/route';
import { POST as reorderRoute } from '@/app/api/admin/content/[type]/reorder/route';
import { GET as listRoute, POST as createRoute } from '@/app/api/admin/content/[type]/route';
import { GET as siteGet, PUT as sitePut } from '@/app/api/admin/content/site/route';
import { AuditLog, ShowcaseItem } from '@/models';
import { makePartner, makeShowcase } from '@/test/content-factories';
import { setupTestDb } from '@/test/db';
import { call, cookieFor, makeAdmin, makeSuperadmin } from '@/test/factories';

const cache = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: cache.revalidateTag, unstable_cache: <T,>(fn: T) => fn }));

setupTestDb();

const cookieOf = async (o: Parameters<typeof makeAdmin>[0] = {}) => cookieFor(await makeAdmin(o));
const post = (cookie: string, body?: unknown) => ({ method: 'POST', body: body ?? {}, cookie });
const put = (cookie: string, body: unknown) => ({ method: 'PUT', body, cookie });
const patch = (cookie: string, body: unknown) => ({ method: 'PATCH', body, cookie });
const path = (type: string, id = '') => `/api/admin/content/${type}${id ? `/${id}` : ''}`;

describe('authentication and capability', () => {
  it('answers 401 to a signed-out caller on every content route', async () => {
    const id = String((await makeShowcase())._id);
    const p = { type: 'showcase', id };
    expect((await call(listRoute, path('showcase'), {}, p)).status).toBe(401);
    expect((await call(createRoute, path('showcase'), { method: 'POST', body: { title: 'Shop', summary: 'A shop' } }, p)).status).toBe(401);
    expect((await call(getOneRoute, path('showcase', id), {}, p)).status).toBe(401);
    expect((await call(patchRoute, path('showcase', id), { method: 'PATCH', body: { title: 'New' } }, p)).status).toBe(401);
    for (const route of [publishRoute, unpublishRoute, archiveRoute, restoreRoute]) {
      expect((await call(route, path('showcase', id), { method: 'POST', body: {} }, p)).status).toBe(401);
    }
    expect((await call(reorderRoute, path('showcase'), { method: 'POST', body: { ids: [id] } }, p)).status).toBe(401);
    expect((await call(siteGet, '/api/admin/content/site')).status).toBe(401);
    expect((await call(sitePut, '/api/admin/content/site', { method: 'PUT', body: { displayName: 'X' } })).status).toBe(401);
    expect(await ShowcaseItem.countDocuments()).toBe(1);
  });

  it('gives a plain admin the editing routes but 403 on every publish-level route, changing nothing', async () => {
    const cookie = await cookieOf();
    const live = await makeShowcase({ published: true });
    const draft = await makeShowcase();
    const id = String(draft._id);
    const liveId = String(live._id);

    expect((await call(listRoute, path('showcase'), { cookie }, { type: 'showcase' })).status).toBe(200);
    expect((await call(getOneRoute, path('showcase', id), { cookie }, { type: 'showcase', id })).status).toBe(200);
    expect((await call(patchRoute, path('showcase', id), patch(cookie, { summary: 'Changed summary' }), { type: 'showcase', id })).status).toBe(200);
    expect((await call(reorderRoute, path('showcase'), post(cookie, { ids: [id] }), { type: 'showcase' })).status).toBe(200);

    for (const [route, target] of [[publishRoute, id], [unpublishRoute, liveId], [archiveRoute, id], [restoreRoute, id]] as const) {
      const res = await call(route, path('showcase', target), post(cookie), { type: 'showcase', id: target });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    // editing something already live is publish-level too
    expect((await call(patchRoute, path('showcase', liveId), patch(cookie, { summary: 'Changed live' }), { type: 'showcase', id: liveId })).status).toBe(403);
    expect((await ShowcaseItem.findById(liveId).lean())?.status).toBe('published');
    expect((await ShowcaseItem.findById(id).lean())?.status).toBe('draft');

    expect((await call(siteGet, '/api/admin/content/site', { cookie })).status).toBe(200);
    expect((await call(sitePut, '/api/admin/content/site', put(cookie, { displayName: 'ProDevly' }))).status).toBe(403);
    expect(await AuditLog.countDocuments({ action: /publish|archive|restore|site_info/ })).toBe(0);
  });

  it('turns away a deactivated admin and one who still has to change their password', async () => {
    const gone = await makeAdmin();
    const cookie = await cookieFor(gone);
    const { Admin } = await import('@/models');
    await Admin.updateOne({ _id: gone._id }, { $set: { status: 'deactivated' } });
    expect((await call(listRoute, path('showcase'), { cookie }, { type: 'showcase' })).status).toBe(401);

    const pending = await cookieOf({ mustChangePassword: true });
    const res = await call(listRoute, path('showcase'), { cookie: pending }, { type: 'showcase' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('refuses a cross-site write', async () => {
    const cookie = await cookieOf();
    const res = await call(createRoute, path('showcase'), { method: 'POST', body: { title: 'Shop', summary: 'A shop' }, cookie, headers: { 'sec-fetch-site': 'cross-site' } }, { type: 'showcase' });
    expect(res.status).toBe(403);
    expect(await ShowcaseItem.countDocuments()).toBe(0);
  });
});

describe('addressing', () => {
  it('answers 404 for an unknown content type, "site" used as a type, or a malformed id', async () => {
    const cookie = await cookieOf();
    for (const type of ['widgets', 'site', 'SHOWCASE', '__proto__']) {
      expect((await call(listRoute, path(type), { cookie }, { type })).status).toBe(404);
      expect((await call(createRoute, path(type), { method: 'POST', body: { title: 'Shop', summary: 'A shop' }, cookie }, { type })).status).toBe(404);
    }
    expect((await call(getOneRoute, path('showcase', 'nope'), { cookie }, { type: 'showcase', id: 'nope' })).status).toBe(404);
    expect((await call(patchRoute, path('showcase', 'nope'), patch(cookie, { title: 'New' }), { type: 'showcase', id: 'nope' })).status).toBe(404);
  });

  it('keeps types apart: a partner id is not found under showcase', async () => {
    const cookie = await cookieOf();
    const partner = String((await makePartner())._id);
    expect((await call(getOneRoute, path('showcase', partner), { cookie }, { type: 'showcase', id: partner })).status).toBe(404);
  });
});

describe('validation', () => {
  it('names the field at fault, with 422', async () => {
    const cookie = await cookieOf();
    const create = (body: unknown, type = 'showcase') => call(createRoute, path(type), post(cookie, body), { type });
    const missing = await create({});
    expect(missing.status).toBe(422);
    expect(missing.body.error.fields).toHaveProperty('title');
    expect(missing.body.error.fields).toHaveProperty('summary');
    expect((await create({ title: 'Shop', summary: 'A shop', liveUrl: 'javascript:alert(1)' })).body.error.fields).toHaveProperty('liveUrl');
    expect((await create({ title: 'Shop', summary: 'A shop', status: 'published' })).status).toBe(422);
    expect((await create({ displayName: 'Dev', bio: 'x'.repeat(281) }, 'developers')).body.error.fields).toHaveProperty('bio');
    expect((await create({ name: 'Pro', priceModel: 'fixed_from', amountMinor: 19.99, currency: 'INR' }, 'pricing')).body.error.fields).toHaveProperty('amountMinor');
    expect((await create({ name: 'Acme', kind: 'rival' }, 'partners')).body.error.fields).toHaveProperty('kind');
    expect(await ShowcaseItem.countDocuments()).toBe(0);
  });

  it('refuses a body that is not JSON, or is too large', async () => {
    const cookie = await cookieOf();
    const notJson = await call(createRoute, path('showcase'), { method: 'POST', rawBody: 'title=Shop', cookie }, { type: 'showcase' });
    expect(notJson.status).toBe(400);
    const big = await call(createRoute, path('showcase'), post(cookie, { title: 'Shop', summary: 'x'.repeat(70_000) }), { type: 'showcase' });
    expect(big.status).toBe(413);
  });

  it('shows a service-level refusal as a 422 with the field, e.g. a link to something that does not exist', async () => {
    const cookie = await cookieOf();
    const res = await call(createRoute, path('showcase'), post(cookie, { title: 'Shop', summary: 'A shop', serviceIds: ['65f1c2a4b6d3e8a9c0b1d2e3'] }), { type: 'showcase' });
    expect(res.status).toBe(422);
    expect(res.body.error.fields).toHaveProperty('serviceIds');
  });

  it('rejects an empty patch and unknown fields', async () => {
    const cookie = await cookieOf();
    const id = String((await makeShowcase())._id);
    expect((await call(patchRoute, path('showcase', id), patch(cookie, {}), { type: 'showcase', id })).status).toBe(422);
    expect((await call(patchRoute, path('showcase', id), patch(cookie, { slug: 'hijack' }), { type: 'showcase', id })).status).toBe(422);
  });
});

describe('the whole life of an item, over HTTP', () => {
  it('draft, a refused publish naming the missing tick, the tick, publish, edit, unpublish, archive, restore', async () => {
    const cookie = await cookieOf({ grants: ['content:publish'] });
    const created = await call(createRoute, path('showcase'), post(cookie, { title: 'Flower Shop', summary: 'A shop for a florist' }), { type: 'showcase' });
    expect(created.status).toBe(201);
    const id = created.body.data.item.id as string;
    expect(created.body.data.item).toMatchObject({ status: 'draft', slug: 'flower-shop' });
    const p = { type: 'showcase', id };

    const refused = await call(publishRoute, path('showcase', id), post(cookie), p);
    expect(refused.status).toBe(422);
    expect(refused.body.error.fields).toHaveProperty('clientApproved');
    expect(refused.body.error.message).toMatch(/client has approved/);

    expect((await call(patchRoute, path('showcase', id), patch(cookie, { clientApproved: true }), p)).status).toBe(200);
    const live = await call(publishRoute, path('showcase', id), post(cookie), p);
    expect(live.status).toBe(200);
    expect(live.body.data.item.status).toBe('published');
    expect(cache.revalidateTag).toHaveBeenCalledWith('content:showcase', 'max');

    expect((await call(patchRoute, path('showcase', id), patch(cookie, { summary: 'An updated summary' }), p)).body.data.item.summary).toBe('An updated summary');
    expect((await call(unpublishRoute, path('showcase', id), post(cookie), p)).body.data.item.status).toBe('draft');
    expect((await call(archiveRoute, path('showcase', id), post(cookie), p)).body.data.item.status).toBe('archived');
    expect((await call(patchRoute, path('showcase', id), patch(cookie, { summary: 'Nope' }), p)).status).toBe(409);
    expect((await call(restoreRoute, path('showcase', id), post(cookie), p)).body.data.item.status).toBe('draft');

    const list = await call(listRoute, `${path('showcase')}?status=draft`, { cookie }, { type: 'showcase' });
    expect(list.body.data.items.map((i: { id: string }) => i.id)).toEqual([id]);
    expect((await call(listRoute, `${path('showcase')}?status=published`, { cookie }, { type: 'showcase' })).body.data.items).toEqual([]);
    expect((await call(getOneRoute, path('showcase', id), { cookie }, p)).body.data.item.id).toBe(id);
  });

  it('returns plain JSON: no _id, no Mongoose internals', async () => {
    const cookie = await cookieOf();
    await makeShowcase();
    const res = await call(listRoute, path('showcase'), { cookie }, { type: 'showcase' });
    expect(JSON.stringify(res.body)).not.toMatch(/"_id"|"__v"/);
  });

  it('reorders over HTTP and rejects a repeated id', async () => {
    const cookie = await cookieOf();
    const [a, b] = [String((await makePartner())._id), String((await makePartner())._id)];
    const ok = await call(reorderRoute, path('partners'), post(cookie, { ids: [b, a] }), { type: 'partners' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ moved: 2 });
    expect((await call(reorderRoute, path('partners'), post(cookie, { ids: [a, a] }), { type: 'partners' })).status).toBe(422);
    expect((await call(listRoute, path('partners'), { cookie }, { type: 'partners' })).body.data.items.map((i: { id: string }) => i.id)).toEqual([b, a]);
  });
});

describe('company info over HTTP', () => {
  it('is read by an editor and saved by a publisher, who may clear fields', async () => {
    const publisher = await cookieFor(await makeAdmin({ grants: ['content:publish'] }));
    const saved = await call(sitePut, '/api/admin/content/site', put(publisher, { displayName: 'ProDevly', email: 'Hello@Example.com', social: { github: 'https://github.com/prodevly' } }));
    expect(saved.status).toBe(200);
    expect(saved.body.data.site).toMatchObject({ email: 'hello@example.com', social: { github: 'https://github.com/prodevly' } });
    const cleared = await call(sitePut, '/api/admin/content/site', put(publisher, { displayName: 'ProDevly' }));
    expect(cleared.body.data.site.email).toBeNull();
    const read = await call(siteGet, '/api/admin/content/site', { cookie: await cookieFor(await makeSuperadmin()) });
    expect(read.body.data.site.displayName).toBe('ProDevly');
  });

  it('rejects a bad address, a bad phone and a missing display name with 422', async () => {
    const cookie = await cookieFor(await makeSuperadmin());
    const res = await call(sitePut, '/api/admin/content/site', put(cookie, { email: 'nope', phone: 'call me', social: { x: 'javascript:alert(1)' } }));
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['displayName', 'email', 'phone', 'social.x']);
  });
});
