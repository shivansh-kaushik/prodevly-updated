import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { payProfileSchema, type PayProfileInput } from '@/lib/validation/team';
import { getPayProfile, putPayProfile } from '@/services/pay-profile.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { adminId: string };

/**
 * No route-level capability: a person reads their OWN basis and rate, `team:payView` reads anyone's.
 * "Own or capability" cannot be expressed as one capability, so the service decides (and answers 403).
 */
export const GET = adminRoute<undefined, Params>({}, async ({ admin, params }) =>
  ok({ payProfile: await getPayProfile(admin, params.adminId) }),
);

/** Needs `team:payView` and a recent step-up, and is refused on your own profile. */
export const PUT = adminRoute<PayProfileInput, Params>(
  { capability: 'team:payView', schema: payProfileSchema, stepUp: true },
  async ({ admin, body, params, meta }) => ok({ payProfile: await putPayProfile(admin, params.adminId, body, meta) }),
);
