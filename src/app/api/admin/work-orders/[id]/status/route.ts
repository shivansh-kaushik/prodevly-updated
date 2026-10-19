import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { workOrderStatusSchema, type WorkOrderStatusInput } from '@/lib/validation/work-order';
import { changeWorkOrderStatus } from '@/services/work-order.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Move a work order along. Cancelling and reopening need a `note`; a cancel is refused while paid or due payouts refer to it. */
export const POST = adminRoute<WorkOrderStatusInput, { id: string }>(
  { capability: 'payout:record', schema: workOrderStatusSchema },
  async ({ admin, body, params, meta }) => ok({ workOrder: await changeWorkOrderStatus(admin, params.id, body, meta) }),
);
