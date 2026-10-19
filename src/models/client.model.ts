import { Schema, model, models, type Model, type Types } from 'mongoose';
import { CURRENCY_CODES } from '@/config/currencies';
import { CLIENT_KINDS, CLIENT_SOURCES, CLIENT_STATUSES } from '@/config/statuses';
import { actorSchema, addressSchema, text, type ActorDoc, type AddressDoc } from './shared.schema';

export interface ClientContact {
  name: string;
  email?: string;
  phone?: string;
  designation?: string;
  isPrimary: boolean;
}

export interface ClientDoc {
  _id: Types.ObjectId;
  /** CL-0001 */
  ref: string;
  name: string;
  nameLower: string;
  kind: (typeof CLIENT_KINDS)[number];
  status: (typeof CLIENT_STATUSES)[number];
  /** Exactly one client is internal: "ProDevly (internal)", for our own projects. Never counted as revenue. */
  isInternal: boolean;
  industry?: string;
  /** ISO 3166-1 alpha-2 */
  country?: string;
  billingCurrency?: string;
  /** Indian GST number, 15 characters. */
  gstin?: string;
  /** Tax id for non-Indian clients. */
  taxId?: string;
  address?: AddressDoc;
  website?: string;
  contacts: ClientContact[];
  accountOwner?: ActorDoc;
  source?: (typeof CLIENT_SOURCES)[number];
  leadId?: Types.ObjectId;
  notes?: string;
  tags: string[];
  archivedAt?: Date;
  archivedBy?: ActorDoc;
  createdBy?: ActorDoc;
  updatedBy?: ActorDoc;
  createdAt: Date;
  updatedAt: Date;
}

const contactSchema = new Schema<ClientContact>(
  {
    name: { ...text(100, true) },
    email: { ...text(160), lowercase: true },
    phone: text(30),
    designation: text(80),
    isPrimary: { type: Boolean, default: false },
  },
  { _id: false },
);

const clientSchema = new Schema<ClientDoc>(
  {
    ref: { ...text(20, true) },
    name: { ...text(120, true), minlength: 2 },
    nameLower: { type: String, required: true },
    kind: { type: String, enum: CLIENT_KINDS, required: true, default: 'company' },
    status: { type: String, enum: CLIENT_STATUSES, required: true, default: 'prospect' },
    isInternal: { type: Boolean, required: true, default: false },
    industry: text(80),
    country: { type: String, trim: true, uppercase: true, minlength: 2, maxlength: 2 },
    billingCurrency: { type: String, enum: CURRENCY_CODES },
    gstin: { type: String, trim: true, uppercase: true, match: [/^[0-9A-Z]{15}$/, 'GSTIN must be 15 characters'] },
    taxId: text(40),
    address: { type: addressSchema },
    website: text(200),
    contacts: { type: [contactSchema], default: [] },
    accountOwner: { type: actorSchema },
    source: { type: String, enum: CLIENT_SOURCES },
    leadId: { type: Schema.Types.ObjectId },
    notes: text(4000),
    tags: { type: [text(40)], default: [] },
    archivedAt: { type: Date },
    archivedBy: { type: actorSchema },
    createdBy: { type: actorSchema },
    updatedBy: { type: actorSchema },
  },
  { timestamps: true },
);

clientSchema.pre('validate', async function () {
  this.nameLower = this.name.toLowerCase();
});
clientSchema.index({ ref: 1 }, { unique: true });
clientSchema.index({ nameLower: 1 });
clientSchema.index({ status: 1, updatedAt: -1 });
clientSchema.index({ 'accountOwner.id': 1, status: 1 });
clientSchema.index({ 'contacts.email': 1 });
// At most one internal client.
clientSchema.index({ isInternal: 1 }, { unique: true, partialFilterExpression: { isInternal: true } });

declare module 'mongoose' {
  interface Models {
    Client: Model<ClientDoc>;
  }
}

export const Client: Model<ClientDoc> = models.Client ?? model<ClientDoc>('Client', clientSchema);
