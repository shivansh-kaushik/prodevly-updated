import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { updateWorkLogSchema, type UpdateWorkLogInput } from '@/lib/validation/work-log';
import { deleteWorkLog, updateWorkLog } from '@/services/work-log.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { id: string };

/** Own entries within the edit window; any entry for a superadmin; never one a paid payout covers (ENTRY_LOCKED). */
export const PATCH = adminRoute<UpdateWorkLogInput, Params>(
  { capability: 'worklog:own', schema: updateWorkLogSchema },
  async ({ admin, body, params, meta }) => ok({ workLog: await updateWorkLog(admin, params.id, body, meta) }),
);

export const DELETE = adminRoute<undefined, Params>({ capability: 'worklog:own' }, async ({ admin, params, meta }) => ok(await deleteWorkLog(admin, params.id, meta)));
