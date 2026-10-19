import { Schema, model, models, type Model, type Types } from 'mongoose';
import { PAYOUT_STATUSES } from '@/config/statuses';
import { actorSchema, dateOnly, minorField, moneySchema, text, type ActorDoc, type MoneyDoc } from './shared.schema';

/**
 * What we owe and what we paid a third party. Each payout is linked to a client
 * and a project (and optionally a task), so a project's third-party cost is
 * always traceable. With a work order the three links are copied from it.
 */
export interface ThirdPartyPayoutDoc {
  _id: Types.ObjectId;
  /** TPP-FY27-0001 */
  ref: string;
  thirdPartyId: Types.ObjectId;
  thirdPartyName: string;
  workOrderId?: Types.ObjectId;
  clientId: Types.ObjectId;
  projectId: Types.ObjectId;
  taskId?: Types.ObjectId;
  /** With a work order the currency must match the work order's currency. */
  amount: MoneyDoc;
  /** TDS we withheld. */
  tdsMinor?: number;
  status: (typeof PAYOUT_STATUSES)[number];
  dueOn?: Date;
  paidOn?: Date;
  mode?: string;
  transactionRef?: string;
  note?: string;
  attachmentMediaIds: Types.ObjectId[];
  recordedBy: ActorDoc;
  paidBy?: ActorDoc;
  voidReason?: string;
  voidedBy?: ActorDoc;
  createdAt: Date;
  updatedAt: Date;
}

const payoutSchema = new Schema<ThirdPartyPayoutDoc>(
  {
    ref: { ...text(30, true) },
    thirdPartyId: { type: Schema.Types.ObjectId, ref: 'ThirdParty', required: true },
    thirdPartyName: { ...text(120, true) },
    workOrderId: { type: Schema.Types.ObjectId, ref: 'WorkOrder' },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task' },
    amount: { type: moneySchema, required: true },
    tdsMinor: minorField(),
    status: { type: String, enum: PAYOUT_STATUSES, required: true, default: 'due' },
    dueOn: dateOnly(),
    paidOn: dateOnly(),
    mode: text(40),
    transactionRef: text(120),
    note: text(1000),
    attachmentMediaIds: { type: [Schema.Types.ObjectId], default: [] },
    recordedBy: { type: actorSchema, required: true },
    paidBy: { type: actorSchema },
    voidReason: text(300),
    voidedBy: { type: actorSchema },
  },
  { timestamps: true },
);

// A paid payout has a paid date (period totals bucket by it); a voided one says why.
payoutSchema.pre('validate', async function () {
  if (this.status === 'paid' && !this.paidOn) this.invalidate('paidOn', 'A paid payout needs the date it was paid');
  if (this.status === 'void' && !this.voidReason) this.invalidate('voidReason', 'Say why this payout is void');
});

payoutSchema.index({ ref: 1 }, { unique: true });
payoutSchema.index({ thirdPartyId: 1, status: 1, paidOn: -1 });
payoutSchema.index({ projectId: 1, status: 1 });
payoutSchema.index({ clientId: 1, status: 1 });
payoutSchema.index({ workOrderId: 1 }, { partialFilterExpression: { workOrderId: { $exists: true } } });
payoutSchema.index({ taskId: 1 }, { partialFilterExpression: { taskId: { $exists: true } } });
payoutSchema.index({ status: 1, dueOn: 1 });
// Period scans of what was actually paid (the ledger, the dashboards).
payoutSchema.index({ status: 1, paidOn: -1 });

declare module 'mongoose' {
  interface Models {
    ThirdPartyPayout: Model<ThirdPartyPayoutDoc>;
  }
}

export const ThirdPartyPayout: Model<ThirdPartyPayoutDoc> =
  models.ThirdPartyPayout ?? model<ThirdPartyPayoutDoc>('ThirdPartyPayout', payoutSchema);
