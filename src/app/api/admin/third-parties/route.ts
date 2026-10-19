import { adminRoute } from '@/lib/api/admin-route';
import { created, ok } from '@/lib/api/response';
import { first, parseListParams } from '@/lib/admin/search-params';
import { THIRD_PARTY_SORTS, createThirdPartySchema, parseThirdPartyFilter, type CreateThirdPartyBody, type ThirdPartySort } from '@/lib/validation/third-party';
import { createThirdParty, searchThirdParties } from '@/services/third-party.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/third-parties?q=&type=&status=&archived=only|include&sort=&dir=&page=&pageSize= (the payment note is never in a list) */
export const GET = adminRoute({ capability: 'thirdParty:view' }, async ({ admin, request }) => {
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const list = parseListParams(sp, { sortable: THIRD_PARTY_SORTS, defaultSort: 'name', defaultDir: 'asc', pageSize: Number(first(sp, 'pageSize')) || 25 });
  return ok(await searchThirdParties(admin, { ...parseThirdPartyFilter(sp), sort: list.sort as ThirdPartySort, dir: list.dir, page: list.page, pageSize: list.pageSize }));
});

/** The payment note in the body needs `thirdParty:payDetails`; the service refuses it for anyone else. */
export const POST = adminRoute<CreateThirdPartyBody>(
  { capability: 'thirdParty:edit', schema: createThirdPartySchema },
  async ({ admin, body, meta }) => created({ thirdParty: await createThirdParty(admin, body, meta) }),
);
