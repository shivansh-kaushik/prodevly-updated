import type { ClientSession, Model, Types } from 'mongoose';
import type { ContentStatus } from '@/config/statuses';
import type { GateProblems } from '@/lib/content/gates';
import type { AnyContentDTO, ContentType } from '@/lib/content/types';
import type { ActorDoc } from '@/models';
import type { SessionUser } from '@/types/session';

/**
 * The shape the generic content engine (content.service.ts) works against. Each of the five
 * list types (showcase, partners, services, pricing, developers) supplies one `ContentKind`
 * that knows its own fields, links and publish rules; the engine owns everything they share:
 * capabilities, transactions, status moves, ordering, audit and cache invalidation.
 */
export interface ContentDocBase {
  _id: Types.ObjectId;
  status: ContentStatus;
  order: number;
  publishedAt?: Date;
  publishedBy?: ActorDoc;
  createdBy?: ActorDoc;
  updatedBy?: ActorDoc;
  createdAt: Date;
  updatedAt: Date;
}
/** A lean document of any content type. Kinds narrow it to their own fields where they read them. */
export type ContentDocLike = ContentDocBase & Record<string, unknown>;

export interface KindContext {
  viewer: SessionUser;
  session: ClientSession;
}

/** A field change: `set` values and `unset` paths. Dotted paths (`links.github`) are allowed. */
export interface FieldPatch {
  set: Record<string, unknown>;
  unset: string[];
}

export interface ContentKind {
  type: ContentType;
  /** The audit entity type (`showcase_item`) and the noun used in messages (`project`). */
  entity: string;
  actionPrefix: string;
  noun: string;
  model: Model<ContentDocLike>;
  hasSlug: boolean;
  /** Text paths the list search looks in. */
  searchPaths: readonly string[];
  /** Fields whose before and after are written to the audit log. */
  auditFields: readonly string[];
  titleOf(doc: ContentDocLike): string;
  /** A validated create input to the document to store (links and media are checked here). */
  buildNew(input: unknown, ctx: KindContext): Promise<Record<string, unknown>>;
  /** A validated patch to the fields to set and clear, checked against the existing record. */
  buildPatch(existing: ContentDocLike, patch: unknown, ctx: KindContext): Promise<FieldPatch>;
  /** The publish rules that need nothing but the record itself. */
  gate(doc: ContentDocLike): GateProblems;
  /** Publish rules that need other records (only one highlighted plan). */
  extraPublishChecks?(doc: ContentDocLike, ctx: KindContext): Promise<GateProblems>;
  toDTOs(docs: ContentDocLike[], viewer: SessionUser): Promise<AnyContentDTO[]>;
}
