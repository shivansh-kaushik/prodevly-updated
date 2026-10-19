import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { sessionCookieName, sessionCookieOptions } from '@/lib/auth/token';
import { stepUpSchema } from '@/lib/validation/auth';
import { stepUp } from '@/services/auth.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Re-enter your password to unlock sensitive actions (admin management, grants) for 10
 * minutes. The window is carried by the cookie this response sets, so it belongs to
 * this browser only.
 */
export const POST = adminRoute({ schema: stepUpSchema }, async ({ admin, session, body, meta }) => {
  const { validUntil, token, maxAgeSeconds } = await stepUp(admin.id, body.password, session.authTime, meta);
  const response = ok({ validUntil });
  response.cookies.set(sessionCookieName(), token, sessionCookieOptions(maxAgeSeconds));
  return response;
});
