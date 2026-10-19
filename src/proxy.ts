import { NextResponse, type NextRequest } from 'next/server';
import { safeNextPath } from '@/lib/auth/safe-next-path';
import { sessionCookieName, sessionCookieOptions, shouldReissue, signSession, verifySession } from '@/lib/auth/token';

/**
 * Edge-of-app routing for /admin. (Next 16 renamed `middleware` to `proxy`.)
 *
 * A UX convenience, NOT a security boundary: it verifies the token's signature and
 * expiry (no database), which is enough to bounce signed-out visitors to the sign-in
 * page. Real authorisation (account active, token not revoked, capabilities) happens
 * in the guards that every admin page and API route call. Deleting this file would
 * cost a redirect, not safety.
 *
 * It never redirects AWAY from the sign-in page: it cannot tell a revoked cookie from
 * a good one, and guessing wrong is exactly what caused redirect loops before.
 */
const PUBLIC = [/^\/admin\/login\/?$/, /^\/admin\/auth\//];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();

  const raw = request.cookies.get(sessionCookieName())?.value;
  const payload = await verifySession(raw);

  if (!payload) {
    const url = request.nextUrl.clone();
    // A cookie that is present but invalid goes through /admin/auth/clear, which deletes it.
    url.pathname = raw ? '/admin/auth/clear' : '/admin/login';
    url.search = `?next=${encodeURIComponent(safeNextPath(pathname + search))}`;
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next();
  // Slide the session on page loads too. A revoked token still fails the database check in the guards.
  if (shouldReissue(payload)) {
    const { token, maxAgeSeconds } = await signSession(
      { id: payload.sub, role: payload.role, tokenVersion: payload.tv },
      { authTime: payload.auth_time, stepUpUntil: payload.su },
    );
    response.cookies.set(sessionCookieName(), token, sessionCookieOptions(maxAgeSeconds));
  }
  return response;
}

export const config = {
  // Only the admin surface. Every API route does its own authentication.
  matcher: ['/admin/:path*'],
};
