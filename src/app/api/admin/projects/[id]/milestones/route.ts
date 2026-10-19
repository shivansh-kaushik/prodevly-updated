import { adminRoute } from '@/lib/api/admin-route';
import { created } from '@/lib/api/response';
import { createMilestoneSchema, type CreateMilestoneInput } from '@/lib/validation/project';
import { addMilestone } from '@/services/project.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Billing milestones are money: payment:record (and project:edit, checked by the service). */
export const POST = adminRoute<CreateMilestoneInput, { id: string }>(
  { capability: 'payment:record', schema: createMilestoneSchema },
  async ({ admin, body, params, meta }) => created({ project: await addMilestone(admin, params.id, body, meta) }),
);
