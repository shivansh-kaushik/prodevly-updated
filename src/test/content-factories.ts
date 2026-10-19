import { createHash, randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { Types } from 'mongoose';
import { NextRequest } from 'next/server';
import { gridfsStorage } from '@/lib/db/gridfs';
import {
  DeveloperProfile,
  Media,
  Partner,
  PricingPlan,
  Service,
  ShowcaseItem,
  SiteInfo,
  type DeveloperProfileDoc,
  type MediaDoc,
  type PartnerDoc,
  type PricingPlanDoc,
  type ServiceDoc,
  type ShowcaseItemDoc,
} from '@/models';

/**
 * Fixtures for the website content and media module. The byte builders produce files that are
 * header-valid for the detector and the size reader without being decodable images: all the
 * module ever looks at is the header. DB fixtures write straight to the models, bypassing the
 * services, so a test can set up exactly the state it needs.
 */

/* ------------------------------------------------------------------- bytes */

const u32 = (n: number) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const u16 = (n: number) => Buffer.from([(n >>> 8) & 255, n & 255]);
const le16 = (n: number) => Buffer.from([n & 255, (n >>> 8) & 255]);
const le24 = (n: number) => Buffer.from([n & 255, (n >>> 8) & 255, (n >>> 16) & 255]);
const le32 = (n: number) => Buffer.from([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const byte of buf) c = (CRC_TABLE[(c ^ byte) & 255] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Pads with zero bytes to at least `size` (to test size limits). Trailing bytes keep the header valid. */
export function padTo(buf: Buffer, size: number): Buffer {
  return buf.length >= size ? buf : Buffer.concat([buf, Buffer.alloc(size - buf.length)]);
}

export function pngBytes(width = 8, height = 8): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
  };
  const ihdr = Buffer.concat([u32(width), u32(height), Buffer.from([8, 2, 0, 0, 0])]);
  // Real pixel data only for small images: a 20,000 pixel header must not allocate 1.2 GB.
  const raw = width * height <= 4096 ? Buffer.alloc(height * (1 + width * 3)) : Buffer.alloc(1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function jpegBytes(width = 8, height = 8): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]), // JFIF
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]), u16(height), u16(width), Buffer.from([0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]), // SOF0
    Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00]), // SOS
    Buffer.from([0xff, 0xd9]), // EOI
  ]);
}

export function webpBytes(width = 8, height = 8, kind: 'lossy' | 'lossless' | 'extended' = 'lossy'): Buffer {
  let chunk: Buffer;
  if (kind === 'lossy') {
    const data = Buffer.concat([Buffer.from([0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a]), le16(width), le16(height), Buffer.alloc(4)]);
    chunk = Buffer.concat([Buffer.from('VP8 ', 'ascii'), le32(data.length), data]);
  } else if (kind === 'lossless') {
    const data = Buffer.concat([Buffer.from([0x2f]), le32((width - 1) | ((height - 1) << 14)), Buffer.alloc(4)]);
    chunk = Buffer.concat([Buffer.from('VP8L', 'ascii'), le32(data.length), data]);
  } else {
    const data = Buffer.concat([Buffer.alloc(4), le24(width - 1), le24(height - 1)]);
    chunk = Buffer.concat([Buffer.from('VP8X', 'ascii'), le32(data.length), data]);
  }
  return Buffer.concat([Buffer.from('RIFF', 'ascii'), le32(chunk.length + 4), Buffer.from('WEBP', 'ascii'), chunk]);
}

export function avifBytes(width = 8, height = 8): Buffer {
  const box = (type: string, ...parts: Buffer[]) => {
    const body = Buffer.concat(parts);
    return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'ascii'), body]);
  };
  const ftyp = box('ftyp', Buffer.from('avif', 'ascii'), u32(0), Buffer.from('avifmif1', 'ascii'));
  const ispe = box('ispe', u32(0), u32(width), u32(height));
  return Buffer.concat([ftyp, box('meta', u32(0), box('iprp', box('ipco', ispe)))]);
}

export const pdfBytes = (): Buffer => Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'ascii');

/** A different valid PNG each call, so uploads in one test are not seen as duplicates of each other. */
let pngCounter = 0;
export const uniquePng = (): Buffer => pngBytes(8 + (pngCounter++ % 4000), 8);

/* ------------------------------------------------------------------ uploads */

