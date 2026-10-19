import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { updateExpenseSchema, type UpdateExpenseInput } from '@/lib/validation/expense';
import { getExpense, updateExpense } from '@/services/expense.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { id: string };

/** Someone else's expense is a 404 to a plain admin; the service decides (see expense.service.ts). */
export const GET = adminRoute<undefined, Params>({}, async ({ admin, params }) => ok({ expense: await getExpense(admin, params.id) }));

/** Status never moves here: it has its own routes (approve, reject, mark-paid, void) so history and rules cannot be skipped. */
export const PATCH = adminRoute<UpdateExpenseInput, Params>(
  { schema: updateExpenseSchema },
  async ({ admin, body, params, meta }) => ok({ expense: await updateExpense(admin, params.id, body, meta) }),
);
