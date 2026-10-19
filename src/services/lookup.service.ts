import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import type { Capability } from '@/config/capabilities';
import { escapeRegex } from '@/lib/admin/search-params';
import { notFound } from '@/lib/api/errors';
import { Admin, Client, Project, Task, ThirdParty } from '@/models';
import type { SessionUser } from '@/types/session';

/**
 * Typeahead data for the cascading pickers (client, then project, then task) and the people
 * pickers. Each kind needs the viewer's matching view capability. Archived records never appear.
 */
export const LOOKUP_KINDS = ['clients', 'projects', 'tasks', 'admins', 'third-parties'] as const;
export type LookupKind = (typeof LOOKUP_KINDS)[number];

const CAPABILITY: Record<LookupKind, Capability> = {
  clients: 'client:view',
  projects: 'project:view',
  tasks: 'task:view',
  admins: 'team:view',
  'third-parties': 'thirdParty:view',
};

export interface LookupItem {
  id: string;
  label: string;
  sublabel?: string;
  ref?: string;
}

export interface LookupParams {
  q?: string;
  /** Narrow projects to one client. */
  clientId?: string;
  /** Narrow tasks to one project. */
  projectId?: string;
  limit?: number;
}

const oid = (v?: string) => (v && /^[a-f\d]{24}$/i.test(v) ? new Types.ObjectId(v) : undefined);

export function isLookupKind(value: string): value is LookupKind {
  return (LOOKUP_KINDS as readonly string[]).includes(value);
}

export async function lookup(viewer: SessionUser, kind: string, params: LookupParams = {}): Promise<LookupItem[]> {
  if (!isLookupKind(kind)) throw notFound();
  assertCapability(viewer, CAPABILITY[kind]);
  await connectToDatabase();

  const limit = Math.min(Math.max(params.limit ?? 15, 1), 30);
  const q = params.q?.trim().slice(0, 80);
  const re = q ? new RegExp(escapeRegex(q.toLowerCase())) : undefined;
  const reI = q ? new RegExp(escapeRegex(q), 'i') : undefined;

  switch (kind) {
    case 'clients': {
      const rows = await Client.find({ archivedAt: null, ...(re ? { nameLower: re } : {}) })
        .select('name ref isInternal billingCurrency')
        .sort({ isInternal: -1, nameLower: 1 })
        .limit(limit)
        .lean();
      return rows.map((c) => ({ id: String(c._id), label: c.name, ref: c.ref, sublabel: c.billingCurrency ?? undefined }));
    }
    case 'projects': {
      const clientId = oid(params.clientId);
      const rows = await Project.find({
        archivedAt: null,
        ...(clientId ? { clientId } : {}),
        ...(reI ? { $or: [{ name: reI }, { ref: reI }, { clientName: reI }] } : {}),
      })
        .select('name ref clientName')
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean();
      return rows.map((p) => ({ id: String(p._id), label: p.name, ref: p.ref, sublabel: p.clientName }));
    }
    case 'tasks': {
      const projectId = oid(params.projectId);
      const rows = await Task.find({
        archivedAt: null,
        ...(projectId ? { projectId } : {}),
        ...(reI ? { $or: [{ title: reI }, { ref: reI }] } : {}),
      })
        .select('title ref status')
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean();
      return rows.map((t) => ({ id: String(t._id), label: t.title, ref: t.ref, sublabel: t.status.replaceAll('_', ' ') }));
    }
    case 'admins': {
      const rows = await Admin.find({
        status: 'active',
        ...(reI ? { $or: [{ name: reI }, { email: reI }] } : {}),
      })
        .select('name profile.designation')
        .sort({ name: 1 })
        .limit(limit)
        .lean();
      return rows.map((a) => ({ id: String(a._id), label: a.name, sublabel: a.profile?.designation ?? undefined }));
    }
    case 'third-parties': {
      const rows = await ThirdParty.find({ archivedAt: null, status: 'active', ...(re ? { nameLower: re } : {}) })
        .select('name ref type')
        .sort({ nameLower: 1 })
        .limit(limit)
        .lean();
      return rows.map((t) => ({ id: String(t._id), label: t.name, ref: t.ref, sublabel: t.type }));
    }
  }
}
