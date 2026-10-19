import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { archiveTeamRole } from '@/services/team-role.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = adminRoute<undefined, { id: string }>(
  { capability: 'settings:edit' },
  async ({ admin, params, meta }) => ok({ role: await archiveTeamRole(admin, params.id, meta) }),
);
