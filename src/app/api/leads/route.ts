import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { RATE_LIMITS } from '@/config/rate-limits';
import { getClientIp, hashIp } from '@/lib/api/client-ip';
import { payloadTooLarge } from '@/lib/api/errors';
import { withRoute } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { assertSameOrigin, readJson, userAgentOf } from '@/lib/api/request';
import { created } from '@/lib/api/response';
import { createLeadFromPublic } from '@/services/lead.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A contact form is a few hundred words at most. */
const MAX_LEAD_BODY_BYTES = 32 * 1024;

/**
 * The public contact-form intake. Public on purpose, so it is NOT an adminRoute: no session, no
 * capability. This file does the HTTP parts in plan order (same origin, size, rate limit, JSON);
 * every rule that decides whether a submission is stored lives in `createLeadFromPublic`.
 *
 * Every outcome that is not an error answers the SAME 201 body: a stored enquiry, a duplicate, a
 * spam-held one, a honeypot hit and a too-fast submission look identical to the sender.
 */
export const POST = withRoute(async (request: NextRequest) => {
  assertSameOrigin(request);
  // Refuse a declared oversize body before spending a rate-limit hit or reading a byte of it.
  if (Number(request.headers.get('content-length') ?? 0) > MAX_LEAD_BODY_BYTES) throw payloadTooLarge('That message is too large');

  const ip = getClientIp(request.headers);
  // Fails OPEN (RATE_LIMITS.leadCreate): the honeypot, form token and duplicate window still stand if the limiter's store is down.
  await enforceRateLimit('lead:create', ip, RATE_LIMITS.leadCreate, 'Too many messages from your connection. Please wait a few minutes and try again.');

  const body = await readJson(request, MAX_LEAD_BODY_BYTES);
  await createLeadFromPublic(body, { ipHash: hashIp(ip), userAgent: userAgentOf(request), requestId: randomUUID() });
  return created({ received: true });
});
