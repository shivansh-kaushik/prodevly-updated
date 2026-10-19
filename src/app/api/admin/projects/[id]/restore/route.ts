import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { archiveSchema, type ArchiveInput } from '@/lib/validation/project';
import { restoreProject } from '@/services/project.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = adminRoute<ArchiveInput, { id: string }>(
  { capability: 'project:archive', schema: archiveSchema },
  async ({ admin, body, params, meta }) => ok({ project: await restoreProject(admin, params.id, body.reason, meta) }),
);
