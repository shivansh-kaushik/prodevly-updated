import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { updateWorkOrderSchema, type UpdateWorkOrderInput } from '@/lib/validation/work-order';
import { getWorkOrder, updateWorkOrder } from '@/services/work-order.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = adminRoute<undefined, Params>({ capability: 'payout:view' }, async ({ admin, params }) => ok({ workOrder: await getWorkOrder(admin, params.id) }));

/** Answers `{ workOrder, warnings }`: an agreed amount below what is already paid or due is a warning, not a block. */
export const PATCH = adminRoute<UpdateWorkOrderInput, Params>(
  { capability: 'payout:record', schema: updateWorkOrderSchema },
  async ({ admin, body, params, meta }) => ok(await updateWorkOrder(admin, params.id, body, meta)),
);
