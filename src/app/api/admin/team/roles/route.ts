import { adminRoute } from '@/lib/api/admin-route';
import { created, ok } from '@/lib/api/response';
import { teamRoleCreateSchema, type TeamRoleCreateInput } from '@/lib/validation/team';
import { createTeamRole, listTeamRoles } from '@/services/team-role.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = adminRoute({ capability: 'team:view' }, async ({ admin }) => ok({ roles: await listTeamRoles(admin) }));

export const POST = adminRoute<TeamRoleCreateInput>(
  { capability: 'settings:edit', schema: teamRoleCreateSchema },
  async ({ admin, body, meta }) => created({ role: await createTeamRole(admin, body, meta) }),
);
