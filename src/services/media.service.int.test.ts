import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import type { Capability } from '@/config/capabilities';
import { countStoredFiles, gridfsStorage, readStoredFile } from '@/lib/db/gridfs';
import { MAX_PRIVATE_BYTES, MAX_PUBLIC_BYTES } from '@/lib/media/rules';
import { Admin, AuditLog, Media } from '@/models';
import { canViewMedia, deleteMedia, describeMedia, listPublicMedia, uploadMedia, type UploadInput } from '@/services/media.service';
import { setupTestDb } from '@/test/db';
import { avifBytes, jpegBytes, makeMedia, makePartner, makeShowcase, makeDeveloper, padTo, pdfBytes, pngBytes, uniquePng, webpBytes } from '@/test/content-factories';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';

setupTestDb();

const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; fields?: Record<string, string>; message?: string };
  }
  throw new Error('expected the call to be rejected');
};

const plain = async () => sessionFor(await makeAdmin());
const sa = async () => sessionFor(await makeSuperadmin());
const withGrants = async (...grants: Capability[]) => sessionFor(await makeAdmin({ grants }));
const only = async (...caps: Capability[]) => ({ ...(await plain()), capabilities: new Set<Capability>(caps) as ReadonlySet<Capability> });

const publicUpload = (data: Buffer, name = 'photo.png', extra: Partial<UploadInput> = {}): UploadInput => ({ data, originalName: name, purpose: 'content', ...extra });

describe('upload: the type comes from the bytes', () => {
  it.each([
    ['PNG', pngBytes(40, 30), 'image/png', 'png'],
    ['JPEG', jpegBytes(40, 30), 'image/jpeg', 'jpg'],
    ['WebP', webpBytes(40, 30, 'lossless'), 'image/webp', 'webp'],
    ['AVIF', avifBytes(40, 30), 'image/avif', 'avif'],
  ])('accepts a public %s, reads its size and stores the bytes', async (_n, data, mime, ext) => {
    const viewer = await plain();
    const { media, duplicate } = await uploadMedia(viewer, publicUpload(data, 'My Photo.JPG', { alt: 'A photo' }));
    expect(duplicate).toBe(false);
    expect(media).toMatchObject({ mime, filename: `my-photo.${ext}`, size: data.length, width: 40, height: 30, visibility: 'public', purpose: 'content', alt: 'A photo', uploadedBy: viewer.name });
    expect(media.url).toBe(`/media/${media.id}/my-photo.${ext}`);

    const doc = await Media.findById(media.id).lean();
    expect(doc?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(doc?.storage).toBe('gridfs');
    expect((await readStoredFile(doc?.fileId as Types.ObjectId))?.equals(data)).toBe(true);
    expect(JSON.stringify(media)).not.toMatch(/sha256|fileId/);
  });

  it('audits the upload', async () => {
    const viewer = await plain();
    const { media } = await uploadMedia(viewer, publicUpload(uniquePng()));
    const entry = await AuditLog.findOne({ action: 'media.create' }).lean();
    expect(entry).toMatchObject({ entity: { type: 'media', label: media.filename }, actor: { name: viewer.name } });
  });

  it.each([
    ['a renamed Windows executable', 'photo.png', Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00PE\x00\x00', 'latin1')],
    ['an HTML page called .png', 'logo.png', Buffer.from('<!doctype html><script>alert(document.cookie)</script>')],
    ['an SVG (not accepted in this release)', 'logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ['a GIF', 'anim.gif', Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1')],
    ['plain text', 'notes.jpg', Buffer.from('just some notes')],
  ])('rejects %s and stores nothing', async (_n, name, data) => {
    const err = await rejects(uploadMedia(await plain(), publicUpload(data, name)));
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields?.file).toMatch(/not a supported image/);
    expect(await Media.countDocuments()).toBe(0);
    expect(await countStoredFiles()).toBe(0);
    expect(await AuditLog.countDocuments()).toBe(0);
  });

  it('stores an image called .exe or .html as the image it really is, with the extension of its type', async () => {
    const { media } = await uploadMedia(await plain(), publicUpload(uniquePng(), 'totally-safe.exe'));
    expect(media.filename).toBe('totally-safe.png');
    const { media: m2 } = await uploadMedia(await plain(), publicUpload(uniquePng(), '../../etc/passwd.html'));
    expect(m2.filename).toBe('passwd.png');
  });

  it('rejects an empty file and a header that cannot be read', async () => {
    expect((await rejects(uploadMedia(await plain(), publicUpload(Buffer.alloc(0))))).fields?.file).toMatch(/empty/);
    expect((await rejects(uploadMedia(await plain(), publicUpload(pngBytes().subarray(0, 20))))).fields?.file).toMatch(/could not be read/);
  });

  it('rejects an absurd image size declared in the header (a decompression bomb for the visitor)', async () => {
    const err = await rejects(uploadMedia(await plain(), publicUpload(pngBytes(60_000, 60_000))));
    expect(err.fields?.file).toMatch(/too large/);
  });
});

