import { Schema, model, models, type Model, type Types } from 'mongoose';
import { MEDIA_VISIBILITIES } from '@/config/statuses';
import { actorSchema, text, type ActorDoc } from './shared.schema';

/** What a PRIVATE file was uploaded for. It decides which money capability may read it. */
export const MEDIA_PRIVATE_PURPOSES = ['payment', 'payout', 'expense'] as const;

/** An uploaded file. The bytes live in GridFS (`fileId`); this document describes them. */
export interface MediaDoc {
  _id: Types.ObjectId;
  storage: 'gridfs';
  fileId: Types.ObjectId;
  filename: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  /** Detects a duplicate upload. */
  sha256: string;
  /** `public` is served to the website; `private` (receipts) only to admins with the matching money capability. */
  visibility: (typeof MEDIA_VISIBILITIES)[number];
  alt?: string;
  /** Private files only: payment, payout or expense. Public website images have none. */
  purpose?: (typeof MEDIA_PRIVATE_PURPOSES)[number];
  uploadedBy: ActorDoc;
  createdAt: Date;
  updatedAt: Date;
}

const mediaSchema = new Schema<MediaDoc>(
  {
    storage: { type: String, enum: ['gridfs'], required: true, default: 'gridfs' },
    fileId: { type: Schema.Types.ObjectId, required: true },
    filename: { ...text(200, true) },
    mime: { ...text(80, true) },
    size: { type: Number, required: true, min: 0 },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
    sha256: { ...text(80, true) },
    visibility: { type: String, enum: MEDIA_VISIBILITIES, required: true, default: 'private' },
    alt: text(300),
    purpose: { type: String, enum: MEDIA_PRIVATE_PURPOSES },
    uploadedBy: { type: actorSchema, required: true },
  },
  { timestamps: true },
);

mediaSchema.index({ sha256: 1 });
mediaSchema.index({ visibility: 1, createdAt: -1 });

declare module 'mongoose' {
  interface Models {
    Media: Model<MediaDoc>;
  }
}

export const Media: Model<MediaDoc> = models.Media ?? model<MediaDoc>('Media', mediaSchema);
