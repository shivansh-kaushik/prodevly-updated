import type { ApiFailure, ApiSuccess } from '@/types/api';

/**
 * The browser's door to /api/admin. Every call returns the unwrapped `data` or throws an
 * ApiError carrying the server's code and per-field messages, so forms can show them in place.
 * Sign-in expiry, a pending password change and step-up are handled one level up
 * (components/admin/api-provider.tsx) so no screen has to remember them.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields: Record<string, string>;
  readonly retryAfterSeconds?: number;

  constructor(code: string, message: string, status: number, fields?: Record<string, string>, retryAfterSeconds?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.fields = fields ?? {};
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface FetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function adminFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const method = options.method ?? (options.body !== undefined ? 'POST' : 'GET');
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: options.signal,
      headers: options.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('NETWORK', 'We could not reach the server. Check your connection and try again.', 0);
  }

  let json: ApiSuccess<T> | ApiFailure | null = null;
  try {
    json = (await response.json()) as ApiSuccess<T> | ApiFailure;
  } catch {
    /* not JSON */
  }
  if (json && json.ok) return json.data;
  if (json && !json.ok) {
    const retry = Number(response.headers.get('retry-after'));
    throw new ApiError(json.error.code, json.error.message, response.status, json.error.fields, Number.isFinite(retry) && retry > 0 ? retry : undefined);
  }
  throw new ApiError('INTERNAL', 'Something went wrong on our side. Please try again.', response.status);
}

/** A file the server answered with, read as bytes so a byte order mark and every character survive. */
export interface DownloadResult {
  blob: Blob;
  filename: string;
  /** Data rows in the file, from the server's `X-Export-Rows`. */
  rows: number | null;
  /** Rows that matched, from `X-Export-Total`. More than `rows` when the server cut the file short. */
  total: number | null;
  truncated: boolean;
}

const headerNumber = (response: Response, name: string): number | null => {
  const raw = response.headers.get(name);
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? value : null;
};

/** `attachment; filename="prodevly-clients-2026-10-12.csv"` to its file name. */
function filenameFrom(disposition: string | null): string {
  const match = /filename="([^"\r\n\\/]+)"/.exec(disposition ?? '');
  return match?.[1] ?? 'prodevly-export.csv';
}

/**
 * GET a CSV export. Like adminFetch it throws an ApiError carrying the server's code (STEP_UP_REQUIRED, FORBIDDEN, RATE_LIMITED)
 * when the answer is the JSON envelope instead of a file, so the provider can recover the same way it does for a JSON call.
 */
export async function adminDownload(path: string, options: { signal?: AbortSignal } = {}): Promise<DownloadResult> {
  let response: Response;
  try {
    response = await fetch(path, { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: options.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('NETWORK', 'We could not reach the server. Check your connection and try again.', 0);
  }

  if (!response.ok || !(response.headers.get('content-type') ?? '').toLowerCase().startsWith('text/csv')) {
    let json: ApiSuccess<unknown> | ApiFailure | null = null;
    try {
      json = (await response.json()) as ApiSuccess<unknown> | ApiFailure;
    } catch {
      /* not JSON */
    }
    if (json && !json.ok) {
      const retry = Number(response.headers.get('retry-after'));
      throw new ApiError(json.error.code, json.error.message, response.status, json.error.fields, Number.isFinite(retry) && retry > 0 ? retry : undefined);
    }
    throw new ApiError('INTERNAL', 'Something went wrong on our side. Please try again.', response.status);
  }

  return {
    blob: await response.blob(),
    filename: filenameFrom(response.headers.get('content-disposition')),
    rows: headerNumber(response, 'x-export-rows'),
    total: headerNumber(response, 'x-export-total'),
    truncated: response.headers.get('x-export-truncated') === 'true',
  };
}

/**
 * A full page navigation, for the few destinations that are route handlers rather than pages
 * (the cookie-clearing redirect): the client router can only navigate to pages.
 */
export function hardNavigate(url: string): void {
  window.location.assign(url);
}

/** Query string from a plain object, skipping empty values. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}
