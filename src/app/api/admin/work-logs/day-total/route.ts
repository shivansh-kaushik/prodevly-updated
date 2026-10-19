import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { validationFailed } from '@/lib/api/errors';
import { dayTotalQuerySchema } from '@/lib/validation/work-log';
import { getDayTotal } from '@/services/work-log.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/work-logs/day-total?date=YYYY-MM-DD: the caller's own logged minutes for a day, for the 12 hour warning. */
export const GET = adminRoute({ capability: 'worklog:own' }, async ({ admin, request }) => {
  const parsed = dayTotalQuerySchema.safeParse({ date: request.nextUrl.searchParams.get('date') ?? '' });
  if (!parsed.success) throw validationFailed({ date: 'Enter a valid date' });
  return ok(await getDayTotal(admin, parsed.data.date));
});
