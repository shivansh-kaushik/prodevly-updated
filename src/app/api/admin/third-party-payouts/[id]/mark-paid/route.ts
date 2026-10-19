import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { markPaidSchema, type MarkPaidInput } from '@/lib/validation/third-party-payout';
import { markPayoutPaid } from '@/services/third-party-payout.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** "Mark paid" is superadmin-only (`money:approve`). It captures the exchange rate again for the day the money left. */
export const POST = adminRoute<MarkPaidInput, { id: string }>(
  { capability: 'money:approve', schema: markPaidSchema },
  async ({ admin, body, params, meta }) => ok({ payout: await markPayoutPaid(admin, params.id, body, meta) }),
);
