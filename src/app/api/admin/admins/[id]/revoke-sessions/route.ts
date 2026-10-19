import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { revokeSessions } from '@/services/admin.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = adminRoute<undefined, { id: string }>(
  { capability: 'admin:manage' },
  async ({ admin, params, meta }) => ok({ admin: await revokeSessions(admin, params.id, meta) }),
);
