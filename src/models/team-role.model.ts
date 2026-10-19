import { Schema, model, models, type Model, type Types } from 'mongoose';
import { actorSchema, text, type ActorDoc } from './shared.schema';

/** Job-role catalogue (Frontend developer, Project manager...). A job role grants no access. */
export interface TeamRoleDoc {
  _id: Types.ObjectId;
  name: string;
  nameLower: string;
  description?: string;
  order: number;
  archivedAt?: Date;
  createdBy?: ActorDoc;
  updatedBy?: ActorDoc;
  archivedBy?: ActorDoc;
  createdAt: Date;
  updatedAt: Date;
}

const teamRoleSchema = new Schema<TeamRoleDoc>(
  {
    name: { ...text(60, true), minlength: 2 },
    nameLower: { type: String, required: true },
    description: text(300),
    order: { type: Number, default: 0 },
    archivedAt: { type: Date },
    createdBy: { type: actorSchema },
    updatedBy: { type: actorSchema },
    archivedBy: { type: actorSchema },
  },
  { timestamps: true },
);

teamRoleSchema.pre('validate', async function () {
  this.nameLower = this.name.toLowerCase();
});
teamRoleSchema.index({ nameLower: 1 }, { unique: true });
teamRoleSchema.index({ order: 1 });

declare module 'mongoose' {
  interface Models {
    TeamRole: Model<TeamRoleDoc>;
  }
}

export const TeamRole: Model<TeamRoleDoc> = models.TeamRole ?? model<TeamRoleDoc>('TeamRole', teamRoleSchema);
