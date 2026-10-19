import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { voidExpenseSchema, type VoidExpenseInput } from '@/lib/validation/expense';
import { voidExpense } from '@/services/expense.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Voids with a reason. money:void, or a submitter withdrawing their OWN expense while it is still submitted: that either-or
 * rule depends on the expense, so the service enforces it rather than a route-level capability.
 */
export const POST = adminRoute<VoidExpenseInput, { id: string }>(
  { schema: voidExpenseSchema },
  async ({ admin, body, params, meta }) => ok({ expense: await voidExpense(admin, params.id, body, meta) }),
);
