import type { NextRequest } from 'next/server';
import { withRoute } from '@/lib/api/handler';
import { failure, ok } from '@/lib/api/response';
import { assertFeedReachable, fetchAndStoreRates, isCronAuthorised } from '@/services/fx.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/fx: the daily ECB rate pull, run by the host's scheduler with
 * `Authorization: Bearer <CRON_SECRET>`. Anything else gets the same bare 401, whether the secret is
 * wrong, missing or not configured, and nothing about the secret is ever logged. No session and no
 * cookie are involved, so the request is not a browser action and needs no same-origin check.
 */
export const GET = withRoute(async (request: NextRequest) => {
  if (!isCronAuthorised(request.headers.get('authorization'))) {
    return failure('UNAUTHORIZED', 'Not authorised', 401, { headers: { 'WWW-Authenticate': 'Bearer' } });
  }
  const result = await fetchAndStoreRates();
  assertFeedReachable(result);
  return ok(result);
});
