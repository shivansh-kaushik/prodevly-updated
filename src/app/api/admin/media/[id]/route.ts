import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { deleteMedia } from '@/services/media.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** DELETE /api/admin/media/<id> : only when no record references the file. The service checks who may. */
export const DELETE = adminRoute<undefined, { id: string }>({}, async ({ admin, params, meta }) => ok(await deleteMedia(admin, params.id, meta)));
