import { adminRoute } from '@/lib/api/admin-route';
import { created, ok } from '@/lib/api/response';
import { first, oneOf } from '@/lib/admin/search-params';
import { CLIENT_STATUSES } from '@/config/statuses';
import { createClientSchema, type CreateClientInput } from '@/lib/validation/client';
import { createClient, listClients } from '@/services/client.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/clients?q=&status=&page= : the list as JSON (the pages read through the service directly). */
export const GET = adminRoute({ capability: 'client:view' }, async ({ admin, request }) => {
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const result = await listClients(admin, {
    q: first(sp, 'q'),
    status: oneOf(sp, 'status', CLIENT_STATUSES),
    page: Number(first(sp, 'page') ?? 1) || 1,
  });
  return ok(result);
});

export const POST = adminRoute<CreateClientInput>(
  { capability: 'client:edit', schema: createClientSchema },
  async ({ admin, body, meta }) => created({ client: await createClient(admin, body, meta) }),
);
