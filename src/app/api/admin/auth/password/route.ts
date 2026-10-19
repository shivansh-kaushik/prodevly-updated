import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { sessionCookieName, sessionCookieOptions } from '@/lib/auth/token';
import { changePasswordSchema, type ChangePasswordInput } from '@/lib/validation/auth';
import { changeOwnPassword } from '@/services/auth.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Change your own password. Ends every other session; this browser gets a fresh cookie. */
export const POST = adminRoute<ChangePasswordInput>(
  { schema: changePasswordSchema, allowPasswordChangePending: true },
  async ({ admin, body, meta }) => {
    const { admin: dto, token, maxAgeSeconds } = await changeOwnPassword(
      admin.id,
      body.currentPassword,
      body.newPassword,
      meta,
    );
    const response = ok({ admin: dto });
    response.cookies.set(sessionCookieName(), token, sessionCookieOptions(maxAgeSeconds));
    return response;
  },
);
