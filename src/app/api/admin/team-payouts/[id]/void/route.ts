import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { voidPayoutSchema, type VoidPayoutInput } from '@/lib/validation/team-payout';
import { voidTeamPayout } from '@/services/team-payout.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Voids a payout with a reason. It drops out of every total and the work logs it locked are released. */
export const POST = adminRoute<VoidPayoutInput, { id: string }>(
  { capability: 'money:void', schema: voidPayoutSchema },
  async ({ admin, body, params, meta }) => ok(await voidTeamPayout(admin, params.id, body, meta)),
);
