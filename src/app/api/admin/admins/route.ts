import { adminRoute } from '@/lib/api/admin-route';
import { created, ok } from '@/lib/api/response';
import { createAdminSchema, type CreateAdminInput } from '@/lib/validation/admin';
import { createAdmin, listAdmins } from '@/services/admin.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = adminRoute({ capability: 'admin:manage' }, async () => ok({ admins: await listAdmins() }));

export const POST = adminRoute<CreateAdminInput>(
  { capability: 'admin:manage', schema: createAdminSchema },
  async ({ admin, body, meta }) => created({ admin: await createAdmin(admin, body, meta) }),
);
