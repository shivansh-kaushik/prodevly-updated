import { createHash } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import type { Capability } from '@/config/capabilities';
import { connectToDatabase, mongoose, withTransaction } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { forbidden, hasLinkedRecords, notFound, validationFailed } from '@/lib/api/errors';
import { escapeRegex } from '@/lib/admin/search-params';
import { gridfsStorage } from '@/lib/db/gridfs';
import { detectFileType } from '@/lib/media/detect';
import { readImageSize } from '@/lib/media/dimensions';
import { sanitiseFilename } from '@/lib/media/filename';
import {
  DELETE_CAPABILITIES,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_SIDE,
  MAX_PRIVATE_BYTES,
  UPLOAD_CAPABILITIES,
  VIEW_CAPABILITIES,
  formatBytes,
  isPrivatePurpose,
  uploadProblem,
  visibilityFor,
  type MediaPurpose,
} from '@/lib/media/rules';
import type { MediaDTO, MediaPage } from '@/lib/media/types';
import { mediaPath } from '@/lib/media/url';
import { parseObjectId } from '@/lib/validation/common';
import { Admin, ClientPayment, DeveloperProfile, Expense, Media, Partner, ShowcaseItem, ThirdPartyPayout, type MediaDoc } from '@/models';
import type { SessionUser } from '@/types/session';
import { audit } from './audit.service';
import type { ServiceMeta } from './admin.service';
import { auditActorOf, oid } from './content/helpers';

/**
 * Uploaded files: website images (public) and receipts or attachments (private).
 *
 * The type is decided from the file's BYTES, never from its name or its Content-Type header.
 * Public images are PNG, JPEG, WebP or AVIF up to 5 MB; private files are PDF, PNG or JPEG up to
 * 10 MB. SVG is NOT accepted in this release: it is XML that can carry script, and accepting it
 * safely needs a vetted sanitiser we do not have. Stored names are sanitised and the extension is
 * rewritten from the detected type.
 *
 * Who may do what:
 * - upload public: `content:edit`. Upload private: the matching money capability for the purpose
 *   (`for` = payment, payout or expense).
 * - read private: the matching view capability, plus the uploader for their own expense receipt.
 * - delete: only when NOTHING references the file.
 */

export type { MediaDTO, MediaPage };

export function toMediaDTO(m: MediaDoc): MediaDTO {
  return {
    id: String(m._id),
    filename: m.filename,
    url: mediaPath(String(m._id), m.filename),
    mime: m.mime,
    size: m.size,
    width: m.width ?? null,
    height: m.height ?? null,
    alt: m.alt ?? null,
    visibility: m.visibility,
    purpose: m.purpose ?? (m.visibility === 'public' ? 'content' : null),
    uploadedBy: m.uploadedBy.name,
    createdAt: m.createdAt.toISOString(),
  };
}

const holdsAny = (viewer: SessionUser, caps: readonly Capability[]) => caps.some((c) => viewer.capabilities.has(c));

function assertAny(viewer: SessionUser, caps: readonly Capability[]): void {
  if (!holdsAny(viewer, caps)) throw forbidden('Your access does not allow this action');
}

/* ------------------------------------------------------------------ upload */

export interface UploadInput {
  data: Buffer;
  /** The name the browser sent. It only seeds the stored name; its extension is ignored. */
  originalName: string;
  purpose: MediaPurpose;
  alt?: string;
  /** Optional. When given it must agree with the purpose. */
  visibility?: 'public' | 'private';
}

export interface UploadResult {
  media: MediaDTO;
  /** True when an identical file was already stored and that record is returned instead. */
  duplicate: boolean;
}

