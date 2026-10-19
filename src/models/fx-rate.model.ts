import { Schema, model, models, type Model, type Types } from 'mongoose';
import { CURRENCY_CODES } from '@/config/currencies';
import { FX_RATE_SOURCES } from '@/config/statuses';
import { actorSchema, dateOnly, type ActorDoc } from './shared.schema';

/** Conversion rates to INR. Saved ledger entries keep the rate they were created with and never change when this table does. */
export interface FxRateDoc {
  _id: Types.ObjectId;
  currency: string;
  /** Date-only, UTC midnight. */
  rateOn: Date;
  /** INR per 1 unit of `currency`. */
  rate: number;
  source: (typeof FX_RATE_SOURCES)[number];
  enteredBy?: ActorDoc;
  createdAt: Date;
  updatedAt: Date;
}

const fxRateSchema = new Schema<FxRateDoc>(
  {
    currency: { type: String, required: true, uppercase: true, enum: CURRENCY_CODES },
    rateOn: dateOnly(true),
    rate: { type: Number, required: true, min: 0.000001 },
    source: { type: String, enum: FX_RATE_SOURCES, required: true, default: 'manual' },
    enteredBy: { type: actorSchema },
  },
  { timestamps: true },
);

fxRateSchema.index({ currency: 1, rateOn: -1 }, { unique: true });

declare module 'mongoose' {
  interface Models {
    FxRate: Model<FxRateDoc>;
  }
}

export const FxRate: Model<FxRateDoc> = models.FxRate ?? model<FxRateDoc>('FxRate', fxRateSchema);
