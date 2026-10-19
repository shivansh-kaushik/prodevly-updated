import { Schema, model, models, type Model, type Types } from 'mongoose';
import { PAYMENT_STATUSES, PAYMENT_TYPES } from '@/config/statuses';
import { actorSchema, dateOnly, minorField, moneySchema, text, type ActorDoc, type MoneyDoc } from './shared.schema';

/**
 * Money received from a client. Every entry names a client AND a project (and
 * optionally a task or milestone); the server derives and cross-checks the links,
 * so a payment can never point at a task from another project.
 */
export interface ClientPaymentDoc {
  _id: Types.ObjectId;
  /** PAY-FY27-0001 */
  ref: string;
  type: (typeof PAYMENT_TYPES)[number];
  clientId: Types.ObjectId;
  projectId: Types.ObjectId;
  taskId?: Types.ObjectId;
  milestoneId?: Types.ObjectId;
  /** The net amount that reached our account. */
  amount: MoneyDoc;
  /** The same amount in the project's contract currency (equals amount when the currencies match). */
  contractEquivalentMinor: number;
  /** TDS deducted by the client and bank or platform fees, in the entry currency. */
  tdsMinor?: number;
  chargesMinor?: number;
  receivedOn: Date;
  mode: string;
  transactionRef?: string;
  invoiceRef?: string;
  note?: string;
  attachmentMediaIds: Types.ObjectId[];
  /** True when a superadmin recorded this receipt knowing it takes the total received above what is billable. */
  recordedAsAdvance?: boolean;
  status: (typeof PAYMENT_STATUSES)[number];
  voidReason?: string;
  voidedBy?: ActorDoc;
  voidedAt?: Date;
  recordedBy: ActorDoc;
  createdAt: Date;
  updatedAt: Date;
}

const clientPaymentSchema = new Schema<ClientPaymentDoc>(
  {
    ref: { ...text(30, true) },
    type: { type: String, enum: PAYMENT_TYPES, required: true, default: 'receipt' },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task' },
    milestoneId: { type: Schema.Types.ObjectId },
    amount: { type: moneySchema, required: true },
    contractEquivalentMinor: minorField(true),
    tdsMinor: minorField(),
    chargesMinor: minorField(),
    receivedOn: dateOnly(true),
    mode: { ...text(40, true) },
    transactionRef: text(120),
    invoiceRef: text(60),
    note: text(1000),
    attachmentMediaIds: { type: [Schema.Types.ObjectId], default: [] },
    recordedAsAdvance: { type: Boolean },
    status: { type: String, enum: PAYMENT_STATUSES, required: true, default: 'received' },
    voidReason: text(300),
    voidedBy: { type: actorSchema },
    voidedAt: { type: Date },
    recordedBy: { type: actorSchema, required: true },
  },
  { timestamps: true },
);

// A voided payment says why.
clientPaymentSchema.pre('validate', async function () {
  if (this.status === 'void' && !this.voidReason) this.invalidate('voidReason', 'Say why this payment is void');
});

clientPaymentSchema.index({ ref: 1 }, { unique: true });
clientPaymentSchema.index({ projectId: 1, status: 1, receivedOn: -1 });
clientPaymentSchema.index({ clientId: 1, status: 1, receivedOn: -1 });
clientPaymentSchema.index({ status: 1, receivedOn: -1 });
clientPaymentSchema.index({ taskId: 1 }, { partialFilterExpression: { taskId: { $exists: true } } });
clientPaymentSchema.index({ 'amount.currency': 1, receivedOn: -1 });

declare module 'mongoose' {
  interface Models {
    ClientPayment: Model<ClientPaymentDoc>;
  }
}

export const ClientPayment: Model<ClientPaymentDoc> =
  models.ClientPayment ?? model<ClientPaymentDoc>('ClientPayment', clientPaymentSchema);
