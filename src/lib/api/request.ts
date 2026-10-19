import type { NextRequest } from 'next/server';
import { badRequest, forbidden, payloadTooLarge } from './errors';

export const MAX_BODY_BYTES = 64 * 1024;

/**
 * CSRF defence for cookie-authenticated mutations. `SameSite=Lax` already blocks
 * cross-site POSTs; this adds a second check. A state-changing request must come
 * from our own origin (`Sec-Fetch-Site`) or carry an `Origin` that matches our
 * host. Browsers that send neither are rejected.
 */
export function assertSameOrigin(request: NextRequest): void {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;

  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'same-origin') return;
  if (fetchSite && fetchSite !== 'none') throw forbidden('Cross-site requests are not allowed');

  const origin = request.headers.get('origin');
  if (!origin) {
    // A same-origin form POST from a very old browser: accept only if Referer agrees with our host.
    const referer = request.headers.get('referer');
    try {
      if (referer && new URL(referer).host === request.nextUrl.host) return;
    } catch {
      /* fall through */
    }
    throw forbidden('Could not verify the request origin');
  }

  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw forbidden('Could not verify the request origin');
  }
  if (host !== request.nextUrl.host) throw forbidden('Cross-site requests are not allowed');
}

/**
 * Parses a JSON body with a hard size cap. The cap is enforced while STREAMING,
 * so a client that lies about Content-Length cannot make us buffer a huge body.
 */
export async function readJson(request: NextRequest, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) throw badRequest('Expected a JSON request body');

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw payloadTooLarge();

  const reader = request.body?.getReader();
  if (!reader) throw badRequest('The request body is empty');

  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw payloadTooLarge();
    }
    chunks.push(value);
  }

  const text = new TextDecoder().decode(Buffer.concat(chunks));
  if (!text.trim()) throw badRequest('The request body is empty');
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest('That request body was not valid JSON');
  }
}

export function userAgentOf(request: NextRequest): string {
  return (request.headers.get('user-agent') ?? '').slice(0, 400);
}
