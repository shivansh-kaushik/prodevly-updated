import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { updateThirdPartySchema, type UpdateThirdPartyInput } from '@/lib/validation/third-party';
import { getThirdParty, updateThirdParty } from '@/services/third-party.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { id: string };

/** The payment note is part of the answer only for a viewer who holds `thirdParty:payDetails`. */
export const GET = adminRoute<undefined, Params>({ capability: 'thirdParty:view' }, async ({ admin, params }) => ok({ thirdParty: await getThirdParty(admin, params.id) }));

export const PATCH = adminRoute<UpdateThirdPartyInput, Params>(
  { capability: 'thirdParty:edit', schema: updateThirdPartySchema },
  async ({ admin, body, params, meta }) => ok({ thirdParty: await updateThirdParty(admin, params.id, body, meta) }),
);
