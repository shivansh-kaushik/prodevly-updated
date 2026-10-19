import { adminRoute } from '@/lib/api/admin-route';
import { created, ok } from '@/lib/api/response';
import { parseJsonBody } from '@/lib/content/body';
import { CONTENT_STATUSES } from '@/config/statuses';
import { createSchemas, type ContentInputMap } from '@/lib/validation/content';
import { createContent, listContent, parseContentType } from '@/services/content.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { type: string };

/** GET /api/admin/content/<type>?status=draft&q= : the list, in display order. */
export const GET = adminRoute<undefined, Params>({ capability: 'content:edit' }, async ({ admin, params, request }) => {
  const type = parseContentType(params.type);
  const sp = request.nextUrl.searchParams;
  const status = sp.get('status');
  const statuses = CONTENT_STATUSES.filter((s) => s === status);
  return ok({ items: await listContent(admin, type, { statuses, q: sp.get('q') ?? undefined }) });
});

/** POST /api/admin/content/<type> : a new DRAFT. Publishing is a separate, publish-level action. */
export const POST = adminRoute<undefined, Params>({ capability: 'content:edit' }, async ({ admin, params, request, meta }) => {
  const type = parseContentType(params.type);
  const input = await parseJsonBody(request, createSchemas[type]);
  return created({ item: await createContent(admin, type, input as ContentInputMap[typeof type]['create'], meta) });
});
