import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { approveExpense } from '@/services/expense.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Approving an out-of-pocket expense means we now owe the admin. Superadmins only (money:approve). */
export const POST = adminRoute<undefined, { id: string }>(
  { capability: 'money:approve' },
  async ({ admin, params, meta }) => ok({ expense: await approveExpense(admin, params.id, meta) }),
);
