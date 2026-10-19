import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { parseJsonBody } from '@/lib/content/body';
import { updateSchemas, type ContentInputMap } from '@/lib/validation/content';
import { getContent, parseContentType, updateContent } from '@/services/content.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { type: string; id: string };

export const GET = adminRoute<undefined, Params>({ capability: 'content:edit' }, async ({ admin, params }) =>
  ok({ item: await getContent(admin, parseContentType(params.type), params.id) }),
);

/** PATCH: edit fields. A record that is already published needs publish authority (the service decides). */
export const PATCH = adminRoute<undefined, Params>({ capability: 'content:edit' }, async ({ admin, params, request, meta }) => {
  const type = parseContentType(params.type);
  const patch = await parseJsonBody(request, updateSchemas[type]);
  return ok({ item: await updateContent(admin, type, params.id, patch as ContentInputMap[typeof type]['update'], meta) });
});