describe('upload: limits and what each visibility accepts', () => {
  it('public images: exactly 5 MB is fine, one byte over is not', async () => {
    const viewer = await plain();
    const { media } = await uploadMedia(viewer, publicUpload(padTo(pngBytes(9, 9), MAX_PUBLIC_BYTES)));
    expect(media.size).toBe(MAX_PUBLIC_BYTES);
    const err = await rejects(uploadMedia(viewer, publicUpload(padTo(pngBytes(10, 10), MAX_PUBLIC_BYTES + 1))));
    expect(err.fields?.file).toMatch(/5 MB/);
    expect(await Media.countDocuments()).toBe(1);
  });

  it('private files: exactly 10 MB is fine, one byte over is not', async () => {
    const viewer = await sa();
    const { media } = await uploadMedia(viewer, { data: padTo(pdfBytes(), MAX_PRIVATE_BYTES), originalName: 'bill.pdf', purpose: 'expense' });
    expect(media.size).toBe(MAX_PRIVATE_BYTES);
    expect((await rejects(uploadMedia(viewer, { data: padTo(pdfBytes(), MAX_PRIVATE_BYTES + 1), originalName: 'bill.pdf', purpose: 'expense' }))).fields?.file).toMatch(/10 MB/);
  });

  it('a website image cannot be a PDF; a receipt cannot be WebP or AVIF; a receipt may be PDF, PNG or JPEG', async () => {
    const viewer = await sa();
    expect((await rejects(uploadMedia(viewer, publicUpload(pdfBytes(), 'a.pdf')))).fields?.file).toMatch(/PNG, JPEG, WebP or AVIF/);
    for (const data of [webpBytes(), avifBytes()]) {
      expect((await rejects(uploadMedia(viewer, { data, originalName: 'r.webp', purpose: 'expense' }))).fields?.file).toMatch(/PDF, PNG or JPEG/);
    }
    for (const data of [pdfBytes(), uniquePng(), jpegBytes(11, 11)]) {
      expect((await uploadMedia(viewer, { data, originalName: 'r', purpose: 'expense' })).media.visibility).toBe('private');
    }
  });

  it('stores a PDF without dimensions and marks the purpose', async () => {
    const { media } = await uploadMedia(await sa(), { data: pdfBytes(), originalName: 'Invoice #4.pdf', purpose: 'payment' });
    expect(media).toMatchObject({ mime: 'application/pdf', filename: 'invoice-4.pdf', width: null, height: null, purpose: 'payment', visibility: 'private' });
  });

  it('refuses a visibility that disagrees with the purpose', async () => {
    const viewer = await sa();
    expect((await rejects(uploadMedia(viewer, publicUpload(uniquePng(), 'a.png', { visibility: 'private' })))).fields).toHaveProperty('visibility');
    expect((await rejects(uploadMedia(viewer, { data: pdfBytes(), originalName: 'a.pdf', purpose: 'payment', visibility: 'public' }))).fields).toHaveProperty('visibility');
  });
});

