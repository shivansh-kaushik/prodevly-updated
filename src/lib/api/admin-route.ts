import { randomUUID } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import type { ZodType } from 'zod';
import { RATE_LIMITS } from '@/config/rate-limits';
import type { Capability } from '@/config/capabilities';
import { assertCapability, assertPasswordCurrent, assertStepUp, authenticateRequest } from '@/lib/auth/guard';
import { sessionCookieName, sessionCookieOptions, shouldReissue, signSession } from '@/lib/auth/token';
import type { SessionUser } from '@/types/session';
import { validationFailed } from './errors';
import { getClientIp, hashIp } from './client-ip';
import { withRoute } from './handler';
import { enforceRateLimit } from './rate-limit';
import { assertSameOrigin, readJson, userAgentOf } from './request';
import { fieldErrors } from '@/lib/validation/common';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Admin } from '@/models';

/** What every admin handler receives. */
export interface AdminContext<Body, Params> {
  request: NextRequest;
  admin: SessionUser;
  /** From the token, for handlers that mint a replacement cookie: `authTime` must be carried over. */
  session: { authTime: number; stepUpUntil?: number };
  body: Body;
  params: Params;
  /** For audit entries and rate limiting. Raw IPs are never stored. */
  meta: { ipHash: string; userAgent: string; requestId: string };
}

export interface AdminRouteOptions<Body> {
  /** Capability required. Superadmins hold all of them; omit for "any signed-in admin". */
  capability?: Capability;
  /** Zod schema for the JSON body (POST, PUT, PATCH). */
  schema?: ZodType<Body>;
  /** Require a recent password re-entry. */
  stepUp?: boolean;
  /** Allow the call while the account still has to set a new password (change-password, logout). */
  allowPasswordChangePending?: boolean;
}

/**
 * The one way to write an admin API route. In order it: checks same-origin for
 * writes, authenticates against the DATABASE, forces a pending password change
 * first, checks the capability (and step-up), rate-limits writes per admin
 * (fails closed), parses and validates the JSON body, runs your handler, slides
 * the session cookie when it is half spent, and maps every error to the envelope.
 *
 * The proxy is only a redirect convenience; this is the boundary.
 */
export function adminRoute<Body = undefined, Params extends Record<string, string> = Record<string, string>>(
  options: AdminRouteOptions<Body>,
  handler: (ctx: AdminContext<Body, Params>) => Promise<NextResponse>,
) {
  return withRoute(async (request: NextRequest, context: { params: Promise<Params> }) => {
    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase());
    if (isWrite) assertSameOrigin(request);

    const { admin, payload } = await authenticateRequest(request);
    if (!options.allowPasswordChangePending) assertPasswordCurrent(admin);
    if (options.capability) assertCapability(admin, options.capability);
    if (options.stepUp) assertStepUp(admin);

    const ip = getClientIp(request.headers);
    if (isWrite) await enforceRateLimit('admin:mutation', admin.id, RATE_LIMITS.adminMutation);

    let body = undefined as Body;
    if (options.schema) {
      const parsed = options.schema.safeParse(await readJson(request));
      if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
      body = parsed.data;
    }

    const params = (await context.params) ?? ({} as Params);
    const response = await handler({
      request,
      admin,
      session: { authTime: payload.auth_time, stepUpUntil: payload.su },
      body,
      params,
      meta: { ipHash: hashIp(ip), userAgent: userAgentOf(request), requestId: randomUUID() },
    });

    if (shouldReissue(payload)) {
      await connectToDatabase();
      const fresh = await Admin.findById(admin.id).select('tokenVersion role').lean();
      if (fresh && fresh.tokenVersion === payload.tv) {
        const { token, maxAgeSeconds } = await signSession(
          { id: admin.id, role: fresh.role, tokenVersion: fresh.tokenVersion },
          { authTime: payload.auth_time, stepUpUntil: payload.su },
        );
        // Do not overwrite a cookie the handler itself set (sign-out-everywhere, password change).
        if (!response.cookies.has(sessionCookieName())) {
          response.cookies.set(sessionCookieName(), token, sessionCookieOptions(maxAgeSeconds));
        }
      }
    }
    return response;
  });
}
