import { z, type ZodError } from 'zod';
import { notFound } from '@/lib/api/errors';

/** Flattens a ZodError to `{ "field.path": "message" }` for forms. First message per field wins. */
export function fieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

const OBJECT_ID = /^[a-f\d]{24}$/i;

export const objectIdSchema = z.string().regex(OBJECT_ID, { error: 'Invalid id' });

/**
 * Route params: an invalid id is "not found", never a 500 from a Mongo cast error.
 * Always returns the LOWERCASE form: a hex id has two spellings and identity checks
 * (`isSelf`) compare strings, so "5F3A..." must not slip past a guard written for "5f3a...".
 */
export function parseObjectId(value: string | undefined): string {
  if (!value || !OBJECT_ID.test(value)) throw notFound();
  return value.toLowerCase();
}

export const emailSchema = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Enter a valid email address' }));

export const nameSchema = z
  .string({ error: 'Name is required' })
  .trim()
  .min(2, { error: 'Name is required' })
  .max(80, { error: 'Name is too long' });
