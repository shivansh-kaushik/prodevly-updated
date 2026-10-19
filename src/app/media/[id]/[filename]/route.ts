import type { NextRequest } from 'next/server';
import { authenticateRequest, assertPasswordCurrent } from '@/lib/auth/guard';
import { withRoute } from '@/lib/api/handler';
import { gridfsStorage } from '@/lib/db/gridfs';
import { PRIVATE_TYPES, PUBLIC_TYPES } from '@/lib/media/rules';
import { mediaPath } from '@/lib/media/url';
import type { SessionUser } from '@/types/session';
import { canViewMedia, findMedia } from '@/services/media.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /media/<id>/<filename>
 *
 * The id finds the file; the filename segment is only for people, so a wrong or stale name still
 * serves the same bytes and the canonical URL is advertised in a `Link` header.
 *
 * PUBLIC files are cacheable forever (`immutable`: an id never changes its bytes) and served with
 * `nosniff` and the type detected from the file's bytes at upload, never one the client chose.
 *
 * PRIVATE files (receipts, attachments) are served only to a signed-in admin whose capabilities
 * match the file's purpose. Everyone else gets the same plain 404 as for a file that does not
 * exist, so ids cannot be probed. They are never cached by a shared cache, and a PDF is sent as a
 * download rather than rendered in the page's origin.
 */
const NOT_FOUND = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

async function signedInViewer(request: NextRequest): Promise<SessionUser | null> {
  try {
    const { admin } = await authenticateRequest(request);
    assertPasswordCurrent(admin); // an account that must change its password can do nothing else yet
    return admin;
  } catch {
    return null;
  }
}

/**
 * The only types this route will ever label as something other than a download. Uploads can only produce
 * these, so this is a backstop: a record with any other type (a bad import, a hand-edited row) is sent as an
 * opaque download, never as HTML or script.
 */
const SERVABLE: ReadonlySet<string> = new Set([...PUBLIC_TYPES, ...PRIVATE_TYPES]);

/** `attachment; filename="..."` with an ASCII-safe name (stored names already are). */
const disposition = (kind: 'inline' | 'attachment', filename: string) => `${kind}; filename="${filename.replace(/[^\w.-]/g, '_')}"`;

export const GET = withRoute(async (request: NextRequest, context: { params: Promise<{ id: string; filename: string }> }) => {
  const { id } = await context.params;
  const media = await findMedia(id);
  if (!media) return NOT_FOUND();

  const isPublic = media.visibility === 'public';
  if (!isPublic) {
    const viewer = await signedInViewer(request);
    if (!canViewMedia(viewer, media)) return NOT_FOUND();
  }

  const type = SERVABLE.has(media.mime) ? media.mime : 'application/octet-stream';
  const isImage = type.startsWith('image/');
  const headers = new Headers({
    'Content-Type': type,
    'Content-Length': String(media.size),
    'X-Content-Type-Options': 'nosniff',
    // Images show in the page; everything else (a PDF, anything unexpected) downloads.
    'Content-Disposition': disposition(isImage ? 'inline' : 'attachment', media.filename),
    Link: `<${mediaPath(String(media._id), media.filename)}>; rel="canonical"`,
  });
  if (isImage) headers.set('Content-Security-Policy', "default-src 'none'; sandbox");

  if (isPublic) {
    // A strong validator from the content hash, so a revalidation is a cheap 304.
    const etag = `"${media.sha256}"`;
    headers.set('ETag', etag);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    if (request.headers.get('if-none-match')?.split(',').some((t) => t.trim() === etag)) {
      headers.delete('Content-Length');
      headers.delete('Content-Type');
      return new Response(null, { status: 304, headers });
    }
  } else {
    headers.set('Cache-Control', 'private, no-store, max-age=0');
    headers.set('Vary', 'Cookie');
    headers.set('X-Robots-Tag', 'noindex, nofollow');
  }

  const body = await gridfsStorage.open(media.fileId);
  // The record exists but its bytes are gone (an interrupted delete): a clean 404, not a broken image.
  if (!body) return NOT_FOUND();
  return new Response(body, { status: 200, headers });
});
