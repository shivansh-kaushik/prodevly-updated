import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { markSpamSchema, type MarkSpamInput } from '@/lib/validation/lead';
import { markLeadSpam } from '@/services/lead.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Moves an enquiry to spam. It is kept, and can be moved back by changing its status. */
export const POST = adminRoute<MarkSpamInput, { id: string }>(
  { capability: 'lead:edit', schema: markSpamSchema },
  async ({ admin, body, params, meta }) => ok({ enquiry: await markLeadSpam(admin, params.id, body.note, meta) }),
);
