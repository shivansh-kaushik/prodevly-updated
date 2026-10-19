import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { reactivateSchema } from '@/lib/validation/admin';
import { reactivateAdmin } from '@/services/admin.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = adminRoute<{ newPassword: string }, { id: string }>(
  { capability: 'admin:manage', schema: reactivateSchema, stepUp: true },
  async ({ admin, body, params, meta }) => ok({ admin: await reactivateAdmin(admin, params.id, body.newPassword, meta) }),
);
