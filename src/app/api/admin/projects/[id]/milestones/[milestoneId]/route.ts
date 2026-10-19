import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { updateMilestoneSchema, type UpdateMilestoneInput } from '@/lib/validation/project';
import { removeMilestone, updateMilestone } from '@/services/project.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { id: string; milestoneId: string };

export const PATCH = adminRoute<UpdateMilestoneInput, Params>(
  { capability: 'payment:record', schema: updateMilestoneSchema },
  async ({ admin, body, params, meta }) => ok({ project: await updateMilestone(admin, params.id, params.milestoneId, body, meta) }),
);

/** Only a pending milestone that no payment refers to can be removed. */
export const DELETE = adminRoute<undefined, Params>(
  { capability: 'payment:record' },
  async ({ admin, params, meta }) => ok({ project: await removeMilestone(admin, params.id, params.milestoneId, meta) }),
);
