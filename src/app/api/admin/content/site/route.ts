import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { siteInfoSchema, type SiteInfoInput } from '@/lib/validation/content';
import { getSiteInfo, updateSiteInfo } from '@/services/site-info.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = adminRoute({ capability: 'content:edit' }, async ({ admin }) => ok({ site: await getSiteInfo(admin) }));

/** PUT replaces the company details. There is no draft, so saving is publish-level (`content:publish`). */
export const PUT = adminRoute<SiteInfoInput>({ capability: 'content:publish', schema: siteInfoSchema }, async ({ admin, body, meta }) =>
  ok({ site: await updateSiteInfo(admin, body, meta) }),
);
