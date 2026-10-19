import { NextRequest } from 'next/server';
import type { AdminRole, Capability } from '@/config/capabilities';
import { loadSessionUser } from '@/lib/auth/authenticate';
import { hashPassword } from '@/lib/auth/password';
import { sessionCookieName, signSession } from '@/lib/auth/token';
import { Admin, type AdminDoc } from '@/models';
import type { SessionUser } from '@/types/session';

/** Passes the password policy for every test identity below. */
export const TEST_PASSWORD = 'correct-horse-battery-91';

let counter = 0;
const next = () => ++counter;

export interface AdminOverrides {
  name?: string;
  email?: string;
  role?: AdminRole;
  grants?: Capability[];
  status?: 'active' | 'deactivated';
  mustChangePassword?: boolean;
  password?: string;
}

export async function makeAdmin(o: AdminOverrides = {}): Promise<AdminDoc> {
  const n = next();
  const doc = await Admin.create({
    name: o.name ?? `Person ${n}`,
    email: o.email ?? `person${n}@example.com`,
    passwordHash: await hashPassword(o.password ?? TEST_PASSWORD),
    role: o.role ?? 'admin',
    grants: o.grants ?? [],
    status: o.status ?? 'active',
    mustChangePassword: o.mustChangePassword ?? false,
  });
  return doc.toObject();
}

export const makeSuperadmin = (o: AdminOverrides = {}) => makeAdmin({ ...o, role: 'superadmin' });

const inTenMinutes = () => Math.floor(Date.now() / 1000) + 600;

/**
 * The signed-in admin as the app sees them. `stepUp` mimics a session whose cookie carries
 * an open step-up window; step-up lives in the cookie, never on the account.
 */
export async function sessionFor(admin: Pick<AdminDoc, '_id'>, options: { stepUp?: boolean } = {}): Promise<SessionUser> {
  const fresh = await Admin.findById(admin._id).select('tokenVersion').lean();
  const user = await loadSessionUser({
    sub: String(admin._id),
    tv: fresh?.tokenVersion ?? 0,
    su: options.stepUp ? inTenMinutes() : undefined,
  });
  if (!user) throw new Error('sessionFor: admin is not active');
  return user;
}

/** A signed session cookie header value for an admin's CURRENT token version. */
export async function cookieFor(
  admin: Pick<AdminDoc, '_id' | 'role'>,
  options: { stepUp?: boolean; authTime?: number } = {},
): Promise<string> {
  const fresh = await Admin.findById(admin._id).select('tokenVersion role').lean();
  const { token } = await signSession(
    { id: String(admin._id), role: fresh?.role ?? admin.role, tokenVersion: fresh?.tokenVersion ?? 0 },
    { authTime: options.authTime, stepUpUntil: options.stepUp ? inTenMinutes() : undefined },
  );
  return `${sessionCookieName()}=${token}`;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  rawBody?: string;
  cookie?: string;
  headers?: Record<string, string>;
  ip?: string;
}

/** A request that looks like it came from our own site. Each call gets its own IP unless one is given. */
export function makeRequest(path: string, o: RequestOptions = {}): NextRequest {
  const method = o.method ?? (o.body !== undefined || o.rawBody !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = {
    'x-forwarded-for': o.ip ?? `198.51.100.${(next() % 250) + 1}`,
    ...(method !== 'GET' ? { 'sec-fetch-site': 'same-origin' } : {}),
    ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...(o.cookie ? { cookie: o.cookie } : {}),
    ...o.headers,
  };
  const body = o.rawBody ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined);
  return new NextRequest(`http://localhost:3050${path}`, { method, headers, body });
}

type Handler<P> = (request: NextRequest, context: { params: Promise<P> }) => Promise<Response>;

/** Calls a route handler directly and parses its JSON envelope. */
export async function call<P extends Record<string, string> = Record<string, string>>(
  handler: Handler<P>,
  path: string,
  options: RequestOptions = {},
  params = {} as P,
) {
  const response = await handler(makeRequest(path, options), { params: Promise.resolve(params) });
  const text = await response.text();
  let body: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON (redirects) */
  }
  const setCookie = response.headers.get('set-cookie') ?? '';
  const cookie = new RegExp(`${sessionCookieName()}=([^;]*)`).exec(setCookie)?.[1];
  return { status: response.status, body, headers: response.headers, setCookie, sessionCookieValue: cookie };
}
