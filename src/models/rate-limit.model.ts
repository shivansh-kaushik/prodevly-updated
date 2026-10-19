import { Schema, model, models, type Model } from 'mongoose';

/**
 * Fixed-window rate limiting backed by MongoDB: one document per (bucket, key,
 * window) with a TTL index. A per-process counter would be worthless when several
 * instances run, and this needs no Redis.
 */
export interface RateLimitDoc {
  _id: string;
  count: number;
  expiresAt: Date;
}

const rateLimitSchema = new Schema<RateLimitDoc>(
  {
    _id: { type: String, required: true },
    count: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

// MongoDB's TTL monitor sweeps expired windows roughly once a minute.
rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

declare module 'mongoose' {
  interface Models {
    RateLimit: Model<RateLimitDoc>;
  }
}

export const RateLimit: Model<RateLimitDoc> = models.RateLimit ?? model<RateLimitDoc>('RateLimit', rateLimitSchema);
