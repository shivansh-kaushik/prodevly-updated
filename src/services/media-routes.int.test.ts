import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETE as deleteRoute } from '@/app/api/admin/media/[id]/route';
import { GET as listRoute, POST as uploadRoute } from '@/app/api/admin/media/route';
import { countStoredFiles } from '@/lib/db/gridfs';
import { MAX_PRIVATE_BYTES } from '@/lib/media/rules';
import { AuditLog, Media } from '@/models';
import { avifBytes, makeMedia, makePartner, noParams, padTo, pdfBytes, pngBytes, uniquePng, uploadRequest, webpBytes } from '@/test/content-factories';
import { setupTestDb } from '@/test/db';
import { call, cookieFor, makeAdmin, makeSuperadmin } from '@/test/factories';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), unstable_cache: <T,>(fn: T) => fn }));

setupTestDb();

const cookieOf = async (o: Parameters<typeof makeAdmin>[0] = {}) => cookieFor(await makeAdmin(o));

/** Calls the upload handler and parses its envelope, like `call` does for JSON routes. */
async function upload(request: NextRequest) {
  const response = await uploadRoute(request, noParams());
  const body = (await response.json()) as { ok: boolean; data?: { media: { id: string; [k: string]: unknown }; duplicate: boolean }; error?: { code: string; message: string; fields?: Record<string, string> } };
  return { status: response.status, body };
}

describe('POST /api/admin/media', () => {
  it('answers 401 to a signed-out caller and stores nothing', async () => {
    const res = await upload(uploadRequest({ bytes: uniquePng() }));
    expect(res.status).toBe(401);
    expect(await countStoredFiles()).toBe(0);
  });

  it('uploads a website image as 201, then answers 200 with the same record for the same bytes', async () => {
    const cookie = await cookieOf();
    const bytes = uniquePng();
    const first = await upload(uploadRequest({ bytes, name: 'Cover Photo.png', fields: { for: 'content', alt: 'A cover' }, cookie }));
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ duplicate: false, media: { filename: 'cover-photo.png', mime: 'image/png', visibility: 'public', alt: 'A cover' } });
    const again = await upload(uploadRequest({ bytes, name: 'other-name.png', cookie }));
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ duplicate: true });
    expect(again.body.data?.media.id).toBe(first.body.data?.media.id);
    expect(await Media.countDocuments()).toBe(1);
    expect(await countStoredFiles()).toBe(1);
  });

  it('decides the type from the bytes: a client that LIES about the type (Content-Type, name) gets nothing through', async () => {
    const cookie = await cookieOf();
    const exe = Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00', 'latin1');
    const lie = await upload(uploadRequest({ bytes: exe, name: 'logo.png', type: 'image/png', cookie }));
    expect(lie.status).toBe(422);
    expect(lie.body.error?.fields?.file).toMatch(/not a supported image/);
    const html = await upload(uploadRequest({ bytes: Buffer.from('<script>alert(1)</script>'), name: 'x.png', type: 'image/png', cookie }));
    expect(html.status).toBe(422);
    const svg = await upload(uploadRequest({ bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), name: 'x.svg', type: 'image/svg+xml', cookie }));
    expect(svg.status).toBe(422);
    // ...and an image honestly called .exe is stored as the image it is
    const honest = await upload(uploadRequest({ bytes: uniquePng(), name: 'x.exe', type: 'application/x-msdownload', cookie }));
    expect(honest.status).toBe(201);
    expect(honest.body.data?.media).toMatchObject({ filename: 'x.png', mime: 'image/png' });
    expect(await Media.countDocuments()).toBe(1);
  });

  it('requires the purpose, and refuses an unknown one', async () => {
    const cookie = await cookieOf();
    const none = await upload(uploadRequest({ bytes: uniquePng(), fields: { for: '' }, cookie }));
    expect(none.status).toBe(422);
    expect(none.body.error?.fields).toHaveProperty('for');
    const bogus = await upload(uploadRequest({ bytes: uniquePng(), fields: { for: 'gallery' }, cookie }));
    expect(bogus.status).toBe(422);
    const mismatch = await upload(uploadRequest({ bytes: uniquePng(), fields: { for: 'content', visibility: 'private' }, cookie }));
    expect(mismatch.status).toBe(422);
    expect(await Media.countDocuments()).toBe(0);
  });

  it('refuses a request with no file part, and one that is not multipart', async () => {
    const cookie = await cookieOf();
    const form = new FormData();
    form.set('for', 'content');
    const noFile = new NextRequest('http://localhost:3050/api/admin/media', { method: 'POST', headers: { cookie, 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '198.51.100.7' }, body: form });
    expect((await upload(noFile)).status).toBe(400);
    const json = await call(uploadRoute, '/api/admin/media', { method: 'POST', body: { for: 'content' }, cookie });
    expect(json.status).toBe(400);
  });

  it('enforces the size limits: a public image over 5 MB is a 422, a request over the hard cap is a 413 before it is read', async () => {
    const cookie = await cookieOf();
    const big = await upload(uploadRequest({ bytes: padTo(pngBytes(9, 9), 5 * 1024 * 1024 + 1), cookie }));
    expect(big.status).toBe(422);
    expect(big.body.error?.fields?.file).toMatch(/5 MB/);

    // Far over the cap: refused by size, not by looking at what it is.
    const huge = await upload(uploadRequest({ bytes: padTo(pngBytes(9, 9), MAX_PRIVATE_BYTES + 1024 * 1024), cookie }));
    expect(huge.status).toBe(413);
    expect(huge.body.error?.code).toBe('PAYLOAD_TOO_LARGE');
    expect(await countStoredFiles()).toBe(0);
  });

  it('refuses early on a declared Content-Length over the cap, without reading the body', async () => {
    const cookie = await cookieOf();
    const request = uploadRequest({ bytes: uniquePng(), cookie, headers: { 'content-length': String(MAX_PRIVATE_BYTES * 2) } });
    expect((await upload(request)).status).toBe(413);
  });

  it('refuses a cross-site upload', async () => {
    const cookie = await cookieOf();
    expect((await upload(uploadRequest({ bytes: uniquePng(), cookie, headers: { 'sec-fetch-site': 'cross-site' } }))).status).toBe(403);
    expect(await Media.countDocuments()).toBe(0);
  });

  it('applies the money capability for receipts and attachments', async () => {
    const plain = await cookieOf();
    const recorder = await cookieOf({ grants: ['payment:record'] });
    const sa = await cookieFor(await makeSuperadmin());
    const forPayment = (cookie: string) => upload(uploadRequest({ bytes: pdfBytes(), name: 'p.pdf', fields: { for: 'payment' }, cookie }));
    expect((await forPayment(plain)).status).toBe(403);
    expect(await Media.countDocuments()).toBe(0);
    const ok = await forPayment(recorder);
    expect(ok.status).toBe(201);
    expect(ok.body.data?.media).toMatchObject({ visibility: 'private', purpose: 'payment', mime: 'application/pdf' });
    // an admin may upload their own expense receipt (expense:submit is a role default)
    expect((await upload(uploadRequest({ bytes: uniquePng(), fields: { for: 'expense' }, cookie: plain }))).status).toBe(201);
    expect((await upload(uploadRequest({ bytes: avifBytes(12, 12), fields: { for: 'expense' }, cookie: sa }))).status).toBe(422); // AVIF is not a receipt type
    expect((await upload(uploadRequest({ bytes: webpBytes(12, 12), fields: { for: 'content' }, cookie: plain }))).status).toBe(201);
  });

  it('rate-limits uploads: the 41st in ten minutes is a 429', async () => {
    const cookie = await cookieOf();
    const statuses: number[] = [];
    for (let i = 0; i < 41; i++) statuses.push((await upload(uploadRequest({ bytes: pngBytes(8 + i, 8), cookie }))).status);
    expect(statuses.slice(0, 40).every((s) => s === 201)).toBe(true);
    expect(statuses[40]).toBe(429);
  });
});

