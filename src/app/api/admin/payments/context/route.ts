import { adminRoute } from '@/lib/api/admin-route';
import { validationFailed } from '@/lib/api/errors';
import { ok } from '@/lib/api/response';
import { objectIdSchema } from '@/lib/validation/common';
import { getPaymentContext } from '@/services/client-payment.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/payments/context?projectId=
 * What the payment form needs to know about a project: its contract currency, what is billable and
 * received, and its milestones with what each has received. Needs payment:record.
 */
export const GET = adminRoute({ capability: 'payment:record' }, async ({ admin, request }) => {
  const projectId = objectIdSchema.safeParse(request.nextUrl.searchParams.get('projectId') ?? '');
  if (!projectId.success) throw validationFailed({ projectId: 'Pick a project' });
  return ok({ context: await getPaymentContext(admin, projectId.data) });
});
