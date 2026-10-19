import { connectToDatabase, mongoose } from '@/lib/db/mongoose';
import { assertCapability } from '@/lib/auth/guard';
import { Admin, AuditLog } from '@/models';
import type { SessionUser } from '@/types/session';
import { getActivity, type ActivityEntry } from '@/services/activity.service';

export interface AdminsDashboard {
  active: number;
  deactivated: number;
  superadmins: number;
  pendingPasswordChange: number;
  locked: number;
  failedSignIns7d: number;
  /** The last 30 days in the organisation's time zone, oldest first, zero-filled. */
  failuresByDay: Array<{ day: string; failures: number }>;
  lastSignIns: Array<{ id: string; name: string; lastLoginAt: string | null }>;
  recentActions: ActivityEntry[];
}

const DAY = 86_400_000;

/** Calendar days (YYYY-MM-DD) ending today in a zone, oldest first. */
export function lastDays(count: number, now: Date, timeZone: string): string[] {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return Array.from({ length: count }, (_, i) => fmt.format(new Date(now.getTime() - (count - 1 - i) * DAY)));
}

/** Account health at a glance. Superadmin-only (it reads sign-in failures and lockouts). */
export async function getAdminsDashboard(viewer: SessionUser, now = new Date(), timeZone = 'Asia/Kolkata'): Promise<AdminsDashboard> {
  assertCapability(viewer, 'admin:manage');
  await connectToDatabase();

  const [active, deactivated, superadmins, pending, locked, perDay, accounts, recentActions] = await Promise.all([
    Admin.countDocuments({ status: 'active' }),
    Admin.countDocuments({ status: 'deactivated' }),
    Admin.countDocuments({ status: 'active', role: 'superadmin' }),
    Admin.countDocuments({ status: 'active', mustChangePassword: true }),
    Admin.countDocuments({ status: 'active', lockedUntil: mongoose.trusted({ $gt: now }) }),
    AuditLog.aggregate<{ _id: string; n: number }>([
      { $match: { action: 'auth.login_failed', at: { $gte: new Date(now.getTime() - 31 * DAY) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$at', timezone: timeZone } }, n: { $sum: 1 } } },
    ]),
    Admin.find({ status: 'active' }).select('name lastLoginAt').sort({ lastLoginAt: -1, name: 1 }).lean(),
    getActivity({ actionPrefix: 'admin.' }, { limit: 8 }),
  ]);

  const counts = new Map(perDay.map((d) => [d._id, d.n]));
  const days = lastDays(30, now, timeZone);
  const failuresByDay = days.map((day) => ({ day, failures: counts.get(day) ?? 0 }));
  const failedSignIns7d = failuresByDay.slice(-7).reduce((s, d) => s + d.failures, 0);

  return {
    active,
    deactivated,
    superadmins,
    pendingPasswordChange: pending,
    locked,
    failedSignIns7d,
    failuresByDay,
    lastSignIns: accounts.map((a) => ({ id: String(a._id), name: a.name, lastLoginAt: a.lastLoginAt ? a.lastLoginAt.toISOString() : null })),
    recentActions,
  };
}
