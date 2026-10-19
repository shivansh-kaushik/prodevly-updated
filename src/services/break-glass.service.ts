import { clearRateLimit } from '@/lib/api/rate-limit';
import { hashPassword } from '@/lib/auth/password';
import { checkPasswordPolicy } from '@/lib/auth/password-policy';
import { connectToDatabase, withTransaction } from '@/lib/db/mongoose';
import { conflict, notFound, validationFailed } from '@/lib/api/errors';
import { Admin } from '@/models';
import { audit, SYSTEM_ACTOR } from './audit.service';

export interface BreakGlassInput {
  email: string;
  password: string;
  /** Required to touch a deactivated account: this must never quietly undo a deliberate removal. */
  reactivate?: boolean;
}

/**
 * Last-resort password reset for when no superadmin can sign in (the command-line script
 * is a thin wrapper). The account must set a new password at next sign-in, every session
 * ends, the lockout AND the sign-in rate-limit windows are cleared, and the change and its
 * audit entry commit together.
 */
export async function breakGlassReset(input: BreakGlassInput): Promise<{ name: string; email: string; reactivated: boolean }> {
  await connectToDatabase();
  const email = input.email.trim().toLowerCase();
  const admin = await Admin.findOne({ email }).select('name email role status').lean();
  if (!admin) throw notFound(`No admin with email ${email}`);
  if (admin.status !== 'active' && !input.reactivate) {
    throw conflict(`${admin.email} is deactivated. Pass --reactivate to bring the account back, or leave it removed.`);
  }
  const reason = checkPasswordPolicy(input.password, { email: admin.email, name: admin.name });
  if (reason) throw validationFailed({ password: reason });

  const passwordHash = await hashPassword(input.password);
  const reactivating = admin.status !== 'active';
  await withTransaction(async (session) => {
    const result = await Admin.updateOne(
      { _id: admin._id, status: admin.status },
      {
        $set: {
          passwordHash,
          passwordChangedAt: new Date(),
          mustChangePassword: true,
          failedLoginAttempts: 0,
          ...(reactivating ? { status: 'active' } : {}),
        },
        $unset: {
          lockedUntil: 1,
          ...(reactivating ? { deactivatedAt: 1, deactivatedBy: 1, deactivationReason: 1 } : {}),
        },
        $inc: { tokenVersion: 1 },
      },
      { session },
    );
    if (result.matchedCount !== 1) throw conflict('The account changed while resetting it. Run the command again.');
    await audit(
      {
        actor: { ...SYSTEM_ACTOR, name: 'Break-glass script' },
        action: reactivating ? 'admin.reactivate' : 'admin.reset_password',
        entity: { type: 'admin', id: String(admin._id), label: admin.name },
        summary: reactivating ? 'Reactivated and reset from the command line' : 'Reset from the command line',
        changes: reactivating ? [{ path: 'status', before: 'deactivated', after: 'active' }] : [],
      },
      session,
    );
  });

  // The owner may be blocked by the per-email limiter as well as by the account lockout.
  await clearRateLimit('admin:login:email', email);
  await clearRateLimit('admin:password', String(admin._id));
  await clearRateLimit('admin:step-up', String(admin._id));
  return { name: admin.name, email: admin.email, reactivated: reactivating };
}
