import { CONTENT_STATUSES, type ContentStatus } from '@/config/statuses';
import { actorSchema, type ActorDoc } from './shared.schema';

/**
 * Fields every public-website content record shares: draft/published/archived, a display order,
 * and who published it and when. Public reads select ONLY `published`.
 */
export interface ContentBase {
  status: ContentStatus;
  order: number;
  publishedAt?: Date;
  publishedBy?: ActorDoc;
  createdBy?: ActorDoc;
  updatedBy?: ActorDoc;
  createdAt: Date;
  updatedAt: Date;
}

export const contentBaseFields = {
  status: { type: String, enum: CONTENT_STATUSES, required: true, default: 'draft' },
  order: { type: Number, required: true, default: 0 },
  publishedAt: { type: Date },
  publishedBy: { type: actorSchema },
  createdBy: { type: actorSchema },
  updatedBy: { type: actorSchema },
} as const;
