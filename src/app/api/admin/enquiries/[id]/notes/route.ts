import { adminRoute } from '@/lib/api/admin-route';
import { created } from '@/lib/api/response';
import { addLeadNoteSchema, type AddLeadNoteInput } from '@/lib/validation/lead';
import { addLeadNote } from '@/services/lead.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Append a note. Notes are append-only: there is no route to edit or remove one. */
export const POST = adminRoute<AddLeadNoteInput, { id: string }>(
  { capability: 'lead:edit', schema: addLeadNoteSchema },
  async ({ admin, body, params, meta }) => created({ enquiry: await addLeadNote(admin, params.id, body.text, meta) }),
);
