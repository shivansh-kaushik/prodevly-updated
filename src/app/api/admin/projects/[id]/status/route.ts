import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { statusChangeSchema, type StatusChangeInput } from '@/lib/validation/project';
import { changeProjectStatus } from '@/services/project.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Moves the project along the transition table. On hold, cancelled and any reopen need a note; reopening closed or cancelled is superadmin-only. */
export const POST = adminRoute<StatusChangeInput, { id: string }>(
  { capability: 'project:edit', schema: statusChangeSchema },
  async ({ admin, body, params, meta }) => ok({ project: await changeProjectStatus(admin, params.id, body, meta) }),
);