describe('upload: duplicates', () => {
  it('hands back the stored record for the same bytes, storing and auditing nothing the second time', async () => {
    const viewer = await plain();
    const data = uniquePng();
    const first = await uploadMedia(viewer, publicUpload(data, 'first.png'));
    const second = await uploadMedia(await plain(), publicUpload(data, 'second-name.png'));
    expect(second.duplicate).toBe(true);
    expect(second.media.id).toBe(first.media.id);
    expect(second.media.filename).toBe('first.png');
    expect(await Media.countDocuments()).toBe(1);
    expect(await countStoredFiles()).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'media.create' })).toBe(1);
  });

  it('never merges a private file with a public one, or one purpose with another, or one uploader with another', async () => {
    const data = pngBytes(33, 33);
    const owner = await sa();
    const pub = await uploadMedia(owner, publicUpload(data));
    const receipt = await uploadMedia(owner, { data, originalName: 'r.png', purpose: 'expense' });
    const payment = await uploadMedia(owner, { data, originalName: 'r.png', purpose: 'payment' });
    const other = await uploadMedia(await sa(), { data, originalName: 'r.png', purpose: 'expense' });
    const again = await uploadMedia(owner, { data, originalName: 'r.png', purpose: 'expense' });
    expect(new Set([pub.media.id, receipt.media.id, payment.media.id, other.media.id]).size).toBe(4);
    expect(again.duplicate).toBe(true);
    expect(again.media.id).toBe(receipt.media.id);
  });

  it('uploads again when the stored bytes behind an old record are gone', async () => {
    const data = uniquePng();
    const viewer = await plain();
    const first = await uploadMedia(viewer, publicUpload(data));
    await gridfsStorage.remove((await Media.findById(first.media.id).lean())?.fileId as Types.ObjectId);
    const again = await uploadMedia(viewer, publicUpload(data));
    expect(again.duplicate).toBe(false);
    expect(again.media.id).not.toBe(first.media.id);
  });
});

describe('upload: who may upload what', () => {
  it('website images need content:edit', async () => {
    expect((await rejects(uploadMedia(await only('dashboard:view'), publicUpload(uniquePng())))).code).toBe('FORBIDDEN');
    expect((await uploadMedia(await plain(), publicUpload(uniquePng()))).media.visibility).toBe('public');
  });

  it('expense receipts need expense:submit or expense:record', async () => {
    const receipt = (): UploadInput => ({ data: pdfBytes(), originalName: 'r.pdf', purpose: 'expense' });
    expect((await rejects(uploadMedia(await only('content:edit', 'payment:record'), receipt()))).code).toBe('FORBIDDEN');
    expect((await uploadMedia(await only('expense:submit'), receipt())).media.purpose).toBe('expense');
    expect((await uploadMedia(await only('expense:record'), { ...receipt(), data: uniquePng() })).media.purpose).toBe('expense');
  });

  it('payment attachments need payment:record and payout attachments need payout:record', async () => {
    const plainAdmin = await plain();
    expect((await rejects(uploadMedia(plainAdmin, { data: pdfBytes(), originalName: 'p.pdf', purpose: 'payment' }))).code).toBe('FORBIDDEN');
    expect((await rejects(uploadMedia(plainAdmin, { data: pdfBytes(), originalName: 'p.pdf', purpose: 'payout' }))).code).toBe('FORBIDDEN');
    expect((await uploadMedia(await withGrants('payment:record'), { data: pdfBytes(), originalName: 'p.pdf', purpose: 'payment' })).media.purpose).toBe('payment');
    // a payment recorder cannot upload payout files
    expect((await rejects(uploadMedia(await withGrants('payment:record'), { data: uniquePng(), originalName: 'p.png', purpose: 'payout' }))).code).toBe('FORBIDDEN');
    expect((await uploadMedia(await withGrants('payout:record'), { data: uniquePng(), originalName: 'p.png', purpose: 'payout' })).media.purpose).toBe('payout');
  });

  it('refuses before reading anything: nothing is stored, nothing audited', async () => {
    await rejects(uploadMedia(await plain(), { data: pdfBytes(), originalName: 'p.pdf', purpose: 'payment' }));
    expect(await Media.countDocuments()).toBe(0);
    expect(await countStoredFiles()).toBe(0);
    expect(await AuditLog.countDocuments()).toBe(0);
  });

  it('removes the stored bytes again if the record cannot be written', async () => {
    const spy = vi.spyOn(Media, 'create').mockRejectedValueOnce(new Error('database down') as never);
    await rejects(uploadMedia(await plain(), publicUpload(uniquePng())));
    spy.mockRestore();
    expect(await countStoredFiles()).toBe(0);
    expect(await Media.countDocuments()).toBe(0);
  });
});

