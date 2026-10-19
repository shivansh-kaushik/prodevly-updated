import { ApiError, hardNavigate } from '@/lib/admin/api-client';
import { MAX_PRIVATE_BYTES, MAX_PUBLIC_BYTES, formatBytes, type MediaPurpose } from '@/lib/media/rules';
import type { MediaDTO } from '@/lib/media/types';
import type { ApiFailure, ApiSuccess } from '@/types/api';

/**
 * Uploads one file to /api/admin/media. The server decides what the file really is (from its
 * bytes) and what is allowed; the checks here only save a round trip for the obvious cases.
 *
 * Other modules use this for receipts and attachments too: `for` is `payment`, `payout` or
 * `expense` (private files, shown only to people holding the matching money capability).
 *
 * This is a plain `fetch` rather than `adminFetch` because the body is multipart, not JSON. It
 * still sends a signed-out person through the cookie-clearing redirect and a pending password
 * change to the password page, like every other admin call.
 */
export interface UploadOptions {
  for: MediaPurpose;
  /** A description for screen readers (website images). */
  alt?: string;
  signal?: AbortSignal;
}

export interface UploadOutcome {
  media: MediaDTO;
  /** True when this exact file was already stored and that record was returned. */
  duplicate: boolean;
}

/** What a file input should accept for a purpose. The server re-checks the bytes regardless. */
export const acceptFor = (purpose: MediaPurpose): string =>
  purpose === 'content' ? 'image/png,image/jpeg,image/webp,image/avif' : 'application/pdf,image/png,image/jpeg';

export function sizeProblem(file: File, purpose: MediaPurpose): string | null {
  const max = purpose === 'content' ? MAX_PUBLIC_BYTES : MAX_PRIVATE_BYTES;
  if (file.size === 0) return 'That file is empty.';
  return file.size > max ? `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(max)}.` : null;
}

export async function uploadMedia(file: File, options: UploadOptions): Promise<UploadOutcome> {
  const early = sizeProblem(file, options.for);
  if (early) throw new ApiError('VALIDATION_FAILED', early, 422, { file: early });

  const form = new FormData();
  form.set('for', options.for);
  if (options.alt?.trim()) form.set('alt', options.alt.trim());
  form.set('file', file, file.name);

  let response: Response;
  try {
    response = await fetch('/api/admin/media', { method: 'POST', body: form, credentials: 'same-origin', cache: 'no-store', signal: options.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('NETWORK', 'We could not reach the server. Check your connection and try again.', 0);
  }

  let json: ApiSuccess<UploadOutcome> | ApiFailure | null = null;
  try {
    json = (await response.json()) as ApiSuccess<UploadOutcome> | ApiFailure;
  } catch {
    /* not JSON */
  }
  if (json?.ok) return json.data;
  if (json && !json.ok) {
    if (json.error.code === 'UNAUTHORIZED') {
      hardNavigate(`/admin/auth/clear?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return new Promise<never>(() => {});
    }
    if (json.error.code === 'PASSWORD_CHANGE_REQUIRED') {
      hardNavigate('/admin/account/password');
      return new Promise<never>(() => {});
    }
    throw new ApiError(json.error.code, json.error.message, response.status, json.error.fields);
  }
  throw new ApiError('INTERNAL', 'Something went wrong on our side. Please try again.', response.status);
}
