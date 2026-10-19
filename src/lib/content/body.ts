import type { NextRequest } from 'next/server';
import type { ZodType } from 'zod';
import { validationFailed } from '@/lib/api/errors';
import { readJson } from '@/lib/api/request';
import { fieldErrors } from '@/lib/validation/common';

/**
 * Parses a route's JSON body when the schema depends on the URL (`/content/[type]` takes a
 * different body for each type, so `adminRoute`'s fixed `schema` option cannot be used). Run it
 * AFTER `adminRoute` has checked the capability, so a viewer who may not write is refused
 * (403) before anything about their body is examined.
 */
export async function parseJsonBody(request: NextRequest, schema: ZodType): Promise<unknown> {
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  return parsed.data;
}
