import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { rejectExpenseSchema, type RejectExpenseInput } from '@/lib/validation/expense';
import { rejectExpense } from '@/services/expense.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Rejecting needs a reason. Superadmins only (money:approve). The expense stays on record, tagged Rejected, in no total. */
export const POST = adminRoute<RejectExpenseInput, { id: string }>(
  { capability: 'money:approve', schema: rejectExpenseSchema },
  async ({ admin, body, params, meta }) => ok({ expense: await rejectExpense(admin, params.id, body, meta) }),
);
