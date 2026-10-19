import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { unpublishContent, parseContentType } from '@/services/content.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/admin/content/<type>/<id>/unpublish : needs publish authority, checked here and again in the service. */
export const POST = adminRoute<undefined, { type: string; id: string }>({ capability: 'content:publish' }, async ({ admin, params, meta }) =>
  ok({ item: await unpublishContent(admin, parseContentType(params.type), params.id, meta) }),
);
