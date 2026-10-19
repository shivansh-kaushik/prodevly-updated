import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { restoreThirdParty } from '@/services/third-party.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = adminRoute<undefined, { id: string }>({ capability: 'thirdParty:edit' }, async ({ admin, params, meta }) =>
  ok({ thirdParty: await restoreThirdParty(admin, params.id, meta) }),
);
