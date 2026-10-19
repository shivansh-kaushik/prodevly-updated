import { adminRoute } from '@/lib/api/admin-route';
import { created } from '@/lib/api/response';
import { createProjectSchema, type CreateProjectInput } from '@/lib/validation/project';
import { createProject } from '@/services/project.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reads happen in Server Components; this is the one way to create a project from the browser. */
export const POST = adminRoute<CreateProjectInput>(
  { capability: 'project:edit', schema: createProjectSchema },
  async ({ admin, body, meta }) => created({ project: await createProject(admin, body, meta) }),
);
