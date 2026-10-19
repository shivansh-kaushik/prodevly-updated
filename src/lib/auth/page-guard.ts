import { cache } from 'react';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { Capability } from '@/config/capabilities';
import type { SessionUser } from '@/types/session';
import { loadSessionUser } from './authenticate';
import { safeNextPath } from './safe-next-path';
import { sessionCookieName, verifySession } from './token';

/**
 * Authorisation for Server Components (admin pages and layouts).
 *
 * `cache()` dedupes the database read per request, so a layout and a page that
 * both call this pay for one round-trip. Layouts do NOT re-run on client
 * navigation, so every page calls `requireAdminPage` itself.
 */
export const getCurrentAdmin = cache(async (): Promise<{ admin: SessionUser | null; hadCookie: boolean }> => {
  const raw = (await cookies()).get(sessionCookieName())?.value;
  if (!raw) return { admin: null, hadCookie: false };
  const payload = await verifySession(raw);
  if (!payload) return { admin: null, hadCookie: true };
  return { admin: await loadSessionUser(payload), hadCookie: true };
});

/**
 * Returns the signed-in admin or redirects. No cookie goes to the sign-in page; a
 * cookie that no longer works (expired, revoked, account removed) goes through
 * `/admin/auth/clear`, which deletes it, so there is no redirect loop.
 */
export async function requireAdminPage(
  returnTo?: string,
  options: { capability?: Capability; allowPasswordChangePending?: boolean } = {},
): Promise<SessionUser> {
  const { admin, hadCookie } = await getCurrentAdmin();
  const next = returnTo ? `?next=${encodeURIComponent(safeNextPath(returnTo))}` : '';
  if (!admin) redirect(`${hadCookie ? '/admin/auth/clear' : '/admin/login'}${next}`);
  if (admin.mustChangePassword && !options.allowPasswordChangePending) redirect('/admin/account/password');
  // Hide what the person cannot use, rather than showing a "forbidden" page that confirms it exists.
  if (options.capability && !admin.capabilities.has(options.capability)) notFound();
  return admin;
}
