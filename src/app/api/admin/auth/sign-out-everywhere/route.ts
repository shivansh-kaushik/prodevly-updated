import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { sessionCookieName, sessionCookieOptions } from '@/lib/auth/token';
import { signOutEverywhere } from '@/services/auth.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ends every other session this admin holds. This browser stays signed in with a fresh cookie. */
export const POST = adminRoute({ allowPasswordChangePending: true }, async ({ admin, session, meta }) => {
  const { token, maxAgeSeconds } = await signOutEverywhere(admin.id, session.authTime, meta);
  const response = ok({ signedOut: true });
  response.cookies.set(sessionCookieName(), token, sessionCookieOptions(maxAgeSeconds));
  return response;
});
