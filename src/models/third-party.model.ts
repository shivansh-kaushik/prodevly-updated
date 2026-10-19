import { Schema, model, models, type Model, type Types } from 'mongoose';
import { CURRENCY_CODES } from '@/config/currencies';
import { actorSchema, text, type ActorDoc } from './shared.schema';

/** A freelancer, agency or vendor we pay. */
export interface ThirdPartyDoc {
  _id: Types.ObjectId;
  /** TP-0001 */
  ref: string;
  name: string;
  nameLower: string;
  /** From Settings: freelancer, agency, vendor, contractor... */
  type: string;
  skills: string[];
  contactName?: string;
  email?: string;
  phone?: string;
  country?: string;
  defaultCurrency?: string;
  gstin?: string;
  /** Bank, UPI, PayPal or Wise details. `select: false`; needs `thirdParty:payDetails`. */
  paymentNote?: string;
  status: 'active' | 'inactive';
  notes?: string;
  archivedAt?: Date;
  createdBy?: ActorDoc;
  updatedBy?: ActorDoc;
  archivedBy?: ActorDoc;
  createdAt: Date;
  updatedAt: Date;
}

const thirdPartySchema = new Schema<ThirdPartyDoc>(
  {
    ref: { ...text(20, true) },
    name: { ...text(120, true), minlength: 2 },
    nameLower: { type: String, required: true },
    type: { ...text(40, true), default: 'freelancer' },
    skills: { type: [text(40)], default: [] },
    contactName: text(100),
    email: { ...text(160), lowercase: true },
    phone: text(30),
    country: { type: String, trim: true, uppercase: true, minlength: 2, maxlength: 2 },
    defaultCurrency: { type: String, enum: CURRENCY_CODES },
    gstin: { type: String, trim: true, uppercase: true, match: [/^[0-9A-Z]{15}$/, 'GSTIN must be 15 characters'] },
    paymentNote: { ...text(1000), select: false },
    status: { type: String, enum: ['active', 'inactive'], required: true, default: 'active' },
    notes: text(4000),
    archivedAt: { type: Date },
    createdBy: { type: actorSchema },
    updatedBy: { type: actorSchema },
    archivedBy: { type: actorSchema },
  },
  { timestamps: true },
);

thirdPartySchema.pre('validate', async function () {
  this.nameLower = this.name.toLowerCase();
});
thirdPartySchema.index({ ref: 1 }, { unique: true });
thirdPartySchema.index({ nameLower: 1 });
thirdPartySchema.index({ type: 1, status: 1 });

declare module 'mongoose' {
  interface Models {
    ThirdParty: Model<ThirdPartyDoc>;
  }
}

export const ThirdParty: Model<ThirdPartyDoc> = models.ThirdParty ?? model<ThirdPartyDoc>('ThirdParty', thirdPartySchema);
