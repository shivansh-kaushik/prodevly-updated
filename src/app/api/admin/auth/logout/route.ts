import type { NextRequest } from 'next/server';
import { withRoute } from '@/lib/api/handler';
import { assertSameOrigin } from '@/lib/api/request';
import { ok } from '@/lib/api/response';
import { sessionCookieName, sessionCookieOptions } from '@/lib/auth/token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Signing out only needs to drop the cookie, and must work even when the session has already expired. */
export const POST = withRoute(async (request: NextRequest) => {
  assertSameOrigin(request);
  const response = ok({ signedOut: true });
  response.cookies.set(sessionCookieName(), '', sessionCookieOptions(0));
  return response;
});
