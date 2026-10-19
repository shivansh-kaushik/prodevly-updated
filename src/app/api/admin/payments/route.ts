import { adminRoute } from '@/lib/api/admin-route';
import { validationFailed } from '@/lib/api/errors';
import { created, ok } from '@/lib/api/response';
import { fieldErrors } from '@/lib/validation/common';
import { paymentListQuerySchema, recordPaymentSchema, type RecordPaymentBody } from '@/lib/validation/payment';
import { filterFromQuery, recordPayment, searchPayments } from '@/services/client-payment.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/payments?q=&clientId=&projectId=&status=&type=&mode=&currency=&from=&to=&sort=&dir=&page=&pageSize=
 * The ledger of money received from clients, with a summary of the entries that match (void entries are
 * listed but are in no total). Empty query values count as "not set".
 */
export const GET = adminRoute({ capability: 'payment:view' }, async ({ admin, request }) => {
  const query: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams) if (value !== '') query[key] = value;
  const parsed = paymentListQuerySchema.safeParse(query);
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const { sort, dir, page, pageSize } = parsed.data;
  const result = await searchPayments(admin, { ...filterFromQuery(parsed.data), sort, dir, page, pageSize });
  return ok({ payments: result.items, meta: result.meta, summary: result.summary });
});

/** Records money received from a client (or refunded to one). The body names a project, never an INR value. */
export const POST = adminRoute<RecordPaymentBody>(
  { capability: 'payment:record', schema: recordPaymentSchema },
  async ({ admin, body, meta }) => created({ payment: await recordPayment(admin, body, meta) }),
);
