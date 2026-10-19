import { adminRoute } from '@/lib/api/admin-route';
import { created, ok } from '@/lib/api/response';
import { convertLeadSchema, type ConvertLeadInput } from '@/lib/validation/lead-conversion';
import { convertLead } from '@/services/lead-conversion.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Turns an enquiry into a client (new, or an existing one) and optionally a draft project, in one
 * transaction. The route needs lead:edit; the service also needs client:edit, and project:edit when
 * a project is asked for. 201 when something was created, 200 when an existing client was just linked.
 */
export const POST = adminRoute<ConvertLeadInput, { id: string }>(
  { capability: 'lead:edit', schema: convertLeadSchema },
  async ({ admin, body, params, meta }) => {
    const result = await convertLead(admin, params.id, body, meta);
    return result.client.created || result.project ? created({ conversion: result }) : ok({ conversion: result });
  },
);
