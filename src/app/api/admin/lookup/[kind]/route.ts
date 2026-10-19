import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { lookup } from '@/services/lookup.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/lookup/<clients|projects|tasks|admins|third-parties>?q=&clientId=&projectId= : typeahead rows. */
export const GET = adminRoute<undefined, { kind: string }>({}, async ({ admin, params, request }) => {
  const sp = request.nextUrl.searchParams;
  const items = await lookup(admin, params.kind, {
    q: sp.get('q') ?? undefined,
    clientId: sp.get('clientId') ?? undefined,
    projectId: sp.get('projectId') ?? undefined,
  });
  return ok({ items });
});