export async function uploadMedia(viewer: SessionUser, input: UploadInput, meta: ServiceMeta = {}): Promise<UploadResult> {
  assertAny(viewer, UPLOAD_CAPABILITIES[input.purpose]);
  const visibility = visibilityFor(input.purpose);
  if (input.visibility && input.visibility !== visibility) {
    throw validationFailed({ visibility: visibility === 'public' ? 'Website images are public' : 'Receipts and attachments are private' });
  }

  const { data } = input;
  if (data.length === 0) throw validationFailed({ file: 'That file is empty.' });
  // Cheap size check first, so an oversize file is refused before it is inspected or hashed.
  if (data.length > MAX_PRIVATE_BYTES) throw validationFailed({ file: `That file is ${formatBytes(data.length)}. The limit is ${formatBytes(MAX_PRIVATE_BYTES)}.` });

  const detected = detectFileType(data);
  if (!detected) {
    throw validationFailed({
      file: visibility === 'public' ? 'That file is not a supported image. Upload a PNG, JPEG, WebP or AVIF file.' : 'That file is not supported. Upload a PDF, PNG or JPEG file.',
    });
  }
  const problem = uploadProblem(visibility, detected.mime, data.length);
  if (problem) throw validationFailed({ file: problem });

  let width: number | undefined;
  let height: number | undefined;
  if (detected.kind === 'image') {
    const size = readImageSize(data, detected.mime);
    if (!size || size.width < 1 || size.height < 1) throw validationFailed({ file: 'That image could not be read. It may be damaged.' });
    if (size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE || size.width * size.height > MAX_IMAGE_PIXELS) {
      throw validationFailed({
        file: `That image is too large (${size.width} x ${size.height}). The limit is ${MAX_IMAGE_SIDE.toLocaleString('en-US')} pixels on a side and ${MAX_IMAGE_PIXELS / 1_000_000} megapixels in all.`,
      });
    }
    width = size.width;
    height = size.height;
  }

  await connectToDatabase();
  const sha256 = createHash('sha256').update(data).digest('hex');

  // The same bytes again: hand back the record we already have. Private files are matched only within the
  // same purpose and uploader, so a receipt is never shared with, or exposed to, anyone else's record.
  const sameFile: Record<string, unknown> = { sha256, visibility };
  if (visibility === 'private') Object.assign(sameFile, { purpose: input.purpose, 'uploadedBy.id': oid(viewer.id) });
  const existing = await Media.findOne(sameFile).lean();
  if (existing && (await gridfsStorage.has(existing.fileId))) return { media: toMediaDTO(existing), duplicate: true };

  const filename = sanitiseFilename(input.originalName, detected.ext);
  // Bytes first (GridFS cannot join a transaction), record second; if the record fails, the bytes go again.
  const fileId = await gridfsStorage.put(data, { filename, contentType: detected.mime });
  try {
    const media = await withTransaction(async (session) => {
      const [doc] = await Media.create(
        [
          {
            storage: 'gridfs',
            fileId,
            filename,
            mime: detected.mime,
            size: data.length,
            width,
            height,
            sha256,
            visibility,
            ...(isPrivatePurpose(input.purpose) ? { purpose: input.purpose } : {}),
            ...(input.alt ? { alt: input.alt } : {}),
            uploadedBy: { id: oid(viewer.id), name: viewer.name },
          },
        ],
        { session },
      );
      if (!doc) throw new Error('The file record was not created');
      await audit(
        {
          actor: auditActorOf(viewer),
          action: 'media.create',
          entity: { type: 'media', id: String(doc._id), label: filename },
          summary: `Uploaded a ${visibility} ${detected.mime} (${formatBytes(data.length)})${isPrivatePurpose(input.purpose) ? ` for ${input.purpose}s` : ''}`,
          meta,
        },
        session,
      );
      return doc.toObject();
    });
    return { media: toMediaDTO(media), duplicate: false };
  } catch (error) {
    await gridfsStorage.remove(fileId).catch((e) => console.error('[media] could not remove an orphaned upload', { fileId: String(fileId), e }));
    throw error;
  }
}

/* -------------------------------------------------------------------- read */

/** The website image library, newest first. Private files are never listed here. */
export async function listPublicMedia(viewer: SessionUser, options: { q?: string; page?: number; pageSize?: number } = {}): Promise<MediaPage> {
  assertCapability(viewer, 'content:edit');
  await connectToDatabase();
  const pageSize = Math.min(Math.max(options.pageSize ?? 24, 1), 60);
  const filter: Record<string, unknown> = { visibility: 'public' };
  const q = options.q?.trim().slice(0, 80);
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ filename: re }, { alt: re }];
  }
  const total = await Media.countDocuments(filter);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(options.page ?? 1, 1), pages);
  const rows = await Media.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .lean();
  return { items: rows.map(toMediaDTO), total, page, pages };
}

/** Whether this viewer may read the file's bytes. Public files: anyone. Private: see the header comment. */
export function canViewMedia(viewer: SessionUser | null, media: Pick<MediaDoc, 'visibility' | 'purpose' | 'uploadedBy'>): boolean {
  if (media.visibility === 'public') return true;
  if (!viewer) return false;
  const own = media.uploadedBy.id !== null && String(media.uploadedBy.id) === viewer.id;
  if (media.purpose) {
    if (holdsAny(viewer, VIEW_CAPABILITIES[media.purpose])) return true;
    return media.purpose === 'expense' && own;
  }
  // A private file with no purpose should not exist; if one does, only its uploader or someone who may see money does.
  return own || holdsAny(viewer, ['payment:view', 'payout:view', 'expense:view']);
}

