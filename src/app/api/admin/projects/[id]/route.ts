import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { updateProjectSchema, type UpdateProjectInput } from '@/lib/validation/project';
import { updateProject } from '@/services/project.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Contract and cost-budget fields in the body additionally need payment:record: the service checks. */
export const PATCH = adminRoute<UpdateProjectInput, { id: string }>(
  { capability: 'project:edit', schema: updateProjectSchema },
  async ({ admin, body, params, meta }) => ok({ project: await updateProject(admin, params.id, body, meta) }),
);
