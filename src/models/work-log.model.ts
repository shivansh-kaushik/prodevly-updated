import { Schema, model, models, type Model, type Types } from 'mongoose';
import { text, wholeNumber } from './shared.schema';

/** Time an admin logged against a task. Project and client are derived from the task. */
export interface WorkLogDoc {
  _id: Types.ObjectId;
  adminId: Types.ObjectId;
  adminName: string;
  taskId: Types.ObjectId;
  projectId: Types.ObjectId;
  clientId: Types.ObjectId;
  /** Date-only, UTC midnight. */
  workedOn: Date;
  minutes: number;
  note: string;
  billable: boolean;
  /** Set when a paid team payout covers this log; nobody can then edit it. */
  lockedByPayoutId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const workLogSchema = new Schema<WorkLogDoc>(
  {
    adminId: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
    adminName: { ...text(80, true) },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    workedOn: { type: Date, required: true },
    minutes: { type: Number, required: true, min: 5, max: 720, validate: wholeNumber },
    note: { ...text(500, true), minlength: 3 },
    billable: { type: Boolean, required: true, default: false },
    lockedByPayoutId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

workLogSchema.index({ adminId: 1, workedOn: -1 });
workLogSchema.index({ projectId: 1, workedOn: -1 });
workLogSchema.index({ taskId: 1, workedOn: -1 });
// Dashboards and the all-logs list range over dates across every person.
workLogSchema.index({ workedOn: -1 });
workLogSchema.index({ lockedByPayoutId: 1 }, { partialFilterExpression: { lockedByPayoutId: { $exists: true } } });

declare module 'mongoose' {
  interface Models {
    WorkLog: Model<WorkLogDoc>;
  }
}

export const WorkLog: Model<WorkLogDoc> = models.WorkLog ?? model<WorkLogDoc>('WorkLog', workLogSchema);
