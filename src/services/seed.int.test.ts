import { describe, expect, it, vi } from 'vitest';
import { loadSessionUser } from '@/lib/auth/authenticate';
import { verifyPassword } from '@/lib/auth/password';
import { Admin, AuditLog, Client, Settings } from '@/models';
import { login } from '@/services/auth.service';
import { readSeedEnv, runSeed, SUPERADMINS } from '@/services/seed.service';
import { setupTestDb } from '@/test/db';

setupTestDb();

const GOOD_ENV = {
  SEED_AMAN_EMAIL: 'aman@example.com',
  SEED_AMAN_PASSWORD: 'orchid-lantern-river-44',
  SEED_LAKSHYA_EMAIL: 'lakshya@example.com',
  SEED_LAKSHYA_PASSWORD: 'copper-meadow-harbor-58',
  SEED_SHIVANSH_EMAIL: 'shivansh@example.com',
  SEED_SHIVANSH_PASSWORD: 'velvet-anchor-summit-31',
};

describe('seed environment', () => {
  it('accepts a complete, valid environment', () => {
    const r = readSeedEnv(GOOD_ENV);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.accounts.map((a) => a.name)).toEqual(['Aman Gupta', 'Lakshya Sharma', 'Shivansh Kaushik']);
  });

  it('names every missing or weak variable and writes no code-level defaults', () => {
    const r = readSeedEnv({ SEED_AMAN_EMAIL: 'not-an-email', SEED_AMAN_PASSWORD: 'short', SEED_LAKSHYA_PASSWORD: GOOD_ENV.SEED_LAKSHYA_PASSWORD });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const text = r.errors.join('\n');
      expect(text).toMatch(/SEED_AMAN_EMAIL is not a valid/);
      expect(text).toMatch(/SEED_AMAN_PASSWORD: Use at least 12/);
      expect(text).toMatch(/SEED_LAKSHYA_EMAIL is missing/);
      expect(text).toMatch(/SEED_SHIVANSH_EMAIL is missing/);
      expect(text).toMatch(/SEED_SHIVANSH_PASSWORD is missing/);
    }
  });

  it('rejects duplicate emails and passwords that contain the person\'s name', () => {
    const dup = readSeedEnv({ ...GOOD_ENV, SEED_LAKSHYA_EMAIL: GOOD_ENV.SEED_AMAN_EMAIL });
    expect(dup.ok).toBe(false);
    const named = readSeedEnv({ ...GOOD_ENV, SEED_AMAN_PASSWORD: 'amans-secret-phrase-77' });
    expect(named.ok).toBe(false);
  });

  it('knows exactly the three required superadmins', () => {
    expect(SUPERADMINS.map((s) => s.name)).toEqual(['Aman Gupta', 'Lakshya Sharma', 'Shivansh Kaushik']);
  });
});

describe('runSeed', () => {
  const accounts = () => {
    const r = readSeedEnv(GOOD_ENV);
    if (!r.ok) throw new Error('bad env');
    return r.accounts;
  };

  it('creates three active superadmins who must change their password, plus settings and the internal client', async () => {
    const summary = await runSeed(accounts());
    expect(summary.superadmins.every((s) => s.created)).toBe(true);
    expect(summary.settingsCreated).toBe(true);
    expect(summary.internalClientCreated).toBe(true);

    const admins = await Admin.find({}).select('+passwordHash').lean();
    expect(admins).toHaveLength(3);
    for (const a of admins) {
      expect(a).toMatchObject({ role: 'superadmin', status: 'active', mustChangePassword: true, tokenVersion: 0 });
      expect(a.passwordHash).toMatch(/^\$2[aby]\$/);
    }
    expect(await Client.findOne({ isInternal: true }).lean()).toMatchObject({ name: 'ProDevly (internal)', ref: 'CL-0001' });
    expect(await Settings.countDocuments({})).toBe(1);
  });

  it('lets each seeded person sign in with their seed password', async () => {
    await runSeed(accounts());
    const signedIn = await login('aman@example.com', GOOD_ENV.SEED_AMAN_PASSWORD, { ipHash: 'x' });
    expect(signedIn.admin).toMatchObject({ name: 'Aman Gupta', role: 'superadmin', mustChangePassword: true });
    const sess = await loadSessionUser({ sub: signedIn.admin.id, tv: 0 });
    expect(sess?.capabilities.has('admin:manage')).toBe(true);
  });

  it('is idempotent and never overwrites an existing account\'s password', async () => {
    await runSeed(accounts());
    const before = await Admin.findOne({ email: 'aman@example.com' }).select('+passwordHash').lean();
    const again = await runSeed(accounts().map((a) => ({ ...a, password: 'a-completely-different-pw-99' })));

    expect(again.superadmins.every((s) => !s.created)).toBe(true);
    expect(again.settingsCreated).toBe(false);
    expect(again.internalClientCreated).toBe(false);
    expect(await Admin.countDocuments({})).toBe(3);
    expect(await Client.countDocuments({})).toBe(1);

    const after = await Admin.findOne({ email: 'aman@example.com' }).select('+passwordHash').lean();
    expect(after?.passwordHash).toBe(before?.passwordHash);
    expect(await verifyPassword(GOOD_ENV.SEED_AMAN_PASSWORD, after!.passwordHash)).toBe(true);
  });

  it('survives two seeds racing each other', async () => {
    await Promise.all([runSeed(accounts()), runSeed(accounts())]);
    expect(await Admin.countDocuments({})).toBe(3);
    expect(await Client.countDocuments({ isInternal: true })).toBe(1);
  });

  it('audits creation without writing any password', async () => {
    await runSeed(accounts());
    const entries = await AuditLog.find({ action: 'seed.superadmin_created' }).lean();
    expect(entries).toHaveLength(3);
    expect(JSON.stringify(await AuditLog.find({}).lean())).not.toMatch(/orchid-lantern|copper-meadow|velvet-anchor|\$2[aby]\$/);
  });

  it('never resurrects or promotes an account that was changed after seeding, and says so', async () => {
    await runSeed(accounts());
    await Admin.updateOne({ email: 'lakshya@example.com' }, { $set: { role: 'admin' } });
    await Admin.updateOne({ email: 'shivansh@example.com' }, { $set: { status: 'deactivated' } });
    const again = await runSeed(accounts());

    expect(await Admin.findOne({ email: 'lakshya@example.com' }).lean()).toMatchObject({ role: 'admin', status: 'active' });
    expect(await Admin.findOne({ email: 'shivansh@example.com' }).lean()).toMatchObject({ role: 'superadmin', status: 'deactivated' });
    const byEmail = Object.fromEntries(again.superadmins.map((a) => [a.email, a]));
    expect(byEmail['aman@example.com']?.warning).toBeUndefined();
    expect(byEmail['lakshya@example.com']?.warning).toMatch(/not a superadmin/);
    expect(byEmail['shivansh@example.com']?.warning).toMatch(/deactivated/);
  });

  it('writes an account and its audit entry together or not at all', async () => {
    vi.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('audit down'));
    await expect(runSeed(accounts())).rejects.toThrow('audit down');
    expect(await Admin.countDocuments({})).toBe(0);
    vi.restoreAllMocks();
    await runSeed(accounts()); // and a clean retry still works
    expect(await Admin.countDocuments({})).toBe(3);
  });
});
