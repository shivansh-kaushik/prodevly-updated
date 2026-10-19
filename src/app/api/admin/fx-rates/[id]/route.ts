import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { updateFxRateSchema, type UpdateFxRateInput } from '@/lib/validation/fx';
import { updateFxRate } from '@/services/fx.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = adminRoute<UpdateFxRateInput, { id: string }>(
  { capability: 'fx:edit', schema: updateFxRateSchema },
  async ({ admin, body, params, meta }) => ok({ rate: await updateFxRate(admin, params.id, body, meta) }),
);
