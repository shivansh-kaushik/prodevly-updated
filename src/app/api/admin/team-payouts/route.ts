import { adminRoute } from '@/lib/api/admin-route';
import { created, ok } from '@/lib/api/response';
import { createTeamPayoutSchema, type CreateTeamPayoutInput } from '@/lib/validation/team-payout';
import { createTeamPayout, listTeamPayouts } from '@/services/team-payout.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/team-payouts?adminId=&status=&q=&from=&to=&sort=&dir=&page=
 * No route-level capability: "everyone's with team:payView, otherwise only your own" cannot be one capability, so the
 * service decides (and answers 403 for someone else's). Empty query values count as "not set".
 */
export const GET = adminRoute({}, async ({ admin, request }) => {
  const query: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams) if (value !== '') query[key] = value;
  const { items, meta } = await listTeamPayouts(admin, query);
  return ok({ payouts: items, meta });
});

/** Records a payout as due. The result carries `warnings` (an overlapping payout, a period that runs past today). */
export const POST = adminRoute<CreateTeamPayoutInput>(
  { capability: 'teamPayout:record', schema: createTeamPayoutSchema },
  async ({ admin, body, meta }) => created(await createTeamPayout(admin, body, meta)),
);
