import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { setAssigneesSchema, type SetAssigneesInput } from '@/lib/validation/task';
import { setAssignees } from '@/services/task.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Replace who is on the task (admins and third parties). Names are read from the records, never from the request. */
export const PUT = adminRoute<SetAssigneesInput, { id: string }>(
  { capability: 'task:edit', schema: setAssigneesSchema },
  async ({ admin, body, params, meta }) => ok({ task: await setAssignees(admin, params.id, body, meta) }),
);
