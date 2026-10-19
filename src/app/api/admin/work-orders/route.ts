import { adminRoute } from '@/lib/api/admin-route';
import { created, ok } from '@/lib/api/response';
import { first, parseListParams } from '@/lib/admin/search-params';
import { WORK_ORDER_SORTS, createWorkOrderSchema, parseWorkOrderFilter, type CreateWorkOrderBody, type WorkOrderSort } from '@/lib/validation/work-order';
import { createWorkOrder, searchWorkOrders } from '@/services/work-order.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/work-orders?q=&status=open|delivered|closed|cancelled|current&thirdParty=&project=&client=&sort=&dir=&page=&pageSize= */
export const GET = adminRoute({ capability: 'payout:view' }, async ({ admin, request }) => {
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const list = parseListParams(sp, { sortable: WORK_ORDER_SORTS, defaultSort: 'updatedAt', pageSize: Number(first(sp, 'pageSize')) || 25 });
  return ok(await searchWorkOrders(admin, { ...parseWorkOrderFilter(sp), sort: list.sort as WorkOrderSort, dir: list.dir, page: list.page, pageSize: list.pageSize }));
});

export const POST = adminRoute<CreateWorkOrderBody>(
  { capability: 'payout:record', schema: createWorkOrderSchema },
  async ({ admin, body, meta }) => created({ workOrder: await createWorkOrder(admin, body, meta) }),
);