describe('GET /api/admin/media', () => {
  it('lists the website library (public files only) for someone who can edit content', async () => {
    const cookie = await cookieOf();
    await makeMedia({ filename: 'public-one.png' });
    await makeMedia({ filename: 'secret.pdf', mime: 'application/pdf', bytes: pdfBytes(), visibility: 'private', purpose: 'payment' });
    const res = await call(listRoute, '/api/admin/media?q=one', { cookie });
    expect(res.status).toBe(200);
    expect(res.body.data.items.map((m: { filename: string }) => m.filename)).toEqual(['public-one.png']);
    expect(JSON.stringify(res.body)).not.toMatch(/secret|sha256|fileId/);
    expect((await call(listRoute, '/api/admin/media')).status).toBe(401);
  });
});

describe('DELETE /api/admin/media/[id]', () => {
  it('deletes an unreferenced file and refuses a referenced one with HAS_LINKED_RECORDS', async () => {
    const cookie = await cookieOf();
    const free = await makeMedia();
    const used = await makeMedia();
    await makePartner({ logoMediaId: used._id });

    const refused = await call(deleteRoute, `/api/admin/media/${used._id}`, { method: 'DELETE', cookie }, { id: String(used._id) });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('HAS_LINKED_RECORDS');
    expect(await Media.countDocuments({ _id: used._id })).toBe(1);

    const done = await call(deleteRoute, `/api/admin/media/${free._id}`, { method: 'DELETE', cookie }, { id: String(free._id) });
    expect(done.status).toBe(200);
    expect(await Media.countDocuments({ _id: free._id })).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'media.delete' })).toBe(1);
  });

  it('answers 401 signed out, 404 for a bad id, and 404 (not 403) for a private file the caller cannot see', async () => {
    const free = await makeMedia();
    expect((await call(deleteRoute, `/api/admin/media/${free._id}`, { method: 'DELETE' }, { id: String(free._id) })).status).toBe(401);
    const cookie = await cookieOf();
    expect((await call(deleteRoute, '/api/admin/media/nope', { method: 'DELETE', cookie }, { id: 'nope' })).status).toBe(404);
    const receipt = await makeMedia({ visibility: 'private', purpose: 'payment', mime: 'application/pdf', bytes: pdfBytes() });
    expect((await call(deleteRoute, `/api/admin/media/${receipt._id}`, { method: 'DELETE', cookie }, { id: String(receipt._id) })).status).toBe(404);
    expect(await Media.countDocuments()).toBe(2);
  });
});
