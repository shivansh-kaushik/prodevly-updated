import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { restoreClient } from '@/services/client.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = adminRoute<undefined, { id: string }>({ capability: 'client:archive' }, async ({ admin, params, meta }) =>
  ok({ client: await restoreClient(admin, params.id, meta) }),
);
