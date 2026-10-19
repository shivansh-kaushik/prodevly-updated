import { ZodError } from 'zod';
import type { NextRequest } from 'next/server';
import { DatabaseUnavailableError } from '@/lib/db/mongoose';
import { fieldErrors } from '@/lib/validation/common';
import { AppError } from './errors';
import { failure } from './response';

/**
 * Wraps a route handler so every failure leaves by the same door. Known
 * failures (AppError, ZodError, duplicate keys, a dead database) map to a status
 * and a message written for a person. Anything else is a bug: logged in full on
 * the server, answered with a generic 500.
 */
export function withRoute<Context>(handler: (request: NextRequest, context: Context) => Promise<Response>) {
  return async (request: NextRequest, context: Context): Promise<Response> => {
    try {
      return await handler(request, context);
    } catch (error) {
      return toErrorResponse(error, request);
    }
  };
}

function isDuplicateKeyError(error: unknown): error is { code: number; keyPattern?: Record<string, number> } {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;
}

export function toErrorResponse(error: unknown, request?: NextRequest): Response {
  if (error instanceof AppError) {
    return failure(error.code, error.message, error.status, { fields: error.fields, headers: error.headers });
  }
  if (error instanceof ZodError) {
    return failure('VALIDATION_FAILED', 'Please check the highlighted fields', 422, { fields: fieldErrors(error) });
  }
  if (error instanceof DatabaseUnavailableError) {
    console.error('[db] unavailable:', error.message);
    return failure('SERVICE_UNAVAILABLE', 'We could not reach the database just now. Please try again shortly.', 503);
  }
  if (isDuplicateKeyError(error)) {
    const field = Object.keys(error.keyPattern ?? {})[0];
    return failure('CONFLICT', 'That record already exists', 409, {
      fields: field ? { [field]: 'This value is already in use' } : undefined,
    });
  }
  if (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'ValidationError') {
    const e = error as { errors?: Record<string, { message?: string }> };
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(e.errors ?? {})) fields[key] = value?.message ?? 'Invalid value';
    return failure('VALIDATION_FAILED', 'Please check the highlighted fields', 422, { fields });
  }

  console.error('[api] unhandled error', { path: request?.nextUrl?.pathname, method: request?.method, error });
  return failure('INTERNAL', 'Something went wrong on our side. Please try again.', 500);
}
