import { Schema, model, models, type Model, type Types } from 'mongoose';
import { ASSIGNEE_KINDS, PRIORITIES, TASK_STATUSES } from '@/config/statuses';
import { actorSchema, minorField, statusHistorySchema, text, type StatusHistoryEntry, type ActorDoc } from './shared.schema';

type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskAssignee {
  kind: (typeof ASSIGNEE_KINDS)[number];
  id: Types.ObjectId;
  name: string;
  /** When this person was put on the task: "My work" flags assignments newer than their last visit. */
  assignedAt?: Date;
}

export interface TaskDoc {
  _id: Types.ObjectId;
  /** PRJ-0042-T007 */
  ref: string;
  projectId: Types.ObjectId;
  /** Derived from the project on the server. */
  clientId: Types.ObjectId;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: (typeof PRIORITIES)[number];
  assignees: TaskAssignee[];
  estimateMinutes?: number;
  dueOn?: Date;
  /** First move to in_progress. */
  startedAt?: Date;
  completedAt?: Date;
  /** Board position within its column. */
  order: number;
  labels: string[];
  /** Cached sum of work logs, updated in the same transaction as each work-log write. */
  loggedMinutes: number;
  statusHistory: StatusHistoryEntry<TaskStatus>[];
  archivedAt?: Date;
  createdBy?: ActorDoc;
  updatedBy?: ActorDoc;
  archivedBy?: ActorDoc;
  createdAt: Date;
  updatedAt: Date;
}

const assigneeSchema = new Schema<TaskAssignee>(
  {
    kind: { type: String, enum: ASSIGNEE_KINDS, required: true },
    id: { type: Schema.Types.ObjectId, required: true },
    name: { ...text(120, true) },
    assignedAt: { type: Date },
  },
  { _id: false },
);

const taskSchema = new Schema<TaskDoc>(
  {
    ref: { ...text(30, true) },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    title: { ...text(200, true), minlength: 2 },
    description: text(8000),
    status: { type: String, enum: TASK_STATUSES, required: true, default: 'todo' },
    priority: { type: String, enum: PRIORITIES, required: true, default: 'medium' },
    assignees: { type: [assigneeSchema], default: [] },
    estimateMinutes: minorField(),
    dueOn: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date },
    order: { type: Number, default: 0 },
    labels: { type: [text(40)], default: [] },
    loggedMinutes: { ...minorField(true), default: 0 },
    statusHistory: { type: [statusHistorySchema(TASK_STATUSES)], default: [] },
    archivedAt: { type: Date },
    createdBy: { type: actorSchema },
    updatedBy: { type: actorSchema },
    archivedBy: { type: actorSchema },
  },
  { timestamps: true },
);

taskSchema.index({ ref: 1 }, { unique: true });
taskSchema.index({ projectId: 1, status: 1, order: 1 });
taskSchema.index({ 'assignees.kind': 1, 'assignees.id': 1, status: 1 });
taskSchema.index({ status: 1, dueOn: 1 });
taskSchema.index({ clientId: 1, status: 1 });
// Dashboards count and bucket what was completed in a period.
taskSchema.index({ status: 1, completedAt: -1 });
taskSchema.index({ title: 'text', description: 'text' });

declare module 'mongoose' {
  interface Models {
    Task: Model<TaskDoc>;
  }
}

export const Task: Model<TaskDoc> = models.Task ?? model<TaskDoc>('Task', taskSchema);
