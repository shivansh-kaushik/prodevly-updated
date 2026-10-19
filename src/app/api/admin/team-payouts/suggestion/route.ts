import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { getPayoutSuggestion } from '@/services/team-payout.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/team-payouts/suggestion?adminId=&from=&to=
 * What the pay profile proposes for a person and period, and where their time went. The service parses the query and also
 * needs team:payView (it reads pay terms).
 */
export const GET = adminRoute({ capability: 'teamPayout:record' }, async ({ admin, request }) => {
  const sp = request.nextUrl.searchParams;
  return ok({ suggestion: await getPayoutSuggestion(admin, { adminId: sp.get('adminId') ?? '', from: sp.get('from') ?? '', to: sp.get('to') ?? '' }) });
});
