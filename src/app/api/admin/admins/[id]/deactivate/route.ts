import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { deactivateSchema } from '@/lib/validation/admin';
import { deactivateAdmin } from '@/services/admin.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** "Delete" an admin. Deactivates (the account, work and audit trail stay) and ends all their sessions. */
export const POST = adminRoute<{ reason: string }, { id: string }>(
  { capability: 'admin:manage', schema: deactivateSchema },
  async ({ admin, body, params, meta }) => ok({ admin: await deactivateAdmin(admin, params.id, body.reason, meta) }),
);
