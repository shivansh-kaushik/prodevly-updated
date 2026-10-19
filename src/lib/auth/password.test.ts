import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('bcrypt cost', () => {
  it('is the minimum under test, so the suite stays fast', async () => {
    const { hashPassword } = await import('./password');
    expect(await hashPassword('correct-horse-battery-91')).toMatch(/^\$2[aby]\$04\$/);
  });

  it('is 12 in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { hashPassword, verifyPassword } = await import('./password');
    const hash = await hashPassword('correct-horse-battery-91');
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(await verifyPassword('correct-horse-battery-91', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('a malformed hash verifies as false instead of throwing', async () => {
    const { verifyPassword } = await import('./password');
    expect(await verifyPassword('anything', 'not-a-bcrypt-hash')).toBe(false);
  });
});
