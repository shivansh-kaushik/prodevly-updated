import { adminRoute } from '@/lib/api/admin-route';
import { forbidden, validationFailed } from '@/lib/api/errors';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { created, ok } from '@/lib/api/response';
import { MEDIA_PURPOSES, UPLOAD_CAPABILITIES, UPLOAD_RATE_LIMIT } from '@/lib/media/rules';
import { readUpload } from '@/lib/media/upload-request';
import { fieldErrors } from '@/lib/validation/common';
import { mediaListSchema, uploadFieldsSchema } from '@/lib/validation/media';
import { listPublicMedia, uploadMedia } from '@/services/media.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/media?q=&page= : the website image library (public files only). */
export const GET = adminRoute({ capability: 'content:edit' }, async ({ admin, request }) => {
  const sp = request.nextUrl.searchParams;
  const query = mediaListSchema.parse({ q: sp.get('q') ?? undefined, page: sp.get('page') ?? 1 });
  return ok(await listPublicMedia(admin, query));
});

/**
 * POST /api/admin/media : a multipart upload with a `file` part and a `for` field (content, payment,
 * payout or expense). No fixed capability here, because it depends on `for`: the service checks it.
 * Someone who could not upload for ANY purpose is turned away before the body is read at all.
 */
export const POST = adminRoute({}, async ({ admin, request, meta }) => {
  const mayUploadSomething = MEDIA_PURPOSES.some((p) => UPLOAD_CAPABILITIES[p].some((c) => admin.capabilities.has(c)));
  if (!mayUploadSomething) throw forbidden('Your access does not allow uploads');
  await enforceRateLimit('admin:upload', admin.id, UPLOAD_RATE_LIMIT);

  const { file, fields } = await readUpload(request);
  const parsed = uploadFieldsSchema.safeParse({ for: fields.for, alt: fields.alt, visibility: fields.visibility });
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));

  const result = await uploadMedia(
    admin,
    { data: file.data, originalName: file.name, purpose: parsed.data.for, alt: parsed.data.alt, visibility: parsed.data.visibility },
    meta,
  );
  // An identical file already stored is not an error: the caller simply gets that record back.
  return result.duplicate ? ok({ media: result.media, duplicate: true }) : created({ media: result.media, duplicate: false });
});
