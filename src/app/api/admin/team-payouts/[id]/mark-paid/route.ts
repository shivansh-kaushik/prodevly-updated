import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { markPaidSchema, type MarkPaidInput } from '@/lib/validation/team-payout';
import { markTeamPayoutPaid } from '@/services/team-payout.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Marks a due payout paid: captures the rate for the paid date, recomputes the allocations' INR shares and locks the person's
 * work logs in the period, all in one transaction with the audit entry.
 */
export const POST = adminRoute<MarkPaidInput, { id: string }>(
  { capability: 'money:approve', schema: markPaidSchema },
  async ({ admin, body, params, meta }) => ok(await markTeamPayoutPaid(admin, params.id, body, meta)),
);
