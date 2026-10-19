import { adminRoute } from '@/lib/api/admin-route';
import { created, ok } from '@/lib/api/response';
import { first } from '@/lib/admin/search-params';
import { createWorkLogSchema, parseWorkLogFilter, type CreateWorkLogInput } from '@/lib/validation/work-log';
import { createWorkLog, listWorkLogs } from '@/services/work-log.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/work-logs?adminId=&projectId=&clientId=&taskId=&from=&to=&billable=yes|no&page=
 * Everyone's logs with `worklog:viewAll`; otherwise only the caller's own (the service decides).
 */
export const GET = adminRoute({}, async ({ admin, request }) => {
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const page = Math.max(Number(first(sp, 'page')) || 1, 1);
  return ok(await listWorkLogs(admin, { ...parseWorkLogFilter(sp), page, pageSize: Number(first(sp, 'pageSize')) || 25 }));
});

export const POST = adminRoute<CreateWorkLogInput>(
  { capability: 'worklog:own', schema: createWorkLogSchema },
  async ({ admin, body, meta }) => created({ workLog: await createWorkLog(admin, body, meta) }),
);
