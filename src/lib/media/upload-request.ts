import type { NextRequest } from 'next/server';
import { badRequest, payloadTooLarge } from '@/lib/api/errors';
import { MAX_UPLOAD_REQUEST_BYTES } from './rules';

/**
 * Reads a multipart upload with a hard size cap enforced WHILE STREAMING, so a client that lies
 * about Content-Length (or sends no length at all) cannot make the server buffer a huge body.
 * The buffered bytes are then parsed as multipart; nothing is trusted from the file part except
 * its bytes (its name only seeds a sanitised name, its declared type is ignored).
 */
export interface ParsedUpload {
  file: { name: string; data: Buffer };
  /** The text fields of the form, by name. */
  fields: Record<string, string>;
}

async function readCapped(request: NextRequest, maxBytes: number): Promise<Buffer> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw payloadTooLarge('That upload is too large');

  const reader = request.body?.getReader();
  if (!reader) throw badRequest('The upload is empty');
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw payloadTooLarge('That upload is too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function readUpload(request: NextRequest, maxBytes = MAX_UPLOAD_REQUEST_BYTES): Promise<ParsedUpload> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) throw badRequest('Send the file as a multipart form');

  const body = await readCapped(request, maxBytes);
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(body), { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw badRequest('That upload could not be read');
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') throw badRequest('Choose a file to upload');
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === 'string' && !(key in fields)) fields[key] = value;
  return { file: { name: file.name || 'file', data: Buffer.from(await file.arrayBuffer()) }, fields };
}
