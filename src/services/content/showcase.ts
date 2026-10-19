import type { Model, Types } from 'mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { parseDateOnly } from '@/lib/dates/date-only';
import { mongoose } from '@/lib/db/mongoose';
import { showcaseGate } from '@/lib/content/gates';
import type { ShowcaseDTO } from '@/lib/content/types';
import type { CreateShowcaseInput, UpdateShowcaseInput } from '@/lib/validation/content';
import { Project, Service, ShowcaseItem } from '@/models';
import type { SessionUser } from '@/types/session';
import {
  assertProjectExists,
  assertPublicImages,
  assertServicesExist,
  baseDTO,
  blockersIfNotLive,
  compact,
  dayOf,
  loadMediaRefs,
  oid,
  put,
} from './helpers';
import type { ContentDocLike, ContentKind, FieldPatch, KindContext } from './types';

const doc = (d: ContentDocLike) => d as unknown as {
  _id: Types.ObjectId;
  title: string;
  slug: string;
  clientDisplayName?: string;
  projectId?: Types.ObjectId;
  summary: string;
  body?: { brief?: string; built?: string; result?: string };
  serviceIds?: Types.ObjectId[];
  stack?: string[];
  coverMediaId?: Types.ObjectId;
  galleryMediaIds?: Types.ObjectId[];
  liveUrl?: string;
  completedOn?: Date;
  clientApproved?: boolean;
};

const bodyOf = (b: CreateShowcaseInput['body']) => compact({ brief: b?.brief, built: b?.built, result: b?.result });

/** Setting an internal project link needs the right to see projects, so the link cannot probe for ids. */
function assertMayLinkProject(viewer: SessionUser) {
  assertCapability(viewer, 'project:view');
}