describe('the website image library', () => {
  it('lists public files only, newest first, and searches literally', async () => {
    const viewer = await plain();
    const older = await makeMedia({ filename: 'older.png' });
    await Media.updateOne({ _id: older._id }, { $set: { createdAt: new Date('2026-01-01') } }, { timestamps: false });
    await makeMedia({ filename: 'newer (final).png', alt: 'Shop front' });
    await makeMedia({ filename: 'receipt.pdf', mime: 'application/pdf', bytes: pdfBytes(), visibility: 'private', purpose: 'expense' });

    const page = await listPublicMedia(viewer);
    expect(page.items.map((m) => m.filename)).toEqual(['newer (final).png', 'older.png']);
    expect(page.total).toBe(2);
    expect((await listPublicMedia(viewer, { q: '(final)' })).items).toHaveLength(1);
    expect((await listPublicMedia(viewer, { q: 'shop' })).items).toHaveLength(1); // searches the description too
    expect((await listPublicMedia(viewer, { q: '.*' })).items).toHaveLength(0);
  });

  it('pages, and needs content:edit', async () => {
    for (let i = 0; i < 5; i++) await makeMedia();
    const viewer = await plain();
    const first = await listPublicMedia(viewer, { pageSize: 2 });
    expect(first).toMatchObject({ page: 1, pages: 3, total: 5 });
    expect((await listPublicMedia(viewer, { pageSize: 2, page: 99 })).page).toBe(3);
    expect((await rejects(listPublicMedia(await only('dashboard:view')))).code).toBe('FORBIDDEN');
  });
});

