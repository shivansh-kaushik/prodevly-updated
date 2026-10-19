import { adminRoute } from '@/lib/api/admin-route';
import { validationFailed } from '@/lib/api/errors';
import { ok } from '@/lib/api/response';
import { parseDateOnly } from '@/lib/dates/date-only';
import { fieldErrors } from '@/lib/validation/common';
import { fxLookupQuerySchema } from '@/lib/validation/fx';
import { lookupFx } from '@/services/fx.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/fx-rates/lookup?currency=USD&date=2026-10-12&amount=100000
 * The rate a money form would be given for a currency and day, and what the amount comes to in INR.
 * Any signed-in admin: it reads only the rate table. `amount` is integer minor units.
 */
export const GET = adminRoute({}, async ({ admin, request }) => {
  const sp = request.nextUrl.searchParams;
  const parsed = fxLookupQuerySchema.safeParse({
    currency: sp.get('currency') ?? undefined,
    date: sp.get('date') ?? undefined,
    amount: sp.get('amount') || undefined,
  });
  if (!parsed.success) throw validationFailed(fieldErrors(parsed.error));
  const date = parseDateOnly(parsed.data.date);
  if (!date) throw validationFailed({ date: 'Enter a real date' });
  const amount = parsed.data.amount === undefined ? undefined : Number(parsed.data.amount);
  const result = await lookupFx(admin, {
    currency: parsed.data.currency,
    date,
    amountMinor: amount !== undefined && Number.isSafeInteger(amount) ? amount : undefined,
  });
  return ok(result);
});
