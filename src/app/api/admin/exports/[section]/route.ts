import { NextResponse } from 'next/server';
import { adminRoute } from '@/lib/api/admin-route';
import { forbidden } from '@/lib/api/errors';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import type { RawSearchParams } from '@/lib/admin/search-params';
import { exportSection } from '@/services/export.service';
import { EXPORT_RATE_LIMIT } from '@/services/exports/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The list page's own query string as the services read it: the first value of each key. */
function rawParams(search: URLSearchParams): RawSearchParams {
  const out: RawSearchParams = {};
  for (const [key, value] of search) if (!(key in out)) out[key] = value;
  return out;
}

/**
 * A GET reaches this route with the session cookie on a cross-site navigation too (the cookie is SameSite=Lax), and adminRoute only
 * checks the origin of writes. An export is a read with a side effect (the audit entry, and a file saved to the person's machine), so a page
 * on another site must not be able to start one. The button's own request is same-origin; typing the URL is "none".
 */
function assertNotCrossSite(headers: Headers): void {
  const site = headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw forbidden('Cross-site requests are not allowed');
}

/**
 * GET /api/admin/exports/[section]?<the list page's filters>
 *
 * A CSV of every row the list page would show for those filters (up to the row cap), as a download. Needs export:data and an
 * open step-up; the section's own view capability is checked by the service. `X-Export-Truncated: true` says the cap cut it short.
 */
export const GET = adminRoute<undefined, { section: string }>(
  { capability: 'export:data', stepUp: true },
  async ({ admin, params, request, meta }) => {
    assertNotCrossSite(request.headers);
    await enforceRateLimit('admin:export', admin.id, EXPORT_RATE_LIMIT);
    const result = await exportSection(admin, params.section, rawParams(request.nextUrl.searchParams), meta);
    return new NextResponse(result.csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${result.filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Export-Rows': String(result.rows),
        'X-Export-Total': String(result.total),
        ...(result.truncated ? { 'X-Export-Truncated': 'true' } : {}),
      },
    });
  },
);
