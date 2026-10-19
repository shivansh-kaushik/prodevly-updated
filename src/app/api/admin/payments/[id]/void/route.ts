import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { voidPaymentSchema, type VoidPaymentBody } from '@/lib/validation/payment';
import { voidPayment } from '@/services/client-payment.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Voids an entry with a reason. It is never deleted: it stays listed with a Void tag and leaves every total. */
export const POST = adminRoute<VoidPaymentBody, { id: string }>(
  { capability: 'money:void', schema: voidPaymentSchema },
  async ({ admin, body, params, meta }) => ok({ payment: await voidPayment(admin, params.id, body, meta) }),
);
