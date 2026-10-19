import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { markPaidSchema, type MarkPaidInput } from '@/lib/validation/expense';
import { markExpensePaid } from '@/services/expense.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Records the reimbursement of an approved expense: the date, the mode and the bank reference. Superadmins only (money:approve). */
export const POST = adminRoute<MarkPaidInput, { id: string }>(
  { capability: 'money:approve', schema: markPaidSchema },
  async ({ admin, body, params, meta }) => ok({ expense: await markExpensePaid(admin, params.id, body, meta) }),
);
