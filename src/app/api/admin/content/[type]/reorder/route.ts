import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { reorderSchema, type ReorderInput } from '@/lib/validation/content';
import { parseContentType, reorderContent } from '@/services/content.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/admin/content/<type>/reorder { ids } : the new display order of those records. */
export const POST = adminRoute<ReorderInput, { type: string }>({ capability: 'content:edit', schema: reorderSchema }, async ({ admin, params, body, meta }) =>
  ok(await reorderContent(admin, parseContentType(params.type), body.ids, meta)),
);
