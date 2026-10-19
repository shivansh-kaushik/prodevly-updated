import { adminRoute } from '@/lib/api/admin-route';
import { created, ok } from '@/lib/api/response';
import { first, parseListParams } from '@/lib/admin/search-params';
import { createTaskSchema, parseTaskFilter, TASK_SORT_KEYS, type CreateTaskBody } from '@/lib/validation/task';
import { createTask, searchTasks, type TaskSort } from '@/services/task.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/tasks?q=&status=&priority=&projectId=&clientId=&assignee=&overdue=1&archived=1&sort=&dir=&page= */
export const GET = adminRoute({ capability: 'task:view' }, async ({ admin, request }) => {
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const list = parseListParams(sp, { sortable: TASK_SORT_KEYS, defaultSort: 'updatedAt', pageSize: Number(first(sp, 'pageSize')) || 25 });
  const page = await searchTasks(admin, { ...parseTaskFilter(sp, { viewerId: admin.id }), sort: list.sort as TaskSort, dir: list.dir, page: list.page, pageSize: list.pageSize });
  return ok(page);
});

export const POST = adminRoute<CreateTaskBody>(
  { capability: 'task:edit', schema: createTaskSchema },
  async ({ admin, body, meta }) => created({ task: await createTask(admin, body, meta) }),
);
