import { z } from 'zod';
import { emailSchema } from './common';

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ error: 'Password is required' }).min(1, { error: 'Password is required' }).max(200),
});

// New passwords are checked by `checkPasswordPolicy` (it needs the person's name and email),
// so here we only bound the size.
const newPassword = z.string({ error: 'Password is required' }).min(1, { error: 'Password is required' }).max(200);

export const changePasswordSchema = z.object({
  currentPassword: z.string({ error: 'Enter your current password' }).min(1, { error: 'Enter your current password' }).max(200),
  newPassword,
});

export const stepUpSchema = z.object({
  password: z.string({ error: 'Password is required' }).min(1, { error: 'Password is required' }).max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export { newPassword as newPasswordField };
