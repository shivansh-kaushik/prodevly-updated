import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { ownProfileSchema, type OwnProfileInput } from '@/lib/validation/team';
import { getOwnProfile, updateOwnProfile } from '@/services/team.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Any signed-in admin, and only about themself: there is no id in this path to point at someone else. */
export const GET = adminRoute({}, async ({ admin }) => ok({ profile: await getOwnProfile(admin) }));

export const PATCH = adminRoute<OwnProfileInput>(
  { schema: ownProfileSchema },
  async ({ admin, body, meta }) => ok({ profile: await updateOwnProfile(admin, body, meta) }),
);