describe('who may read a file', () => {
  const uploader = new Types.ObjectId();
  const media = (o: { visibility?: 'public' | 'private'; purpose?: 'payment' | 'payout' | 'expense' } = {}) => ({
    visibility: o.visibility ?? 'private',
    purpose: o.purpose,
    uploadedBy: { id: uploader, name: 'Uploader' },
  });
  const viewer = async (...caps: Capability[]) => ({ ...(await plain()), capabilities: new Set<Capability>(caps) as ReadonlySet<Capability> });

  it('shows public files to everyone, signed in or not', async () => {
    expect(canViewMedia(null, media({ visibility: 'public' }))).toBe(true);
    expect(canViewMedia(await viewer(), media({ visibility: 'public' }))).toBe(true);
  });

  it('hides private files from signed-out visitors', () => {
    expect(canViewMedia(null, media({ purpose: 'payment' }))).toBe(false);
  });

  it.each([
    ['payment', 'payment:view'],
    ['payment', 'payment:record'],
    ['payout', 'payout:view'],
    ['payout', 'payout:record'],
    ['expense', 'expense:view'],
    ['expense', 'expense:record'],
  ] as const)('opens a %s file to someone holding %s, and only the matching capability', async (purpose, cap) => {
    expect(canViewMedia(await viewer(cap), media({ purpose }))).toBe(true);
    const others: Capability[] = ['payment:view', 'payout:view', 'expense:view', 'content:edit', 'money:approve', 'money:void'].filter((c) => c !== cap && !c.startsWith(`${purpose}:`)) as Capability[];
    expect(canViewMedia(await viewer(...others), media({ purpose }))).toBe(false);
  });

  it('lets an admin read their OWN expense receipt, and nobody else\'s, without any money capability', async () => {
    const me = await viewer('expense:submit');
    const mine = { ...media({ purpose: 'expense' }), uploadedBy: { id: new Types.ObjectId(me.id), name: me.name } };
    expect(canViewMedia(me, mine)).toBe(true);
    expect(canViewMedia(me, media({ purpose: 'expense' }))).toBe(false);
    // ...but the uploader rule is for expenses only: a payment attachment is not "theirs" to read
    expect(canViewMedia(me, { ...mine, purpose: 'payment' })).toBe(false);
  });

  it('a private file with no purpose is for its uploader or someone who may see money', async () => {
    const me = await viewer();
    expect(canViewMedia(me, { ...media(), uploadedBy: { id: new Types.ObjectId(me.id), name: me.name } })).toBe(true);
    expect(canViewMedia(me, media())).toBe(false);
    expect(canViewMedia(await viewer('payout:view'), media())).toBe(true);
  });

  it('describeMedia returns only the files the viewer may open', async () => {
    const pub = await makeMedia();
    const payment = await makeMedia({ visibility: 'private', purpose: 'payment', mime: 'application/pdf', bytes: pdfBytes() });
    const ids = [String(pub._id), String(payment._id), 'not-an-id'];
    expect((await describeMedia(await plain(), ids)).map((m) => m.id)).toEqual([String(pub._id)]);
    expect((await describeMedia(await sa(), ids)).map((m) => m.id).sort()).toEqual([String(pub._id), String(payment._id)].sort());
  });
});

