import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { updateSettingsSchema, type UpdateSettingsInput } from '@/lib/validation/settings';
import { readSettings, updateSettings } from '@/services/settings.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Organisation settings. Superadmins only (`settings:edit`): the screens everyone else uses read them through the service. */
export const GET = adminRoute({ capability: 'settings:edit' }, async ({ admin }) => ok({ settings: await readSettings(admin) }));

export const PATCH = adminRoute<UpdateSettingsInput>(
  { capability: 'settings:edit', schema: updateSettingsSchema },
  async ({ admin, body, meta }) => ok({ settings: await updateSettings(admin, body, meta) }),
);
