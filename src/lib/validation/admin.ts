import { z } from 'zod';
import { ADMIN_ROLES } from '@/config/capabilities';
import { EMPLOYMENT_TYPES } from '@/config/statuses';
import { emailSchema, nameSchema, objectIdSchema } from './common';
import { newPasswordField } from './auth';

const grants = z.array(z.string().max(40)).max(40);

const profileSchema = z
  .object({
    phone: z.string().trim().max(30).optional(),
    jobRoleId: objectIdSchema.optional(),
    designation: z.string().trim().max(80).optional(),
    skills: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
    employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
    weeklyCapacityHours: z.number().int().min(1).max(80).optional(),
  })
  .strict();

export const createAdminSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  role: z.enum(ADMIN_ROLES, { error: 'Pick a role' }),
  grants: grants.default([]),
  /** The temporary password. The person must change it on first sign-in. */
  password: newPasswordField,
  profile: profileSchema.optional(),
});

export const updateAdminSchema = z
  .object({
    name: nameSchema.optional(),
    role: z.enum(ADMIN_ROLES).optional(),
    grants: grants.optional(),
    profile: profileSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'Nothing to update' });

export const resetPasswordSchema = z.object({ newPassword: newPasswordField });
export const reactivateSchema = z.object({ newPassword: newPasswordField });
export const deactivateSchema = z.object({
  reason: z.string({ error: 'Give a reason' }).trim().min(3, { error: 'Give a reason' }).max(300),
});

export type CreateAdminInput = z.infer<typeof createAdminSchema>;
export type UpdateAdminInput = z.infer<typeof updateAdminSchema>;
