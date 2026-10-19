import type { AdminDoc } from '@/models';

/**
 * DTO mappers: the ONLY shape that leaves the server. Password hashes, token
 * versions, step-up state and IP hashes never appear here.
 */
export interface AdminDTO {
  id: string;
  name: string;
  email: string;
  role: AdminDoc['role'];
  grants: AdminDoc['grants'];
  status: AdminDoc['status'];
  mustChangePassword: boolean;
  locked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  profile: {
    phone: string | null;
    jobRoleId: string | null;
    designation: string | null;
    skills: string[];
    employmentType: string | null;
    weeklyCapacityHours: number | null;
  };
  deactivatedAt: string | null;
  deactivatedBy: string | null;
  deactivationReason: string | null;
}

type AdminLike = Pick<
  AdminDoc,
  | '_id'
  | 'name'
  | 'email'
  | 'role'
  | 'grants'
  | 'status'
  | 'mustChangePassword'
  | 'lockedUntil'
  | 'lastLoginAt'
  | 'createdAt'
  | 'profile'
  | 'deactivatedAt'
  | 'deactivatedBy'
  | 'deactivationReason'
>;

export function toAdminDTO(a: AdminLike): AdminDTO {
  return {
    id: String(a._id),
    name: a.name,
    email: a.email,
    role: a.role,
    grants: a.grants ?? [],
    status: a.status,
    mustChangePassword: a.mustChangePassword,
    locked: Boolean(a.lockedUntil && a.lockedUntil.getTime() > Date.now()),
    lastLoginAt: a.lastLoginAt ? a.lastLoginAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
    profile: {
      phone: a.profile?.phone ?? null,
      jobRoleId: a.profile?.jobRoleId ? String(a.profile.jobRoleId) : null,
      designation: a.profile?.designation ?? null,
      skills: a.profile?.skills ?? [],
      employmentType: a.profile?.employmentType ?? null,
      weeklyCapacityHours: a.profile?.weeklyCapacityHours ?? null,
    },
    deactivatedAt: a.deactivatedAt ? a.deactivatedAt.toISOString() : null,
    deactivatedBy: a.deactivatedBy?.name ?? null,
    deactivationReason: a.deactivationReason ?? null,
  };
}
