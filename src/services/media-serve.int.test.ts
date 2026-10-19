import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/media/[id]/[filename]/route';
import { gridfsStorage } from '@/lib/db/gridfs';
import { Admin, Media } from '@/models';
import { uploadMedia } from '@/services/media.service';
import { makeMedia, noParams, pdfBytes, pngBytes, uniquePng } from '@/test/content-factories';
import { setupTestDb } from '@/test/db';
import { cookieFor, makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), unstable_cache: <T,>(fn: T) => fn }));

setupTestDb();

const get = async (id: string, filename = 'x.png', headers: Record<string, string> = {}) => {
  const request = new NextRequest(`http://localhost:3050/media/${id}/${filename}`, { headers });
  const response = await GET(request, noParams({ id, filename }));
  return response;
};

describe('serving PUBLIC files', () => {
  it('sends the bytes with the detected type, long immutable caching and nosniff, to anyone', async () => {
    const bytes = uniquePng();
    const media = await makeMedia({ bytes, filename: 'cover.png' });
    const res = await get(String(media._id), 'cover.png');
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-length')).toBe(String(bytes.length));
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toBe('inline; filename="cover.png"');
    expect(res.headers.get('content-security-policy')).toMatch(/sandbox/);
    expect(res.headers.get('etag')).toBe(`"${media.sha256}"`);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('vary')).toBeNull();
  });

  it('still serves the id when the filename segment is wrong, and names the canonical URL', async () => {
    const media = await makeMedia({ filename: 'real-name.png' });
    const res = await get(String(media._id), 'old-or-wrong-name.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('link')).toBe(`</media/${media._id}/real-name.png>; rel="canonical"`);
    expect((await get(String(media._id), 'real-name.png')).headers.get('link')).toBe(`</media/${media._id}/real-name.png>; rel="canonical"`);
  });

  it('answers 304 to a matching If-None-Match, with no body', async () => {
    const media = await makeMedia();
    const res = await get(String(media._id), 'x.png', { 'if-none-match': `"${media.sha256}"` });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
    expect(res.headers.get('etag')).toBe(`"${media.sha256}"`);
    expect((await get(String(media._id), 'x.png', { 'if-none-match': '"something-else"' })).status).toBe(200);
  });

  it('serves the type found in the BYTES, whatever the file is called: an HTML-named upload is an image or nothing', async () => {
    const viewer = await sessionFor(await makeAdmin());
    const { media } = await uploadMedia(viewer, { data: pngBytes(21, 21), originalName: 'evil.html', purpose: 'content' });
    const res = await get(media.id, 'evil.html');
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(media.filename).toBe('evil.png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('never labels a stored type it does not know as HTML or script: an unexpected record is an opaque download', async () => {
    const media = await makeMedia({ mime: 'text/html', filename: 'page.html', bytes: Buffer.from('<script>alert(1)</script>') });
    const res = await get(String(media._id), 'page.html');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="page.html"');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBeNull();
  });

  it('is a plain 404 (never cached) for an unknown id, a malformed id, and a record whose bytes are gone', async () => {
    for (const id of [String(new Types.ObjectId()), 'nope', '../../etc/passwd', '{"$ne":""}']) {
      const res = await get(id);
      expect(res.status).toBe(404);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    const orphan = await makeMedia();
    await gridfsStorage.remove(orphan.fileId);
    const res = await get(String(orphan._id));
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('serving PRIVATE files', () => {
  const receipt = (purpose: 'payment' | 'payout' | 'expense', uploader?: { id: Types.ObjectId; name: string }) =>
    makeMedia({ visibility: 'private', purpose, mime: 'application/pdf', bytes: pdfBytes(), filename: 'receipt.pdf', uploader });
  const cookieOf = async (o: Parameters<typeof makeAdmin>[0] = {}) => cookieFor(await makeAdmin(o));

  it('is a 404 for a signed-out visitor, with nothing cacheable', async () => {
    const media = await receipt('payment');
    const res = await get(String(media._id), 'receipt.pdf');
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).not.toMatch(/receipt|%PDF/);
  });

  it('is a 404 for a signed-in admin without the matching capability, and for one holding a DIFFERENT money capability', async () => {
    const media = await receipt('payment');
    expect((await get(String(media._id), 'receipt.pdf', { cookie: await cookieOf() })).status).toBe(404);
    expect((await get(String(media._id), 'receipt.pdf', { cookie: await cookieOf({ grants: ['payout:record'] }) })).status).toBe(404);
    expect((await get(String(media._id), 'receipt.pdf', { cookie: await cookieOf({ grants: ['expense:record'] }) })).status).toBe(404);
  });

  it.each([
    ['payment', 'payment:view'],
    ['payment', 'payment:record'],
    ['payout', 'payout:view'],
    ['expense', 'expense:view'],
  ] as const)('serves a %s file to an admin holding %s, never cached by a shared cache', async (purpose, grant) => {
    const media = await receipt(purpose);
    const bytes = pdfBytes();
    const res = await get(String(media._id), 'receipt.pdf', { cookie: await cookieOf({ grants: [grant] }) });
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(res.headers.get('cache-control')).not.toMatch(/public|immutable|max-age=[1-9]/);
    expect(res.headers.get('vary')).toBe('Cookie');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="receipt.pdf"');
    expect(res.headers.get('etag')).toBeNull();
  });

  it('serves everything to a superadmin, and a private image inline', async () => {
    const sa = await cookieFor(await makeSuperadmin());
    const pdf = await receipt('payout');
    expect((await get(String(pdf._id), 'receipt.pdf', { cookie: sa })).status).toBe(200);
    const png = await makeMedia({ visibility: 'private', purpose: 'expense', filename: 'scan.png' });
    const res = await get(String(png._id), 'scan.png', { cookie: sa });
    expect(res.headers.get('content-disposition')).toBe('inline; filename="scan.png"');
    expect(res.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  });

  it('lets an admin open their OWN expense receipt without a money capability, but not their own payment attachment, nor anyone else\'s', async () => {
    const me = await makeAdmin();
    const mine = { id: me._id, name: me.name };
    const cookie = await cookieFor(me);
    const own = await receipt('expense', mine);
    expect((await get(String(own._id), 'receipt.pdf', { cookie })).status).toBe(200);
    expect((await get(String(own._id), 'receipt.pdf', { cookie: await cookieOf() })).status).toBe(404);
    const ownPayment = await receipt('payment', mine);
    expect((await get(String(ownPayment._id), 'receipt.pdf', { cookie })).status).toBe(404);
  });

  it('answers 404, not 401 or 403, so the existence of a receipt is not revealed', async () => {
    const media = await receipt('payment');
    const missing = await get(String(new Types.ObjectId()), 'receipt.pdf');
    const denied = await get(String(media._id), 'receipt.pdf');
    expect(denied.status).toBe(missing.status);
    expect(await denied.text()).toBe(await missing.text());
  });

  it('turns away an expired, revoked, deactivated or forged session, and one that still has to change its password', async () => {
    const media = await receipt('payment');
    const id = String(media._id);

    const revoked = await makeSuperadmin();
    const staleCookie = await cookieFor(revoked);
    await Admin.updateOne({ _id: revoked._id }, { $inc: { tokenVersion: 1 } });
    expect((await get(id, 'receipt.pdf', { cookie: staleCookie })).status).toBe(404);

    const gone = await makeSuperadmin();
    const goneCookie = await cookieFor(gone);
    await Admin.updateOne({ _id: gone._id }, { $set: { status: 'deactivated' } });
    expect((await get(id, 'receipt.pdf', { cookie: goneCookie })).status).toBe(404);

    expect((await get(id, 'receipt.pdf', { cookie: 'pdv_session=not.a.token' })).status).toBe(404);
    expect((await get(id, 'receipt.pdf', { cookie: await cookieFor(await makeSuperadmin({ mustChangePassword: true })) })).status).toBe(404);
  });

  it('never leaks a private file through the public library or the wrong id', async () => {
    const media = await receipt('payment');
    // the public site finds files by id; knowing a private id without access gets nothing
    expect((await get(String(media._id), 'whatever.png')).status).toBe(404);
    expect(await Media.countDocuments({ visibility: 'public' })).toBe(0);
  });
});
