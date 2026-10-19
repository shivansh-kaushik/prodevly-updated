import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { archiveTask } from '@/services/task.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = adminRoute<undefined, { id: string }>({ capability: 'task:edit' }, async ({ admin, params, meta }) => ok({ task: await archiveTask(admin, params.id, meta) }));
