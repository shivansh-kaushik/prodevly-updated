import { Types } from 'mongoose';
import { effectiveCapabilities } from '@/config/capabilities';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Admin } from '@/models';
import type { SessionUser } from '@/types/session';
import { stepUpActive, type SessionPayload } from './token';

/**
 * Turns verified token claims into the signed-in admin, FROM THE DATABASE.
 *
 * This is the real authorisation boundary. It confirms the account still exists,
 * is still active and that the token has not been revoked, and it computes the
 * capabilities fresh from role and grants, so a change applies on the person's
 * next request. Returns null for anything wrong (never throws for a bad token).
 */
export async function loadSessionUser(payload: Pick<SessionPayload, 'sub' | 'tv' | 'su'>): Promise<SessionUser | null> {
  if (!Types.ObjectId.isValid(payload.sub)) return null;
  await connectToDatabase();
  const admin = await Admin.findById(payload.sub)
    .select('name email role grants status tokenVersion mustChangePassword')
    .lean();
  if (!admin || admin.status !== 'active') return null;
  if (admin.tokenVersion !== payload.tv) return null;
  return {
    id: String(admin._id),
    name: admin.name,
    email: admin.email,
    role: admin.role,
    capabilities: effectiveCapabilities(admin.role, admin.grants),
    mustChangePassword: admin.mustChangePassword,
    tokenVersion: admin.tokenVersion,
    stepUpValid: stepUpActive(payload),
  };
}
