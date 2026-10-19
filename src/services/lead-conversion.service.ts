import { withTransaction } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { AppError, conflict, notFound, validationFailed } from '@/lib/api/errors';
import { createClientSchema } from '@/lib/validation/client';
import { fieldErrors, parseObjectId } from '@/lib/validation/common';
import { buildClientInput, buildProjectInput, type ConvertLeadInput } from '@/lib/validation/lead-conversion';
import { createProjectSchema } from '@/lib/validation/project';
import { Client, Lead } from '@/models';
import type { SessionUser } from '@/types/session';
import type { ServiceMeta } from './admin.service';
import { createClientInTx } from './client.service';
import { applyLeadConversion } from './lead.service';
import { createProjectInTx } from './project.service';

/**
 * Enquiry conversion (plan sections 2 and 8): an enquiry becomes a client, optionally with a draft
 * project, and moves to "won".
 *
 * Who may do it: lead:edit AND client:edit, plus project:edit when a project is asked for. Each
 * piece checks its own capability again, so no path writes without it.
 *
 * It is ONE transaction. The client (and its CL- reference), the project (and its PRJ- reference),
 * the enquiry's move to won and its links either all commit or none do: a failure at any step
 * leaves no client behind and the reference counters as they were. The records keep their own
 * audit entries (client.create, project.create); the conversion adds one `lead.convert` entry whose
 * summary names the client and project it made or linked.
 */

export interface ConversionResult {
  client: { id: string; ref: string; name: string; /** False when an existing client was linked. */ created: boolean };
  project: { id: string; ref: string; name: string } | null;
}

/**
 * The create services answer field errors under their own names ("name", "billingCurrency"). The
 * conversion form calls them "client.name" and "project.type", so the messages land on the right inputs.
 */
async function under<T>(prefix: 'client' | 'project', run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AppError && error.fields) {
      const fields = Object.fromEntries(Object.entries(error.fields).map(([key, message]) => [`${prefix}.${key}`, message]));
      throw new AppError(error.code, error.message, error.status, { fields });
    }
    throw error;
  }
}

const prefixed = (prefix: 'client' | 'project', fields: Record<string, string>) =>
  Object.fromEntries(Object.entries(fields).map(([key, message]) => [`${prefix}.${key}`, message]));

export async function convertLead(viewer: SessionUser, rawLeadId: string, input: ConvertLeadInput, meta: ServiceMeta = {}): Promise<ConversionResult> {
  // Everything that needs no data is checked before a transaction opens.
  assertCapability(viewer, 'lead:edit');
  assertCapability(viewer, 'client:edit');
  if (input.project) assertCapability(viewer, 'project:edit');
  const leadId = parseObjectId(rawLeadId);
  const pickedClientId = input.mode === 'existing' ? parseObjectId(input.clientId) : undefined;

  return withTransaction(async (session) => {
    const lead = await Lead.findById(leadId).session(session).lean();
    if (!lead) throw notFound('We could not find that enquiry');
    if (lead.status === 'spam') throw conflict('Spam cannot be converted. Restore it first.');
    if (lead.convertedClientId) throw conflict('That enquiry has already been converted');

    // 1. The client: made now, or one already on the books.
    let client: ConversionResult['client'];
    if (pickedClientId) {
      const existing = await Client.findById(pickedClientId).select('name ref isInternal archivedAt').session(session).lean();
      if (!existing) throw validationFailed({ clientId: 'Pick a client that exists' });
      if (existing.archivedAt) throw validationFailed({ clientId: 'That client is archived. Restore it first, or pick another.' });
      if (existing.isInternal) throw validationFailed({ clientId: 'The internal client is for our own projects. Pick the client this enquiry came from.' });
      // A concurrent archive writes this document; touching it makes the two transactions conflict
      // (one retries and sees the archive) instead of both committing and leaving a won enquiry on an archived client.
      await Client.updateOne({ _id: existing._id }, { $currentDate: { updatedAt: true } }, { session, timestamps: false });
      client = { id: String(existing._id), ref: existing.ref, name: existing.name, created: false };
    } else {
      const parsed = createClientSchema.safeParse(buildClientInput(lead, input.mode === 'new' ? input.client : undefined));
      if (!parsed.success) throw validationFailed(prefixed('client', fieldErrors(parsed.error)));
      const made = await under('client', () => createClientInTx(viewer, parsed.data, session, meta, { leadId }));
      client = { id: made.id, ref: made.ref, name: made.name, created: true };
    }

    // 2. The draft project, always a proposal.
    let project: ConversionResult['project'] = null;
    if (input.project) {
      const parsed = createProjectSchema.safeParse(buildProjectInput(lead, client.id, input.project));
      if (!parsed.success) throw validationFailed(prefixed('project', fieldErrors(parsed.error)));
      const made = await under('project', () => createProjectInTx(viewer, parsed.data, session, meta, { summary: `Draft started from enquiry ${lead.ref}` }));
      project = { id: made.id, ref: made.ref, name: made.name };
    }

    // 3. The enquiry moves to won and links to both, with the one conversion audit entry.
    const said = [
      client.created ? `Created client ${client.ref} (${client.name})` : `Linked to existing client ${client.ref} (${client.name})`,
      project ? `started draft project ${project.ref} (${project.name})` : null,
    ].filter(Boolean);
    const summary = said.join(', ').slice(0, 500);
    await applyLeadConversion(viewer, leadId, { clientId: client.id, projectId: project?.id, summary }, session, meta);

    return { client, project };
  });
}
