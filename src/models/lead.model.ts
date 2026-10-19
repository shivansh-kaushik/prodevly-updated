import { Schema, model, models, type Model, type Types } from 'mongoose';
import { LEAD_STATUSES, type LeadStatus } from '@/config/statuses';
import { actorSchema, dateOnly, statusHistorySchema, text, type ActorDoc, type StatusHistoryEntry } from './shared.schema';

export interface LeadNote {
  at: Date;
  by: ActorDoc;
  text: string;
}

/** A contact-form submission, shown in the admin as an Enquiry. */
export interface LeadDoc {
  _id: Types.ObjectId;
  /** ENQ-0001 */
  ref: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  country?: string;
  serviceIds: Types.ObjectId[];
  budgetRange?: string;
  message: string;
  sourcePath?: string;
  utm?: { source?: string; medium?: string; campaign?: string };
  /** Salted hash: raw IPs are never stored. */
  ipHash?: string;
  userAgent?: string;
  status: LeadStatus;
  statusHistory: StatusHistoryEntry<LeadStatus>[];
  assignedTo?: ActorDoc;
  followUpOn?: Date;
  notes: LeadNote[];
  /** First move away from "new". Median first-reply time is computed from this. */
  firstResponseAt?: Date;
  convertedClientId?: Types.ObjectId;
  convertedProjectId?: Types.ObjectId;
  /** SHA-256 of the normalised email and message, for the 10-minute duplicate check. */
  messageHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

const noteSchema = new Schema<LeadNote>(
  { at: { type: Date, required: true, default: Date.now }, by: { type: actorSchema, required: true }, text: { ...text(2000, true) } },
  { _id: false },
);

const leadSchema = new Schema<LeadDoc>(
  {
    ref: { ...text(20, true) },
    name: { ...text(120, true) },
    email: { ...text(160, true), lowercase: true },
    phone: text(40),
    company: text(120),
    country: text(80),
    serviceIds: { type: [Schema.Types.ObjectId], default: [] },
    budgetRange: text(60),
    message: { ...text(5000, true) },
    sourcePath: text(300),
    utm: { source: text(100), medium: text(100), campaign: text(100) },
    ipHash: text(80),
    userAgent: text(400),
    status: { type: String, enum: LEAD_STATUSES, required: true, default: 'new' },
    statusHistory: { type: [statusHistorySchema(LEAD_STATUSES)], default: [] },
    assignedTo: { type: actorSchema },
    followUpOn: dateOnly(),
    notes: { type: [noteSchema], default: [] },
    firstResponseAt: { type: Date },
    convertedClientId: { type: Schema.Types.ObjectId, ref: 'Client' },
    convertedProjectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    messageHash: text(80),
  },
  { timestamps: true },
);

leadSchema.index({ ref: 1 }, { unique: true });
leadSchema.index({ createdAt: -1 });
leadSchema.index({ status: 1, createdAt: -1 });
leadSchema.index({ 'assignedTo.id': 1, status: 1 });
leadSchema.index({ email: 1, createdAt: -1 });
leadSchema.index({ messageHash: 1, createdAt: -1 });
leadSchema.index({ followUpOn: 1, status: 1 });

declare module 'mongoose' {
  interface Models {
    Lead: Model<LeadDoc>;
  }
}

export const Lead: Model<LeadDoc> = models.Lead ?? model<LeadDoc>('Lead', leadSchema);
