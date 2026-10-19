import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { updateTeamPayoutSchema, type UpdateTeamPayoutInput } from '@/lib/validation/team-payout';
import { getTeamPayout, updateTeamPayout } from '@/services/team-payout.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { id: string };

/** The person it is for, or team:payView. The service decides (the person gets the plain version). */
export const GET = adminRoute<undefined, Params>({}, async ({ admin, params }) => ok({ payout: await getTeamPayout(admin, params.id) }));

/** Edits a payout that is still due. A paid payout is immutable (409 ENTRY_LOCKED). */
export const PATCH = adminRoute<UpdateTeamPayoutInput, Params>(
  { capability: 'teamPayout:record', schema: updateTeamPayoutSchema },
  async ({ admin, body, params, meta }) => ok(await updateTeamPayout(admin, params.id, body, meta)),
);
