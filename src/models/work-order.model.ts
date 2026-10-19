import { Schema, model, models, type Model, type Types } from 'mongoose';
import { CURRENCY_CODES } from '@/config/currencies';
import { WORK_ORDER_STATUSES } from '@/config/statuses';
import { actorSchema, minorField, statusHistorySchema, text, type StatusHistoryEntry, type ActorDoc } from './shared.schema';

type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

/** What we agreed to pay a third party, for a client's project and optionally one task. */
export interface WorkOrderDoc {
  _id: Types.ObjectId;
  /** WO-0001 */
  ref: string;
  thirdPartyId: Types.ObjectId;
  thirdPartyName: string;
  clientId: Types.ObjectId;
  projectId: Types.ObjectId;
  taskId?: Types.ObjectId;
  title: string;
  scope?: string;
  agreed: { amountMinor: number; currency: string };
  dueOn?: Date;
  status: WorkOrderStatus;
  statusHistory: StatusHistoryEntry<WorkOrderStatus>[];
  /** Cached sums of linked payouts, updated in the same transaction as each payout write. */
  paidMinor: number;
  dueMinor: number;
  createdAt: Date;
  createdBy?: ActorDoc;
  updatedBy?: ActorDoc;
  updatedAt: Date;
}

const workOrderSchema = new Schema<WorkOrderDoc>(
  {
    ref: { ...text(20, true) },
    thirdPartyId: { type: Schema.Types.ObjectId, ref: 'ThirdParty', required: true },
    thirdPartyName: { ...text(120, true) },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task' },
    title: { ...text(200, true), minlength: 2 },
    scope: text(4000),
    agreed: {
      amountMinor: { ...minorField(true), min: 1 },
      currency: { type: String, enum: CURRENCY_CODES, required: true },
    },
    dueOn: { type: Date },
    status: { type: String, enum: WORK_ORDER_STATUSES, required: true, default: 'open' },
    statusHistory: { type: [statusHistorySchema(WORK_ORDER_STATUSES)], default: [] },
    paidMinor: { ...minorField(true), default: 0 },
    dueMinor: { ...minorField(true), default: 0 },
    createdBy: { type: actorSchema },
    updatedBy: { type: actorSchema },
  },
  { timestamps: true },
);

workOrderSchema.index({ ref: 1 }, { unique: true });
workOrderSchema.index({ thirdPartyId: 1, status: 1 });
workOrderSchema.index({ projectId: 1, status: 1 });
workOrderSchema.index({ taskId: 1 }, { partialFilterExpression: { taskId: { $exists: true } } });
// The dashboard and the list ask "which work orders are open, and which are past due" across every third party.
workOrderSchema.index({ status: 1, dueOn: 1 });

declare module 'mongoose' {
  interface Models {
    WorkOrder: Model<WorkOrderDoc>;
  }
}

export const WorkOrder: Model<WorkOrderDoc> = models.WorkOrder ?? model<WorkOrderDoc>('WorkOrder', workOrderSchema);
