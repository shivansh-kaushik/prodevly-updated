import { NextResponse, type NextRequest } from 'next/server';
import { safeNextPath } from '@/lib/auth/safe-next-path';
import { sessionCookieName, sessionCookieOptions } from '@/lib/auth/token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Drops an invalid or revoked session cookie, then sends the person to sign in.
 *
 * This is what breaks the redirect loop the travel site could hit: a cookie that
 * is present but no longer valid used to bounce between /admin and /admin/login.
 * Guards redirect HERE (a public route that deletes the cookie), never straight
 * back to a page that would redirect again.
 */
export function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  const next = safeNextPath(url.searchParams.get('next'), '');
  url.pathname = '/admin/login';
  url.search = next ? `?next=${encodeURIComponent(next)}` : '';
  const response = NextResponse.redirect(url);
  response.cookies.set(sessionCookieName(), '', sessionCookieOptions(0));
  return response;
}
