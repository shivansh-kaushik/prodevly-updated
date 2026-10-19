import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { reorderSchema, type ReorderInput } from '@/lib/validation/task';
import { reorderTasks } from '@/services/task.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Set the order of one board column of one project. */
export const POST = adminRoute<ReorderInput>(
  { capability: 'task:edit', schema: reorderSchema },
  async ({ admin, body, meta }) => ok(await reorderTasks(admin, body, meta)),
);
