import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { changeStatusSchema, type ChangeStatusInput } from '@/lib/validation/task';
import { changeTaskStatus } from '@/services/task.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Move a task to another status. Reopening a done or cancelled task, and cancelling, need a `note`. */
export const POST = adminRoute<ChangeStatusInput, { id: string }>(
  { capability: 'task:edit', schema: changeStatusSchema },
  async ({ admin, body, params, meta }) => ok({ task: await changeTaskStatus(admin, params.id, body, meta) }),
);
