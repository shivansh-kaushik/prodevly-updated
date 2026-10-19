import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { archiveSchema, type ArchiveInput } from '@/lib/validation/project';
import { archiveProject } from '@/services/project.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Archive instead of delete. The project, its tasks, work and money stay; it leaves the default lists. */
export const POST = adminRoute<ArchiveInput, { id: string }>(
  { capability: 'project:archive', schema: archiveSchema },
  async ({ admin, body, params, meta }) => ok({ project: await archiveProject(admin, params.id, body.reason, meta) }),
);
