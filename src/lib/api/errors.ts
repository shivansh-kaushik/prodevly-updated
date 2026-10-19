/**
 * Typed application errors. Route handlers and services throw these and
 * `withRoute` turns them into the JSON envelope. Anything that is NOT one of
 * these is a bug: it is logged in full on the server and answered with a generic
 * 500, so a stack trace or a Mongo error string never reaches the browser.
 */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'STEP_UP_REQUIRED'
  | 'SELF_ACTION'
  | 'LAST_SUPERADMIN'
  | 'LINK_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'FX_RATE_MISSING'
  | 'PAYMENT_EXCEEDS_DUE'
  | 'ENTRY_LOCKED'
  | 'HAS_LINKED_RECORDS'
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;
  /** Extra response headers, e.g. `Retry-After` on a 429. */
  readonly headers?: Record<string, string>;

  constructor(
    code: ErrorCode,
    message: string,
    status: number,
    options?: { fields?: Record<string, string>; headers?: Record<string, string>; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.fields = options?.fields;
    this.headers = options?.headers;
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new AppError('BAD_REQUEST', message, 400, { fields });

export const validationFailed = (fields: Record<string, string>, message = 'Please check the highlighted fields') =>
  new AppError('VALIDATION_FAILED', message, 422, { fields });

export const unauthorized = (message = 'Please sign in to continue') => new AppError('UNAUTHORIZED', message, 401);

export const forbidden = (message = 'You do not have access to this') => new AppError('FORBIDDEN', message, 403);

export const notFound = (message = 'We could not find that') => new AppError('NOT_FOUND', message, 404);

export const conflict = (message: string, fields?: Record<string, string>) =>
  new AppError('CONFLICT', message, 409, { fields });

export const payloadTooLarge = (message = 'That request is too large') => new AppError('PAYLOAD_TOO_LARGE', message, 413);

export const rateLimited = (retryAfterSeconds: number, message = 'Too many attempts. Please try again shortly.') =>
  new AppError('RATE_LIMITED', message, 429, {
    headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  });

export const serviceUnavailable = (message = 'That service is temporarily unavailable') =>
  new AppError('SERVICE_UNAVAILABLE', message, 503);

export const passwordChangeRequired = () =>
  new AppError('PASSWORD_CHANGE_REQUIRED', 'You must set a new password before you can continue', 403);

export const stepUpRequired = () =>
  new AppError('STEP_UP_REQUIRED', 'Please confirm your password to continue with this action', 403);

export const selfAction = (message = 'You cannot do this to your own account') =>
  new AppError('SELF_ACTION', message, 403);

export const lastSuperadmin = () =>
  new AppError('LAST_SUPERADMIN', 'There must always be at least one active superadmin', 409);

/** The ids in a request disagree (a task from another project, a project from another client). */
export const linkMismatch = (message = 'Those records do not belong together', fields?: Record<string, string>) =>
  new AppError('LINK_MISMATCH', message, 422, { fields });

export const currencyMismatch = (message = 'The currency does not match the record it settles', fields?: Record<string, string>) =>
  new AppError('CURRENCY_MISMATCH', message, 422, { fields });

export const fxRateMissing = (currency: string) =>
  new AppError('FX_RATE_MISSING', `There is no recent exchange rate for ${currency}. Enter one to continue.`, 422, {
    fields: { fxRate: 'Enter the exchange rate' },
  });

export const paymentExceedsDue = (message = 'That payment is more than is still due on this project') =>
  new AppError('PAYMENT_EXCEEDS_DUE', message, 422);

/** A work log covered by a paid payout, or a record locked by something downstream. */
export const entryLocked = (message = 'That entry is locked and can no longer be changed') =>
  new AppError('ENTRY_LOCKED', message, 409);

export const hasLinkedRecords = (message = 'That record has linked records, so it cannot be deleted. Archive it instead.') =>
  new AppError('HAS_LINKED_RECORDS', message, 409);
