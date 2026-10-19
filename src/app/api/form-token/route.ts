import { FORM_TOKEN_MAX_AGE_MS, signFormToken } from '@/lib/api/form-token';
import { withRoute } from '@/lib/api/handler';
import { ok } from '@/lib/api/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The contact form asks for a token when it loads and sends it back with the submission
 * (see lib/api/form-token.ts for what it proves). Public, no database, never cached: every
 * token carries its own issue time.
 */
export const GET = withRoute(async () =>
  ok({ token: signFormToken(), expiresInSeconds: FORM_TOKEN_MAX_AGE_MS / 1000 }, { headers: { 'Cache-Control': 'no-store, max-age=0' } }),
);
