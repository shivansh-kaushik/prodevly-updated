import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { RATE_LIMITS } from '@/config/rate-limits';
import { validationFailed } from '@/lib/api/errors';
import { getClientIp, hashIp } from '@/lib/api/client-ip';
import { withRoute } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { assertSameOrigin, readJson, userAgentOf } from '@/lib/api/request';
import { ok } from '@/lib/api/response';
import { sessionCookieName, sessionCookieOptions } from '@/lib/auth/token';
import { loginSchema } from '@/lib/validation/auth';
import { fieldErrors } from '@/lib/validation/common';
import { login } from '@/services/auth.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `POST /api/admin/auth/login`: the only door into the admin panel. See `login()` for the defences. */
export const POST = withRoute(async (request: NextRequest) => {
  assertSameOrigin(request);

  const ip = getClientIp(request.headers);
  await enforceRateLimit('admin:login:ip', ip, RATE_LIMITS.adminLoginIp);

  const parsed = loginSchema.safeParse(await readJson(request));
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));

  const { admin, token, maxAgeSeconds } = await login(parsed.data.email, parsed.data.password, {
    ipHash: hashIp(ip),
    userAgent: userAgentOf(request),
    requestId: randomUUID(),
  });

  const response = ok({ admin, mustChangePassword: admin.mustChangePassword });
  response.cookies.set(sessionCookieName(), token, sessionCookieOptions(maxAgeSeconds));
  return response;
});
