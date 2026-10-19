import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { archiveThirdParty } from '@/services/third-party.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Archive instead of delete. Refused while open work orders or due payouts refer to the third party. */
export const POST = adminRoute<undefined, { id: string }>({ capability: 'thirdParty:edit' }, async ({ admin, params, meta }) =>
  ok({ thirdParty: await archiveThirdParty(admin, params.id, meta) }),
);
