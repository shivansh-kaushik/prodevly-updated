import { Schema, model, models, type Model, type Types } from 'mongoose';
import { CURRENCY_CODES } from '@/config/currencies';
import {
  MILESTONE_STATUSES,
  PRICING_MODELS,
  PRIORITIES,
  PROJECT_HEALTH,
  PROJECT_STATUSES,
  PROJECT_TYPES,
} from '@/config/statuses';
import {
  actorSchema,
  minorField,
  statusHistorySchema,
  text,
  type ActorDoc,
  type ProjectStatusHistoryEntry,
} from './shared.schema';

export interface Milestone {
  _id: Types.ObjectId;
  title: string;
  /** In the contract currency. */
  amountMinor: number;
  dueOn?: Date;
  status: (typeof MILESTONE_STATUSES)[number];
  invoiceRef?: string;
}

export interface ProjectContract {
  pricingModel: (typeof PRICING_MODELS)[number];
  amountMinor: number;
  currency: string;
  hourlyRateMinor?: number;
  retainerMonthlyMinor?: number;
}

/** Scope, price and deadline as first agreed. Written once when the project first becomes active; never edited, so drift stays visible. */
export interface AgreedSnapshot {
  scope?: string;
  amountMinor: number;
  currency: string;
  deadlineOn?: Date;
  capturedAt: Date;
  capturedBy: ActorDoc;
}

export interface ProjectDoc {
  _id: Types.ObjectId;
  /** PRJ-0042 */
  ref: string;
  clientId: Types.ObjectId;
  /** Snapshot, so lists render without a join. */
  clientName: string;
  name: string;
  type: (typeof PROJECT_TYPES)[number];
  status: (typeof PROJECT_STATUSES)[number];
  health: (typeof PROJECT_HEALTH)[number];
  priority: (typeof PRIORITIES)[number];
  lead?: ActorDoc;
  memberIds: Types.ObjectId[];
  startOn?: Date;
  deadlineOn?: Date;
  deliveredOn?: Date;
  contract: ProjectContract;
  milestones: Milestone[];
  agreed?: AgreedSnapshot;
  /** Optional internal cost budget in INR minor units. */
  costBudgetInrMinor?: number;
  scopeSummary?: string;
  links: { repo?: string; staging?: string; live?: string; design?: string };
  tags: string[];
  statusHistory: ProjectStatusHistoryEntry[];
  archivedAt?: Date;
  archivedBy?: ActorDoc;
  createdBy?: ActorDoc;
  updatedBy?: ActorDoc;
  createdAt: Date;
  updatedAt: Date;
}

const milestoneSchema = new Schema<Milestone>({
  title: { ...text(120, true) },
  amountMinor: minorField(true),
  dueOn: { type: Date },
  status: { type: String, enum: MILESTONE_STATUSES, required: true, default: 'pending' },
  invoiceRef: text(60),
});

const contractSchema = new Schema<ProjectContract>(
  {
    pricingModel: { type: String, enum: PRICING_MODELS, required: true, default: 'fixed' },
    amountMinor: { ...minorField(true), default: 0 },
    currency: { type: String, enum: CURRENCY_CODES, required: true, default: 'INR' },
    hourlyRateMinor: minorField(),
    retainerMonthlyMinor: minorField(),
  },
  { _id: false },
);

const agreedSchema = new Schema<AgreedSnapshot>(
  {
    scope: text(4000),
    amountMinor: minorField(true),
    currency: { type: String, enum: CURRENCY_CODES, required: true },
    deadlineOn: { type: Date },
    capturedAt: { type: Date, required: true },
    capturedBy: { type: actorSchema, required: true },
  },
  { _id: false },
);

const projectSchema = new Schema<ProjectDoc>(
  {
    ref: { ...text(20, true) },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    clientName: { ...text(120, true) },
    name: { ...text(140, true), minlength: 2 },
    type: { type: String, enum: PROJECT_TYPES, required: true },
    status: { type: String, enum: PROJECT_STATUSES, required: true, default: 'proposal' },
    health: { type: String, enum: PROJECT_HEALTH, required: true, default: 'on_track' },
    priority: { type: String, enum: PRIORITIES, required: true, default: 'medium' },
    lead: { type: actorSchema },
    memberIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Admin' }], default: [] },
    startOn: { type: Date },
    deadlineOn: { type: Date },
    deliveredOn: { type: Date },
    contract: { type: contractSchema, required: true, default: () => ({}) },
    milestones: { type: [milestoneSchema], default: [] },
    agreed: { type: agreedSchema },
    costBudgetInrMinor: minorField(),
    scopeSummary: text(4000),
    links: {
      repo: text(300),
      staging: text(300),
      live: text(300),
      design: text(300),
    },
    tags: { type: [text(40)], default: [] },
    statusHistory: { type: [statusHistorySchema(PROJECT_STATUSES)], default: [] },
    archivedAt: { type: Date },
    archivedBy: { type: actorSchema },
    createdBy: { type: actorSchema },
    updatedBy: { type: actorSchema },
  },
  { timestamps: true },
);

projectSchema.index({ ref: 1 }, { unique: true });
projectSchema.index({ clientId: 1, status: 1 });
projectSchema.index({ status: 1, deadlineOn: 1 });
projectSchema.index({ 'lead.id': 1, status: 1 });
projectSchema.index({ memberIds: 1, status: 1 });
projectSchema.index({ type: 1, status: 1 });

declare module 'mongoose' {
  interface Models {
    Project: Model<ProjectDoc>;
  }
}

export const Project: Model<ProjectDoc> = models.Project ?? model<ProjectDoc>('Project', projectSchema);
