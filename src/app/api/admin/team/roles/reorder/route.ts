import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { teamRoleReorderSchema, type TeamRoleReorderInput } from '@/lib/validation/team';
import { reorderTeamRoles } from '@/services/team-role.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Body: `{ ids }`, exactly the active roles in their new order. */
export const POST = adminRoute<TeamRoleReorderInput>(
  { capability: 'settings:edit', schema: teamRoleReorderSchema },
  async ({ admin, body, meta }) => ok({ roles: await reorderTeamRoles(admin, body.ids, meta) }),
);
