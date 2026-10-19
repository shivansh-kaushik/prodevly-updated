import { adminRoute } from '@/lib/api/admin-route';
import { created, ok } from '@/lib/api/response';
import { first, parseListParams } from '@/lib/admin/search-params';
import { PAYOUT_SORTS, createPayoutSchema, parsePayoutFilter, type CreatePayoutBody, type PayoutSort } from '@/lib/validation/third-party-payout';
import { createPayout, searchPayouts } from '@/services/third-party-payout.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/third-party-payouts?q=&status=due|paid|void&overdue=1&thirdParty=&workOrder=&project=&client=&sort=&dir=&page=&pageSize= */
export const GET = adminRoute({ capability: 'payout:view' }, async ({ admin, request }) => {
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const list = parseListParams(sp, { sortable: PAYOUT_SORTS, defaultSort: 'createdAt', pageSize: Number(first(sp, 'pageSize')) || 25 });
  return ok(await searchPayouts(admin, { ...parsePayoutFilter(sp), sort: list.sort as PayoutSort, dir: list.dir, page: list.page, pageSize: list.pageSize }));
});

/** Records a DUE payout. Answers `{ payout, warnings }`: above the work order's remaining balance is a warning, not a block. */
export const POST = adminRoute<CreatePayoutBody>(
  { capability: 'payout:record', schema: createPayoutSchema },
  async ({ admin, body, meta }) => created(await createPayout(admin, body, meta)),
);
