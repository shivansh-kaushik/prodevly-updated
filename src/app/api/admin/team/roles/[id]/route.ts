import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { teamRoleUpdateSchema, type TeamRoleUpdateInput } from '@/lib/validation/team';
import { deleteTeamRole, updateTeamRole } from '@/services/team-role.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { id: string };

export const PATCH = adminRoute<TeamRoleUpdateInput, Params>(
  { capability: 'settings:edit', schema: teamRoleUpdateSchema },
  async ({ admin, body, params, meta }) => ok({ role: await updateTeamRole(admin, params.id, body, meta) }),
);

/** Permanent delete, only for a role nobody holds (otherwise HAS_LINKED_RECORDS: archive it). */
export const DELETE = adminRoute<undefined, Params>(
  { capability: 'settings:edit' },
  async ({ admin, params, meta }) => ok(await deleteTeamRole(admin, params.id, meta)),
);