export const showcaseKind: ContentKind = {
  type: 'showcase',
  entity: 'showcase_item',
  actionPrefix: 'showcase',
  noun: 'project',
  model: ShowcaseItem as unknown as Model<ContentDocLike>,
  hasSlug: true,
  searchPaths: ['title', 'clientDisplayName', 'summary'],
  auditFields: [
    'title', 'slug', 'clientDisplayName', 'projectId', 'summary', 'body', 'serviceIds', 'stack',
    'coverMediaId', 'galleryMediaIds', 'liveUrl', 'completedOn', 'clientApproved',
  ],
  titleOf: (d) => doc(d).title,

  async buildNew(input, { viewer, session }: KindContext) {
    const v = input as CreateShowcaseInput;
    if (v.projectId) {
      assertMayLinkProject(viewer);
      await assertProjectExists(v.projectId, 'projectId', session);
    }
    await assertServicesExist(v.serviceIds ?? [], 'serviceIds', session);
    if (v.coverMediaId) await assertPublicImages([v.coverMediaId], 'coverMediaId', session);
    await assertPublicImages(v.galleryMediaIds ?? [], 'galleryMediaIds', session);
    return {
      ...compact({
        title: v.title,
        clientDisplayName: v.clientDisplayName,
        projectId: v.projectId ? oid(v.projectId) : undefined,
        summary: v.summary,
        coverMediaId: v.coverMediaId ? oid(v.coverMediaId) : undefined,
        liveUrl: v.liveUrl,
        completedOn: v.completedOn ? (parseDateOnly(v.completedOn) ?? undefined) : undefined,
      }),
      body: bodyOf(v.body),
      serviceIds: (v.serviceIds ?? []).map(oid),
      stack: v.stack ?? [],
      galleryMediaIds: (v.galleryMediaIds ?? []).map(oid),
      clientApproved: v.clientApproved ?? false,
    };
  },

  async buildPatch(existing, input, { viewer, session }: KindContext): Promise<FieldPatch> {
    const v = input as UpdateShowcaseInput;
    const before = doc(existing);
    const patch: FieldPatch = { set: {}, unset: [] };

    put(patch, 'title', v.title);
    put(patch, 'clientDisplayName', v.clientDisplayName);
    put(patch, 'summary', v.summary);
    put(patch, 'liveUrl', v.liveUrl);
    put(patch, 'clientApproved', v.clientApproved);
    put(patch, 'stack', v.stack);

    if (v.projectId !== undefined) {
      if (v.projectId !== null && v.projectId !== String(before.projectId ?? '')) {
        assertMayLinkProject(viewer);
        await assertProjectExists(v.projectId, 'projectId', session);
      }
      put(patch, 'projectId', v.projectId === null ? null : oid(v.projectId));
    }
    if (v.serviceIds !== undefined) {
      await assertServicesExist(v.serviceIds, 'serviceIds', session);
      put(patch, 'serviceIds', v.serviceIds.map(oid));
    }
    if (v.coverMediaId !== undefined) {
      if (v.coverMediaId) await assertPublicImages([v.coverMediaId], 'coverMediaId', session);
      put(patch, 'coverMediaId', v.coverMediaId ? oid(v.coverMediaId) : null);
    }
    if (v.galleryMediaIds !== undefined) {
      await assertPublicImages(v.galleryMediaIds, 'galleryMediaIds', session);
      put(patch, 'galleryMediaIds', v.galleryMediaIds.map(oid));
    }
    if (v.completedOn !== undefined) put(patch, 'completedOn', v.completedOn === null ? null : parseDateOnly(v.completedOn));
    if (v.body) {
      put(patch, 'body.brief', v.body.brief);
      put(patch, 'body.built', v.body.built);
      put(patch, 'body.result', v.body.result);
    }
    return patch;
  },

  gate: (d) => showcaseGate({ clientApproved: doc(d).clientApproved }),

  async toDTOs(docs, viewer): Promise<ShowcaseDTO[]> {
    const rows = docs.map(doc);
    const media = await loadMediaRefs(rows.flatMap((d) => [d.coverMediaId, ...(d.galleryMediaIds ?? [])]));
    const serviceIds = [...new Set(rows.flatMap((d) => (d.serviceIds ?? []).map(String)))];
    const services = serviceIds.length
      ? await Service.find({ _id: mongoose.trusted({ $in: serviceIds.map(oid) }) }).select('title').lean()
      : [];
    const serviceTitle = new Map(services.map((s) => [String(s._id), s.title]));

    // A project's name is internal: only people who may see projects get it.
    const maySeeProjects = viewer.capabilities.has('project:view');
    const projectIds = maySeeProjects ? [...new Set(rows.flatMap((d) => (d.projectId ? [String(d.projectId)] : [])))] : [];
    const projects = projectIds.length ? await Project.find({ _id: mongoose.trusted({ $in: projectIds.map(oid) }) }).select('name ref').lean() : [];
    const projectLabel = new Map(projects.map((p) => [String(p._id), `${p.ref} ${p.name}`]));

    return docs.map((raw, i) => {
      const d = rows[i] as ReturnType<typeof doc>;
      return {
        ...baseDTO('showcase', raw, { title: d.title, slug: d.slug, blockers: blockersIfNotLive(raw, showcaseKind.gate(raw)) }),
        type: 'showcase' as const,
        clientDisplayName: d.clientDisplayName ?? null,
        projectId: d.projectId ? String(d.projectId) : null,
        projectLabel: d.projectId ? (projectLabel.get(String(d.projectId)) ?? null) : null,
        summary: d.summary,
        body: { brief: d.body?.brief ?? null, built: d.body?.built ?? null, result: d.body?.result ?? null },
        serviceIds: (d.serviceIds ?? []).map(String),
        services: (d.serviceIds ?? []).flatMap((id) => {
          const title = serviceTitle.get(String(id));
          return title === undefined ? [] : [{ id: String(id), title }];
        }),
        stack: d.stack ?? [],
        coverMedia: d.coverMediaId ? (media.get(String(d.coverMediaId)) ?? null) : null,
        galleryMedia: (d.galleryMediaIds ?? []).flatMap((id) => {
          const ref = media.get(String(id));
          return ref ? [ref] : [];
        }),
        liveUrl: d.liveUrl ?? null,
        completedOn: dayOf(d.completedOn),
        clientApproved: Boolean(d.clientApproved),
      };
    });
  },
};
