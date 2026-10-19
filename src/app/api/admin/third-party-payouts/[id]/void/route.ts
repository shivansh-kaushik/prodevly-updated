import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { voidPayoutSchema, type VoidPayoutInput } from '@/lib/validation/third-party-payout';
import { voidPayout } from '@/services/third-party-payout.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Money is voided with a reason, never deleted. Superadmin-only (`money:void`). */
export const POST = adminRoute<VoidPayoutInput, { id: string }>(
  { capability: 'money:void', schema: voidPayoutSchema },
  async ({ admin, body, params, meta }) => ok({ payout: await voidPayout(admin, params.id, body, meta) }),
);
