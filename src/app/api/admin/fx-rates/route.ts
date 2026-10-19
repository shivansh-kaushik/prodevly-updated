import { adminRoute } from '@/lib/api/admin-route';
import { created, ok } from '@/lib/api/response';
import { createFxRateSchema, type CreateFxRateInput } from '@/lib/validation/fx';
import { createFxRate, listFxRates } from '@/services/fx.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The rate table. Any signed-in admin may read it; empty query values count as "not set". */
export const GET = adminRoute({}, async ({ admin, request }) => {
  const query: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams) if (value !== '') query[key] = value;
  const { rows, meta } = await listFxRates(admin, query);
  return ok({ rates: rows, meta });
});

export const POST = adminRoute<CreateFxRateInput>(
  { capability: 'fx:edit', schema: createFxRateSchema },
  async ({ admin, body, meta }) => created({ rate: await createFxRate(admin, body, meta) }),
);
