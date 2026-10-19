import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieJar = new Map<string, string>();
vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), cache: <T,>(fn: T) => fn }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined) }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
const loadSessionUser = vi.fn();
vi.mock('./authenticate', () => ({ loadSessionUser: (...a: unknown[]) => loadSessionUser(...a) }));

import { requireAdminPage } from './page-guard';
import { sessionCookieName, signSession } from './token';

const user = (over: object = {}) => ({
  id: 'a'.repeat(24), name: 'Test', email: 't@example.com', role: 'admin', capabilities: new Set(['client:view']),
  mustChangePassword: false, tokenVersion: 0, stepUpValid: false, ...over,
});
const sign = async () => (await signSession({ id: 'a'.repeat(24), role: 'admin', tokenVersion: 0 })).token;

beforeEach(() => {
  cookieJar.clear();
  loadSessionUser.mockReset();
});

describe('requireAdminPage', () => {
  it('sends a visitor with no cookie to sign-in, remembering a SAFE return path', async () => {
    await expect(requireAdminPage('/admin/clients?tab=money')).rejects.toThrow('REDIRECT:/admin/login?next=%2Fadmin%2Fclients%3Ftab%3Dmoney');
    await expect(requireAdminPage('//evil.example/x')).rejects.toThrow(/REDIRECT:\/admin\/login\?next=%2F/);
    await expect(requireAdminPage()).rejects.toThrow('REDIRECT:/admin/login');
  });

  it('sends an unusable cookie through /admin/auth/clear (no redirect loop)', async () => {
    cookieJar.set(sessionCookieName(), 'garbage');
    await expect(requireAdminPage('/admin')).rejects.toThrow('REDIRECT:/admin/auth/clear?next=%2Fadmin');
    cookieJar.set(sessionCookieName(), await sign());
    loadSessionUser.mockResolvedValue(null); // revoked or deactivated since
    await expect(requireAdminPage('/admin')).rejects.toThrow('REDIRECT:/admin/auth/clear?next=%2Fadmin');
  });

  it('forces a pending password change first, unless the page is the change-password page', async () => {
    cookieJar.set(sessionCookieName(), await sign());
    loadSessionUser.mockResolvedValue(user({ mustChangePassword: true }));
    await expect(requireAdminPage('/admin')).rejects.toThrow('REDIRECT:/admin/account/password');
    await expect(requireAdminPage('/admin/account/password', { allowPasswordChangePending: true })).resolves.toMatchObject({ name: 'Test' });
  });

  it('hides a page the person has no capability for (404, not a forbidden page that confirms it exists)', async () => {
    cookieJar.set(sessionCookieName(), await sign());
    loadSessionUser.mockResolvedValue(user());
    await expect(requireAdminPage('/admin/admins', { capability: 'admin:manage' })).rejects.toThrow('NOT_FOUND');
    await expect(requireAdminPage('/admin/clients', { capability: 'client:view' })).resolves.toMatchObject({ role: 'admin' });
  });
});