export async function findMedia(id: string): Promise<MediaDoc | null> {
  if (!/^[a-f\d]{24}$/i.test(id)) return null;
  await connectToDatabase();
  return Media.findById(id.toLowerCase()).lean();
}

/** Records for other modules' pages (a payment's attachments): only those this viewer may open. */
export async function describeMedia(viewer: SessionUser, ids: readonly string[]): Promise<MediaDTO[]> {
  const valid = [...new Set(ids.filter((i) => /^[a-f\d]{24}$/i.test(i)).map((i) => i.toLowerCase()))];
  if (valid.length === 0) return [];
  await connectToDatabase();
  const rows = await Media.find({ _id: mongoose.trusted({ $in: valid.map(oid) }) }).lean();
  return rows.filter((m) => canViewMedia(viewer, m)).map(toMediaDTO);
}

/* ------------------------------------------------------------------ delete */

const REFERENCE_LABELS = {
  showcase: ['showcase project', 'showcase projects'],
  partners: ['partner', 'partners'],
  developers: ['developer profile', 'developer profiles'],
  expenses: ['expense', 'expenses'],
  payments: ['client payment', 'client payments'],
  payouts: ['third-party payout', 'third-party payouts'],
  admins: ['account photo', 'account photos'],
} as const;

export type MediaReferences = Record<keyof typeof REFERENCE_LABELS, number>;

/** How many records use this file, by kind. Every place a media id can be stored is listed here. */
export async function countMediaReferences(id: string, session?: ClientSession): Promise<MediaReferences> {
  const mid = oid(id);
  const s = session ?? null;
  const [showcase, partners, developers, expenses, payments, payouts, admins] = await Promise.all([
    ShowcaseItem.countDocuments({ $or: [{ coverMediaId: mid }, { galleryMediaIds: mid }] }).session(s),
    Partner.countDocuments({ logoMediaId: mid }).session(s),
    DeveloperProfile.countDocuments({ photoMediaId: mid }).session(s),
    Expense.countDocuments({ receiptMediaIds: mid }).session(s),
    ClientPayment.countDocuments({ attachmentMediaIds: mid }).session(s),
    ThirdPartyPayout.countDocuments({ attachmentMediaIds: mid }).session(s),
    Admin.countDocuments({ 'profile.avatarMediaId': mid }).session(s),
  ]);
  return { showcase, partners, developers, expenses, payments, payouts, admins };
}

function describeReferences(refs: MediaReferences): string {
  return (Object.keys(REFERENCE_LABELS) as Array<keyof MediaReferences>)
    .filter((k) => refs[k] > 0)
    .map((k) => `${refs[k]} ${REFERENCE_LABELS[k][refs[k] === 1 ? 0 : 1]}`)
    .join(', ');
}

function mayDelete(viewer: SessionUser, media: MediaDoc): boolean {
  if (media.visibility === 'public') return viewer.capabilities.has('content:edit');
  const own = media.uploadedBy.id !== null && String(media.uploadedBy.id) === viewer.id;
  if (!media.purpose) return own;
  // The uploader may remove their own mistaken upload; otherwise the record-level money capability decides.
  return holdsAny(viewer, DELETE_CAPABILITIES[media.purpose]) || (own && holdsAny(viewer, UPLOAD_CAPABILITIES[media.purpose]));
}

/** Permanently deletes a file, and only when no record references it. */
export async function deleteMedia(viewer: SessionUser, id: string, meta: ServiceMeta = {}): Promise<{ deleted: true }> {
  const mediaId = parseObjectId(id);

  const fileId = await withTransaction(async (session) => {
    const media = await Media.findById(mediaId).session(session).lean();
    // A file the viewer could not even open is "not found" to them (no probing for receipts by id);
    // one they can open but not remove is a plain refusal.
    if (!media || !canViewMedia(viewer, media)) throw notFound('We could not find that file');
    if (!mayDelete(viewer, media)) throw forbidden('Your access does not allow this action');

    const refs = await countMediaReferences(mediaId, session);
    const used = describeReferences(refs);
    if (used) throw hasLinkedRecords(`That file is used by ${used}, so it cannot be deleted. Remove it from there first.`);

    await Media.deleteOne({ _id: media._id }, { session });
    await audit(
      { actor: auditActorOf(viewer), action: 'media.delete', entity: { type: 'media', id: String(media._id), label: media.filename }, meta },
      session,
    );
    return media.fileId;
  });

  // The record is gone for good; now the bytes. A failure leaves an orphan file, never a dangling record.
  await gridfsStorage.remove(fileId).catch((e) => console.error('[media] could not remove file bytes', { fileId: String(fileId), e }));
  return { deleted: true };
}
