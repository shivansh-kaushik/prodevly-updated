import { Schema, model, models, type Model, type Types } from 'mongoose';
import { CURRENCY_CODES } from '@/config/currencies';
import { PAY_BASES } from '@/config/statuses';
import { actorSchema, dateOnly, minorField, text, type ActorDoc } from './shared.schema';

type PayBasis = (typeof PAY_BASES)[number];

export interface PayHistoryEntry {
  basis: PayBasis;
  rateMinor: number;
  currency: string;
  effectiveFrom: Date;
  /** The LAST day these terms applied (inclusive, like a payout period), so the next terms start the day after. */
  effectiveTo: Date;
  /** Who replaced these terms. */
  changedBy: ActorDoc;
}

/**
 * How each team member is paid. Kept apart from `admins` so pay data never
 * travels with session or directory reads. Only superadmins, and the person
 * themself for their own basis and rate, may read it.
 */
export interface PayProfileDoc {
  _id: Types.ObjectId;
  adminId: Types.ObjectId;
  basis: PayBasis;
  rateMinor: number;
  currency: string;
  effectiveFrom: Date;
  history: PayHistoryEntry[];
  /** Bank or UPI note. `select: false`, returned to superadmins only. */
  payoutNote?: string;
  createdAt: Date;
  createdBy?: ActorDoc;
  updatedBy?: ActorDoc;
  updatedAt: Date;
}

const historySchema = new Schema<PayHistoryEntry>(
  {
    basis: { type: String, enum: PAY_BASES, required: true },
    rateMinor: minorField(true),
    currency: { type: String, enum: CURRENCY_CODES, required: true },
    effectiveFrom: dateOnly(true),
    effectiveTo: dateOnly(true),
    changedBy: { type: actorSchema, required: true },
  },
  { _id: false },
);

const payProfileSchema = new Schema<PayProfileDoc>(
  {
    adminId: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
    basis: { type: String, enum: PAY_BASES, required: true, default: 'none' },
    rateMinor: { ...minorField(true), default: 0 },
    currency: { type: String, enum: CURRENCY_CODES, required: true, default: 'INR' },
    effectiveFrom: dateOnly(true),
    history: { type: [historySchema], default: [] },
    payoutNote: { ...text(500), select: false },
    createdBy: { type: actorSchema },
    updatedBy: { type: actorSchema },
  },
  { timestamps: true },
);

payProfileSchema.index({ adminId: 1 }, { unique: true });

declare module 'mongoose' {
  interface Models {
    PayProfile: Model<PayProfileDoc>;
  }
}

export const PayProfile: Model<PayProfileDoc> =
  models.PayProfile ?? model<PayProfileDoc>('PayProfile', payProfileSchema);
