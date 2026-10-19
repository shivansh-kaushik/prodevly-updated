import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { updateAdminSchema, type UpdateAdminInput } from '@/lib/validation/admin';
import { getAdminById, listOpenTasksFor, updateAdmin } from '@/services/admin.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = adminRoute<undefined, Params>({ capability: 'admin:manage' }, async ({ params }) =>
  ok({ admin: await getAdminById(params.id), openTasks: await listOpenTasksFor(params.id) }),
);

export const PATCH = adminRoute<UpdateAdminInput, Params>(
  { capability: 'admin:manage', schema: updateAdminSchema },
  async ({ admin, body, params, meta }) => ok({ admin: await updateAdmin(admin, params.id, body, meta) }),
);
