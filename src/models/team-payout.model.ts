import { Schema, model, models, type Model, type Types } from 'mongoose';
import { PAYOUT_STATUSES, TEAM_PAYOUT_BASES } from '@/config/statuses';
import { actorSchema, dateOnly, minorField, moneySchema, text, type ActorDoc, type MoneyDoc } from './shared.schema';

export interface PayoutAllocation {
  clientId: Types.ObjectId;
  projectId: Types.ObjectId;
  amountMinor: number;
  /** This allocation's share of the payout in INR minor units. Project margins use this. */
  inrMinor: number;
  minutes?: number;
}

/**
 * A payment to a team member. `allocations` split it across client projects so a
 * project's team cost is traceable. The sum of allocations cannot exceed the
 * payout; the remainder is company overhead.
 */
export interface TeamPayoutDoc {
  _id: Types.ObjectId;
  /** TMP-FY27-0001 */
  ref: string;
  adminId: Types.ObjectId;
  adminName: string;
  basis: (typeof TEAM_PAYOUT_BASES)[number];
  periodFrom: Date;
  periodTo: Date;
  /** What the system proposed, kept next to the final amount so differences stay visible. */
  suggestion?: { minutes?: number; taskCount?: number; rateMinor?: number; currency?: string; computedMinor?: number };
  amount: MoneyDoc;
  status: (typeof PAYOUT_STATUSES)[number];
  dueOn?: Date;
  paidOn?: Date;
  mode?: string;
  transactionRef?: string;
  note?: string;
  allocations: PayoutAllocation[];
  unallocatedInrMinor: number;
  recordedBy: ActorDoc;
  paidBy?: ActorDoc;
  voidReason?: string;
  /** Who voided it and when (the audit entry has them too; this keeps the page free of a join). */
  voidedBy?: ActorDoc;
  voidedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const allocationSchema = new Schema<PayoutAllocation>(
  {
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    amountMinor: { ...minorField(true) },
    inrMinor: { ...minorField(true) },
    minutes: minorField(),
  },
  { _id: false },
);

const teamPayoutSchema = new Schema<TeamPayoutDoc>(
  {
    ref: { ...text(30, true) },
    adminId: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
    adminName: { ...text(80, true) },
    basis: { type: String, enum: TEAM_PAYOUT_BASES, required: true },
    periodFrom: dateOnly(true),
    periodTo: dateOnly(true),
    suggestion: {
      minutes: Number,
      taskCount: Number,
      rateMinor: Number,
      currency: String,
      computedMinor: Number,
    },
    amount: { type: moneySchema, required: true },
    status: { type: String, enum: PAYOUT_STATUSES, required: true, default: 'due' },
    dueOn: dateOnly(),
    paidOn: dateOnly(),
    mode: text(40),
    transactionRef: text(120),
    note: text(1000),
    allocations: { type: [allocationSchema], default: [] },
    unallocatedInrMinor: { ...minorField(true), default: 0 },
    recordedBy: { type: actorSchema, required: true },
    paidBy: { type: actorSchema },
    voidReason: text(300),
    voidedBy: { type: actorSchema },
    voidedAt: { type: Date },
  },
  { timestamps: true },
);

teamPayoutSchema.pre('validate', async function () {
  if (this.amount) {
    // Allocations may never exceed the payout: in INR (what every dashboard sums) and in the payout's own currency.
    const allocatedInr = this.allocations.reduce((sum, a) => sum + a.inrMinor, 0);
    const allocatedOwn = this.allocations.reduce((sum, a) => sum + a.amountMinor, 0);
    if (allocatedInr > this.amount.inrMinor || allocatedOwn > this.amount.amountMinor) {
      this.invalidate('allocations', 'Allocations cannot exceed the payout amount');
    } else {
      // Derived, never trusted from the caller: the remainder is company overhead.
      this.unallocatedInrMinor = this.amount.inrMinor - allocatedInr;
    }
  }
  if (this.periodFrom && this.periodTo && this.periodTo < this.periodFrom) {
    this.invalidate('periodTo', 'The period cannot end before it starts');
  }
  if (this.status === 'paid' && !this.paidOn) this.invalidate('paidOn', 'A paid payout needs the date it was paid');
  if (this.status === 'void' && !this.voidReason) this.invalidate('voidReason', 'Say why this payout is void');
});

teamPayoutSchema.index({ ref: 1 }, { unique: true });
teamPayoutSchema.index({ adminId: 1, status: 1, paidOn: -1 });
teamPayoutSchema.index({ 'allocations.projectId': 1, status: 1 });
teamPayoutSchema.index({ status: 1, dueOn: 1 });
teamPayoutSchema.index({ status: 1, paidOn: -1 });

declare module 'mongoose' {
  interface Models {
    TeamPayout: Model<TeamPayoutDoc>;
  }
}

export const TeamPayout: Model<TeamPayoutDoc> = models.TeamPayout ?? model<TeamPayoutDoc>('TeamPayout', teamPayoutSchema);
