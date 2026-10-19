import { adminRoute } from '@/lib/api/admin-route';
import { ok } from '@/lib/api/response';
import { deleteLeadSchema, updateLeadSchema, type DeleteLeadInput, type UpdateLeadInput } from '@/lib/validation/lead';
import { deleteLead, updateLead } from '@/services/lead.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { id: string };

/** Status, assignee and follow-up date. Any admin who may edit enquiries. */
export const PATCH = adminRoute<UpdateLeadInput, Params>(
  { capability: 'lead:edit', schema: updateLeadSchema },
  async ({ admin, body, params, meta }) => ok({ enquiry: await updateLead(admin, params.id, body, meta) }),
);

/** Permanent delete: superadmins only (`lead:delete` is never grantable). Needs a reason for the audit log. */
export const DELETE = adminRoute<DeleteLeadInput, Params>(
  { capability: 'lead:delete', schema: deleteLeadSchema },
  async ({ admin, body, params, meta }) => {
    await deleteLead(admin, params.id, body.reason, meta);
    return ok({ deleted: true });
  },
);
