import type { Capability } from '@/config/capabilities';
import type { RateLimitRule } from '@/config/rate-limits';
import type { DetectedMime } from './detect';

/**
 * What may be uploaded, how big, and who may upload or read it. Pure data and small functions,
 * so the service, the route and the tests share one source of truth.
 */
export const MEDIA_PURPOSES = ['content', 'payment', 'payout', 'expense'] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];
export type PrivatePurpose = Exclude<MediaPurpose, 'content'>;

export const MAX_PUBLIC_BYTES = 5 * 1024 * 1024;
export const MAX_PRIVATE_BYTES = 10 * 1024 * 1024;
/** The whole request: the largest file plus room for the form fields and multipart framing. */
export const MAX_UPLOAD_REQUEST_BYTES = MAX_PRIVATE_BYTES + 256 * 1024;
/** A decoded image is width x height pixels in the visitor's memory, so absurd headers are refused. */
export const MAX_IMAGE_SIDE = 12_000;
export const MAX_IMAGE_PIXELS = 80_000_000;

export const PUBLIC_TYPES: readonly DetectedMime[] = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'];
export const PRIVATE_TYPES: readonly DetectedMime[] = ['application/pdf', 'image/png', 'image/jpeg'];

/** Uploads are the one expensive write: a tighter limit than the general admin-write limit. */
export const UPLOAD_RATE_LIMIT: RateLimitRule = { limit: 40, windowSeconds: 10 * 60, failClosed: true };

export const isPrivatePurpose = (purpose: MediaPurpose): purpose is PrivatePurpose => purpose !== 'content';
export const visibilityFor = (purpose: MediaPurpose): 'public' | 'private' => (purpose === 'content' ? 'public' : 'private');

/** Capabilities that let someone UPLOAD for a purpose (any one is enough). */
export const UPLOAD_CAPABILITIES: Record<MediaPurpose, readonly Capability[]> = {
  content: ['content:edit'],
  payment: ['payment:record'],
  payout: ['payout:record'],
  expense: ['expense:submit', 'expense:record'],
};

/**
 * Capabilities that let someone READ private media of a purpose. Recording implies viewing for
 * grants, but both are listed so the rule reads the same for every role. An uploader may always
 * read their OWN expense receipt (admins submit out-of-pocket expenses and need to see them).
 */
export const VIEW_CAPABILITIES: Record<PrivatePurpose, readonly Capability[]> = {
  payment: ['payment:view', 'payment:record'],
  payout: ['payout:view', 'payout:record'],
  expense: ['expense:view', 'expense:record'],
};

/** Capabilities that let someone DELETE unreferenced private media of a purpose. */
export const DELETE_CAPABILITIES: Record<PrivatePurpose, readonly Capability[]> = {
  payment: ['payment:record'],
  payout: ['payout:record'],
  expense: ['expense:record'],
};

export interface SizeProblem {
  field: 'file';
  message: string;
}

export const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(n % (1024 * 1024) === 0 ? 0 : 1)} MB` : `${Math.round(n / 1024)} KB`);

/** Why a detected type or size is not allowed for this visibility, or null when it is. */
export function uploadProblem(visibility: 'public' | 'private', mime: DetectedMime, size: number): string | null {
  const allowed = visibility === 'public' ? PUBLIC_TYPES : PRIVATE_TYPES;
  if (!allowed.includes(mime)) {
    return visibility === 'public'
      ? 'Website images must be PNG, JPEG, WebP or AVIF files.'
      : 'Receipts and attachments must be PDF, PNG or JPEG files.';
  }
  const max = visibility === 'public' ? MAX_PUBLIC_BYTES : MAX_PRIVATE_BYTES;
  if (size > max) return `That file is ${formatBytes(size)}. The limit is ${formatBytes(max)}.`;
  return null;
}
