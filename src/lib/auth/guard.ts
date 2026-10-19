import type { NextRequest } from 'next/server';
import type { Capability } from '@/config/capabilities';
import { forbidden, passwordChangeRequired, stepUpRequired, unauthorized } from '@/lib/api/errors';
import type { SessionUser } from '@/types/session';
import { loadSessionUser } from './authenticate';
import { sessionCookieName, verifySession, type SessionPayload } from './token';

/**
 * Request-based authorisation for Route Handlers. Every admin API goes through
 * `authenticateRequest` (via `adminRoute`), which re-checks the database.
 */
export interface Authenticated {
  admin: SessionUser;
  payload: SessionPayload;
}

export async function authenticateRequest(request: NextRequest): Promise<Authenticated> {
  const token = request.cookies.get(sessionCookieName())?.value;
  if (!token) throw unauthorized();
  const payload = await verifySession(token);
  if (!payload) throw unauthorized('Your session has expired. Please sign in again.');
  const admin = await loadSessionUser(payload);
  if (!admin) throw unauthorized('Your session has expired. Please sign in again.');
  return { admin, payload };
}

export function assertCapability(admin: SessionUser, capability: Capability): void {
  if (!admin.capabilities.has(capability)) throw forbidden('Your access does not allow this action');
}

/** A seeded or reset account can do nothing but set a new password until it has. */
export function assertPasswordCurrent(admin: SessionUser): void {
  if (admin.mustChangePassword) throw passwordChangeRequired();
}

/** Sensitive actions need the person to have re-entered their password in the last 10 minutes. */
export function assertStepUp(admin: SessionUser): void {
  if (!admin.stepUpValid) throw stepUpRequired();
}
