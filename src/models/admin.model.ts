import { Schema, model, models, type Model, type Types } from 'mongoose';
import { ADMIN_ROLES, GRANTABLE, type AdminRole, type Capability } from '@/config/capabilities';
import { ADMIN_STATUSES, EMPLOYMENT_TYPES } from '@/config/statuses';
import { actorSchema, text, type ActorDoc } from './shared.schema';

export interface AdminProfile {
  phone?: string;
  jobRoleId?: Types.ObjectId;
  designation?: string;
  skills: string[];
  employmentType?: (typeof EMPLOYMENT_TYPES)[number];
  joinedOn?: Date;
  weeklyCapacityHours?: number;
  avatarMediaId?: Types.ObjectId;
}

export interface AdminDoc {
  _id: Types.ObjectId;
  name: string;
  email: string;
  /** bcrypt hash. `select: false`: it can never leak through a generic query. */
  passwordHash: string;
  role: AdminRole;
  /** Extra capabilities a superadmin switched on for this person. */
  grants: Capability[];
  status: (typeof ADMIN_STATUSES)[number];
  /** True for seeded accounts, new accounts and after a reset or reactivation. */
  mustChangePassword: boolean;
  /**
   * Embedded in the session JWT. Raising it ends every session this admin holds:
   * password change or reset, role change, deactivation, "sign out everywhere".
   */
  tokenVersion: number;
  failedLoginAttempts: number;
  lockedUntil?: Date;
  lastLoginAt?: Date;
  lastLoginIpHash?: string;
  passwordChangedAt?: Date;
  profile: AdminProfile;
  deactivatedAt?: Date;
  deactivatedBy?: ActorDoc;
  deactivationReason?: string;
  createdBy?: ActorDoc;
  updatedBy?: ActorDoc;
  createdAt: Date;
  updatedAt: Date;
}

const profileSchema = new Schema<AdminProfile>(
  {
    phone: text(30),
    jobRoleId: { type: Schema.Types.ObjectId, ref: 'TeamRole' },
    designation: text(80),
    skills: { type: [text(40)], default: [] },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES },
    joinedOn: { type: Date },
    weeklyCapacityHours: { type: Number, min: 1, max: 80 },
    avatarMediaId: { type: Schema.Types.ObjectId },
  },
  { _id: false },
);

const adminSchema = new Schema<AdminDoc>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 160 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ADMIN_ROLES, required: true, default: 'admin' },
    // Only what a superadmin may grant: role defaults are not grants, and neither is anything superadmin-only.
    grants: { type: [{ type: String, enum: GRANTABLE }], default: [] },
    status: { type: String, enum: ADMIN_STATUSES, required: true, default: 'active' },
    mustChangePassword: { type: Boolean, required: true, default: true },
    tokenVersion: { type: Number, required: true, default: 0 },
    failedLoginAttempts: { type: Number, required: true, default: 0 },
    lockedUntil: { type: Date },
    lastLoginAt: { type: Date },
    lastLoginIpHash: { type: String },
    passwordChangedAt: { type: Date },
    profile: { type: profileSchema, default: () => ({ skills: [] }) },
    deactivatedAt: { type: Date },
    deactivatedBy: { type: actorSchema },
    deactivationReason: text(300),
    createdBy: { type: actorSchema },
    updatedBy: { type: actorSchema },
  },
  { timestamps: true },
);

adminSchema.index({ email: 1 }, { unique: true });
adminSchema.index({ role: 1, status: 1 });
adminSchema.index({ status: 1, name: 1 });

declare module 'mongoose' {
  interface Models {
    Admin: Model<AdminDoc>;
  }
}

export const Admin: Model<AdminDoc> = models.Admin ?? model<AdminDoc>('Admin', adminSchema);
