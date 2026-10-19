import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { updatePaymentSchema, type UpdatePaymentBody } from '@/lib/validation/payment';
import { getPayment, updatePayment } from '@/services/client-payment.service';
import { describeMedia } from '@/services/media.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { id: string };

/** One entry, with its attachments (only the files this viewer may open). */
export const GET = adminRoute<undefined, Params>({ capability: 'payment:view' }, async ({ admin, params }) => {
  const payment = await getPayment(admin, params.id);
  return ok({ payment, attachments: await describeMedia(admin, payment.attachmentMediaIds) });
});

/** Corrects an entry that is still received. Money fields recompute through the rate; every change is audited. */
export const PATCH = adminRoute<UpdatePaymentBody, Params>(
  { capability: 'payment:record', schema: updatePaymentSchema },
  async ({ admin, body, params, meta }) => ok({ payment: await updatePayment(admin, params.id, body, meta) }),
);