describe('delete: only when nothing references the file', () => {
  const fileOf = async (id: string) => (await Media.findById(id).lean())?.fileId as Types.ObjectId;

  it('deletes an unreferenced file: the record, the bytes, and an audit entry', async () => {
    const viewer = await plain();
    const media = await makeMedia();
    const fileId = media.fileId;
    expect(await deleteMedia(viewer, String(media._id))).toEqual({ deleted: true });
    expect(await Media.countDocuments()).toBe(0);
    expect(await gridfsStorage.has(fileId)).toBe(false);
    expect(await AuditLog.findOne({ action: 'media.delete' }).lean()).toMatchObject({ entity: { type: 'media', label: media.filename } });
  });

  const referencedBy: Array<[string, (id: Types.ObjectId) => Promise<void>, RegExp]> = [
    ['a showcase cover', async (id) => void (await makeShowcase({ coverMediaId: id })), /1 showcase project/],
    ['a showcase gallery', async (id) => void (await makeShowcase({ galleryMediaIds: [id] })), /1 showcase project/],
    ['a partner logo', async (id) => void (await makePartner({ logoMediaId: id })), /1 partner/],
    ['a developer photo', async (id) => void (await makeDeveloper({ photoMediaId: id })), /1 developer profile/],
    ['an expense receipt', async (id) => void (await Media.db.collection('expenses').insertOne({ receiptMediaIds: [id] })), /1 expense/],
    ['a client payment attachment', async (id) => void (await Media.db.collection('clientpayments').insertOne({ attachmentMediaIds: [id] })), /1 client payment/],
    ['a third-party payout attachment', async (id) => void (await Media.db.collection('thirdpartypayouts').insertOne({ attachmentMediaIds: [id] })), /1 third-party payout/],
    ['an account photo', async (id) => void (await Admin.updateOne({ _id: (await makeAdmin())._id }, { $set: { 'profile.avatarMediaId': id } })), /1 account photo/],
  ];
  it.each(referencedBy)('refuses while %s uses it, deleting nothing', async (_name, reference, message) => {
    const viewer = await sa();
    const media = await makeMedia();
    await reference(media._id);
    const err = await rejects(deleteMedia(viewer, String(media._id)));
    expect(err.code).toBe('HAS_LINKED_RECORDS');
    expect(err.message).toMatch(message);
    expect(await Media.countDocuments()).toBe(1);
    expect(await gridfsStorage.has(media.fileId)).toBe(true);
    expect(await AuditLog.countDocuments({ action: 'media.delete' })).toBe(0);
  });

  it('lists every kind of reference together', async () => {
    const viewer = await sa();
    const media = await makeMedia();
    await makeShowcase({ coverMediaId: media._id });
    await makeShowcase({ galleryMediaIds: [media._id] });
    await makePartner({ logoMediaId: media._id });
    expect((await rejects(deleteMedia(viewer, String(media._id)))).message).toMatch(/2 showcase projects, 1 partner/);
  });

  it('succeeds once the last reference is gone', async () => {
    const viewer = await sa();
    const media = await makeMedia();
    const partner = await makePartner({ logoMediaId: media._id });
    await rejects(deleteMedia(viewer, String(media._id)));
    await Media.db.collection('partners').updateOne({ _id: partner._id }, { $unset: { logoMediaId: 1 } });
    expect(await deleteMedia(viewer, String(media._id))).toEqual({ deleted: true });
  });

  it('public files need content:edit; a viewer without it is refused and nothing is deleted', async () => {
    const media = await makeMedia();
    expect((await rejects(deleteMedia(await only('dashboard:view'), String(media._id)))).code).toBe('FORBIDDEN');
    expect(await Media.countDocuments()).toBe(1);
  });

  it('private files: the record-level money capability, or the uploader for their own; a stranger sees "not found"', async () => {
    const receipt = await makeMedia({ visibility: 'private', purpose: 'payment', mime: 'application/pdf', bytes: pdfBytes() });
    const stranger = await plain();
    expect((await rejects(deleteMedia(stranger, String(receipt._id)))).code).toBe('NOT_FOUND'); // cannot even see it
    expect((await rejects(deleteMedia(await withGrants('payment:view'), String(receipt._id)))).code).toBe('FORBIDDEN'); // sees it, may not remove it
    expect(await Media.countDocuments()).toBe(1);
    expect(await deleteMedia(await withGrants('payment:record'), String(receipt._id))).toEqual({ deleted: true });

    const me = await plain();
    const own = await uploadMedia(me, { data: pdfBytes(), originalName: 'mine.pdf', purpose: 'expense' });
    const other = await uploadMedia(await plain(), { data: uniquePng(), originalName: 'theirs.png', purpose: 'expense' });
    expect((await rejects(deleteMedia(me, other.media.id))).code).toBe('NOT_FOUND');
    expect(await deleteMedia(me, own.media.id)).toEqual({ deleted: true });
  });

  it('answers not found for an unknown or malformed id', async () => {
    const viewer = await sa();
    expect((await rejects(deleteMedia(viewer, String(new Types.ObjectId())))).code).toBe('NOT_FOUND');
    expect((await rejects(deleteMedia(viewer, 'nope'))).code).toBe('NOT_FOUND');
  });

  it('still deletes the record when the bytes are already gone', async () => {
    const viewer = await sa();
    const media = await makeMedia();
    await gridfsStorage.remove(await fileOf(String(media._id)));
    expect(await deleteMedia(viewer, String(media._id))).toEqual({ deleted: true });
    expect(await Media.countDocuments()).toBe(0);
  });
});

describe('storage adapter', () => {
  it('stores, reads, reports and removes a file, and removal is idempotent', async () => {
    const data = Buffer.from('hello bytes');
    const id = await gridfsStorage.put(data, { filename: 'a.bin', contentType: 'application/octet-stream' });
    expect(await gridfsStorage.has(id)).toBe(true);
    expect((await readStoredFile(id))?.equals(data)).toBe(true);
    await gridfsStorage.remove(id);
    expect(await gridfsStorage.has(id)).toBe(false);
    expect(await readStoredFile(id)).toBeNull();
    await expect(gridfsStorage.remove(id)).resolves.toBeUndefined();
  });
});
