import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { resetPasswordSchema } from '@/lib/validation/admin';
import { resetPassword } from '@/services/admin.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = adminRoute<{ newPassword: string }, { id: string }>(
  { capability: 'admin:manage', schema: resetPasswordSchema, stepUp: true },
  async ({ admin, body, params, meta }) => ok({ admin: await resetPassword(admin, params.id, body.newPassword, meta) }),
);