/** A multipart upload request, as the browser's FormData would send it. */
export function uploadRequest(o: { bytes: Buffer; name?: string; type?: string; fields?: Record<string, string>; cookie?: string; ip?: string; headers?: Record<string, string> }): NextRequest {
  const form = new FormData();
  for (const [k, v] of Object.entries({ for: 'content', ...o.fields })) form.set(k, v);
  form.set('file', new File([new Uint8Array(o.bytes)], o.name ?? 'upload.png', { type: o.type ?? 'application/octet-stream' }));
  return new NextRequest('http://localhost:3050/api/admin/media', {
    method: 'POST',
    headers: {
      'sec-fetch-site': 'same-origin',
      'x-forwarded-for': o.ip ?? `198.51.100.${1 + Math.floor(Math.random() * 250)}`,
      ...(o.cookie ? { cookie: o.cookie } : {}),
      ...o.headers,
    },
    body: form,
  });
}

export const noParams = <P extends Record<string, string> = Record<string, string>>(params = {} as P) => ({ params: Promise.resolve(params) });

/* --------------------------------------------------------------------- media */

const SYSTEM = { id: null, name: 'Test' };

/** A stored file (bytes in GridFS) and its Media record. */
export async function makeMedia(
  o: { bytes?: Buffer; mime?: string; filename?: string; visibility?: 'public' | 'private'; purpose?: 'payment' | 'payout' | 'expense'; alt?: string; uploader?: { id: Types.ObjectId | null; name: string } | null; width?: number; height?: number } = {},
): Promise<MediaDoc> {
  const bytes = o.bytes ?? uniquePng();
  const mime = o.mime ?? 'image/png';
  const filename = o.filename ?? `file-${randomBytes(3).toString('hex')}.${mime === 'application/pdf' ? 'pdf' : 'png'}`;
  const fileId = await gridfsStorage.put(bytes, { filename, contentType: mime });
  const doc = await Media.create({
    storage: 'gridfs',
    fileId,
    filename,
    mime,
    size: bytes.length,
    width: mime === 'application/pdf' ? undefined : (o.width ?? 8),
    height: mime === 'application/pdf' ? undefined : (o.height ?? 8),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    visibility: o.visibility ?? 'public',
    ...(o.purpose ? { purpose: o.purpose } : {}),
    ...(o.alt ? { alt: o.alt } : {}),
    uploadedBy: o.uploader === undefined ? SYSTEM : (o.uploader ?? SYSTEM),
  });
  return doc.toObject();
}

/* ------------------------------------------------------------------- content */

type Live<T> = Partial<T> & { published?: boolean };
let n = 0;
const next = () => ++n;

function liveFields(o: { published?: boolean; status?: string }) {
  if (!(o.published || o.status === 'published')) return {};
  return { status: 'published' as const, publishedAt: new Date(), publishedBy: SYSTEM };
}

export async function makeShowcase(o: Live<ShowcaseItemDoc> = {}): Promise<ShowcaseItemDoc> {
  const i = next();
  const { published, ...rest } = o;
  const doc = await ShowcaseItem.create({
    title: `Project ${i}`,
    slug: `project-${i}`,
    summary: `Summary of project ${i}`,
    clientApproved: true,
    order: i,
    createdBy: SYSTEM,
    ...rest,
    ...liveFields({ published, status: rest.status }),
  });
  return doc.toObject();
}

export async function makePartner(o: Live<PartnerDoc> = {}): Promise<PartnerDoc> {
  const i = next();
  const { published, ...rest } = o;
  const doc = await Partner.create({ name: `Partner ${i}`, kind: 'technology', permissionConfirmed: true, order: i, createdBy: SYSTEM, ...rest, ...liveFields({ published, status: rest.status }) });
  return doc.toObject();
}

export async function makeService(o: Live<ServiceDoc> = {}): Promise<ServiceDoc> {
  const i = next();
  const { published, ...rest } = o;
  const doc = await Service.create({ title: `Service ${i}`, slug: `service-${i}`, summary: `Summary of service ${i}`, order: i, createdBy: SYSTEM, ...rest, ...liveFields({ published, status: rest.status }) });
  return doc.toObject();
}

export async function makePlan(o: Live<PricingPlanDoc> = {}): Promise<PricingPlanDoc> {
  const i = next();
  const { published, ...rest } = o;
  const doc = await PricingPlan.create({
    name: `Plan ${i}`,
    priceModel: 'fixed_from',
    amountMinor: 2_499_900,
    currency: 'INR',
    order: i,
    createdBy: SYSTEM,
    ...rest,
    ...liveFields({ published, status: rest.status }),
  });
  return doc.toObject();
}

export async function makeDeveloper(o: Live<DeveloperProfileDoc> = {}): Promise<DeveloperProfileDoc> {
  const i = next();
  const { published, ...rest } = o;
  const doc = await DeveloperProfile.create({ displayName: `Developer ${i}`, consentConfirmed: true, order: i, createdBy: SYSTEM, ...rest, ...liveFields({ published, status: rest.status }) });
  return doc.toObject();
}

export async function makeSiteInfo(o: Record<string, unknown> = {}) {
  await SiteInfo.create({ _id: 'site', displayName: 'ProDevly', ...o });
}
