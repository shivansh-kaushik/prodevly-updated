import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { updateTaskSchema, type UpdateTaskInput } from '@/lib/validation/task';
import { deleteTask, getTask, updateTask } from '@/services/task.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = adminRoute<undefined, Params>({ capability: 'task:view' }, async ({ admin, params }) => ok({ task: await getTask(admin, params.id) }));

export const PATCH = adminRoute<UpdateTaskInput, Params>(
  { capability: 'task:edit', schema: updateTaskSchema },
  async ({ admin, body, params, meta }) => ok({ task: await updateTask(admin, params.id, body, meta) }),
);

/** Permanent delete: superadmins only, and only when no work log or money record links to the task. */
export const DELETE = adminRoute<undefined, Params>({ capability: 'task:delete' }, async ({ admin, params, meta }) => ok(await deleteTask(admin, params.id, meta)));
