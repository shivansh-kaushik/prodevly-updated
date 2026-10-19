import { Schema, model, models, type Model, type Types } from 'mongoose';
import { EXPENSE_PAID_FROM, EXPENSE_SCOPES, EXPENSE_STATUSES } from '@/config/statuses';
import {
  actorSchema,
  dateOnly,
  moneySchema,
  statusHistorySchema,
  text,
  type ActorDoc,
  type MoneyDoc,
  type StatusHistoryEntry,
} from './shared.schema';

/**
 * Our own spending: company overhead, or charged to a client's project (and
 * optionally a task). Out-of-pocket expenses start `submitted` by an admin; a
 * superadmin approves them (we now owe the admin) and later marks them `paid`.
 */
export interface ExpenseDoc {
  _id: Types.ObjectId;
  /** EXP-FY27-0001 */
  ref: string;
  scope: (typeof EXPENSE_SCOPES)[number];
  /** Required when scope is "project". */
  clientId?: Types.ObjectId;
  projectId?: Types.ObjectId;
  taskId?: Types.ObjectId;
  /** From Settings. */
  category: string;
  description: string;
  payee?: string;
  amount: MoneyDoc;
  spentOn: Date;
  paidFrom: (typeof EXPENSE_PAID_FROM)[number];
  paidByAdmin?: ActorDoc;
  status: (typeof EXPENSE_STATUSES)[number];
  approvedBy?: ActorDoc;
  approvedAt?: Date;
  /** Company payment date, or the reimbursement date. */
  paidOn?: Date;
  mode?: string;
  transactionRef?: string;
  receiptMediaIds: Types.ObjectId[];
  rejectReason?: string;
  voidReason?: string;
  recordedBy: ActorDoc;
  /** Every status move with who and why: the approval trail shown on the expense page. */
  statusHistory: StatusHistoryEntry<(typeof EXPENSE_STATUSES)[number]>[];
  createdAt: Date;
  updatedAt: Date;
}

const expenseSchema = new Schema<ExpenseDoc>(
  {
    ref: { ...text(30, true) },
    scope: { type: String, enum: EXPENSE_SCOPES, required: true, default: 'company' },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task' },
    category: { ...text(60, true) },
    description: { ...text(500, true), minlength: 2 },
    payee: text(120),
    amount: { type: moneySchema, required: true },
    spentOn: dateOnly(true),
    paidFrom: { type: String, enum: EXPENSE_PAID_FROM, required: true, default: 'company' },
    paidByAdmin: { type: actorSchema },
    status: { type: String, enum: EXPENSE_STATUSES, required: true, default: 'submitted' },
    approvedBy: { type: actorSchema },
    approvedAt: { type: Date },
    paidOn: dateOnly(),
    mode: text(40),
    transactionRef: text(120),
    receiptMediaIds: { type: [Schema.Types.ObjectId], default: [] },
    rejectReason: text(300),
    voidReason: text(300),
    recordedBy: { type: actorSchema, required: true },
    statusHistory: { type: [statusHistorySchema(EXPENSE_STATUSES)], default: [] },
  },
  { timestamps: true },
);

// A project expense must name its client and project.
expenseSchema.pre('validate', async function () {
  if (this.scope === 'project' && (!this.clientId || !this.projectId)) {
    this.invalidate('projectId', 'A project expense must name a client and a project');
  }
  if (this.scope === 'company' && (this.clientId || this.projectId || this.taskId)) {
    this.invalidate('scope', 'A company expense cannot be linked to a client, project or task');
  }
  if (this.paidFrom === 'admin' && !this.paidByAdmin) {
    this.invalidate('paidByAdmin', 'Say which admin paid out of pocket');
  }
  if (this.status === 'paid' && !this.paidOn) this.invalidate('paidOn', 'A paid expense needs the date it was paid');
  if (this.status === 'rejected' && !this.rejectReason) this.invalidate('rejectReason', 'Say why this expense was rejected');
  if (this.status === 'void' && !this.voidReason) this.invalidate('voidReason', 'Say why this expense is void');
});

expenseSchema.index({ ref: 1 }, { unique: true });
expenseSchema.index({ projectId: 1, status: 1, spentOn: -1 });
expenseSchema.index({ scope: 1, status: 1, spentOn: -1 });
expenseSchema.index({ category: 1, spentOn: -1 });
expenseSchema.index({ 'paidByAdmin.id': 1, status: 1 });
expenseSchema.index({ status: 1, spentOn: -1 });

declare module 'mongoose' {
  interface Models {
    Expense: Model<ExpenseDoc>;
  }
}

export const Expense: Model<ExpenseDoc> = models.Expense ?? model<ExpenseDoc>('Expense', expenseSchema);
