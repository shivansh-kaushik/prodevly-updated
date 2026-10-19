import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { updatePayoutSchema, type UpdatePayoutInput } from '@/lib/validation/third-party-payout';
import { getPayout, updatePayout } from '@/services/third-party-payout.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = adminRoute<undefined, Params>({ capability: 'payout:view' }, async ({ admin, params }) => ok({ payout: await getPayout(admin, params.id) }));

/** Only while the payout is due (ENTRY_LOCKED afterwards). The links are not editable: void it and record a new one. */
export const PATCH = adminRoute<UpdatePayoutInput, Params>(
  { capability: 'payout:record', schema: updatePayoutSchema },
  async ({ admin, body, params, meta }) => ok(await updatePayout(admin, params.id, body, meta)),
);
