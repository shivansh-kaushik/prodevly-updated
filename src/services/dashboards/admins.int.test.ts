import { describe, expect, it } from 'vitest';
import { AuditLog, Admin } from '@/models';
import { audit } from '@/services/audit.service';
import { getAdminsDashboard, lastDays } from '@/services/dashboards/admins';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { setupTestDb } from '@/test/db';

setupTestDb();

describe('lastDays', () => {
  it('counts back in the organisation zone, oldest first', () => {
    // 20:00 UTC on 11 Oct is already 12 Oct in India
    expect(lastDays(3, new Date('2026-10-11T20:00:00Z'), 'Asia/Kolkata')).toEqual(['2026-10-10', '2026-10-11', '2026-10-12']);
    expect(lastDays(3, new Date('2026-10-11T20:00:00Z'), 'UTC')).toEqual(['2026-10-09', '2026-10-10', '2026-10-11']);
  });
});

describe('admins dashboard', () => {
  it('is for superadmins only', async () => {
    const plain = await sessionFor(await makeAdmin());
    await expect(getAdminsDashboard(plain)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('counts accounts, pending changes, lockouts and failed sign-ins, and zero-fills the days', async () => {
    const now = new Date('2026-10-12T10:00:00Z');
    const sa = await makeSuperadmin();
    const locked = await makeAdmin();
    await makeAdmin({ mustChangePassword: true });
    await makeAdmin({ status: 'deactivated' });
    await Admin.updateOne({ _id: locked._id }, { $set: { lockedUntil: new Date(now.getTime() + 60_000) } });

    // Insert with chosen timestamps directly: audit() stamps "now", and the model refuses rewrites.
    const base = { actor: { id: null, name: 'System' }, action: 'auth.login_failed', entity: { type: 'admin' }, changes: [], context: {} };
    for (const at of ['2026-10-12T08:00:00Z', '2026-10-12T09:00:00Z', '2026-10-10T08:00:00Z', '2026-08-01T08:00:00Z']) {
      await AuditLog.collection.insertOne({ ...base, at: new Date(at) });
    }
    await audit({ actor: { id: String(sa._id), name: sa.name }, action: 'admin.create', entity: { type: 'admin', label: 'Someone' } });

    const d = await getAdminsDashboard(await sessionFor(sa), now);
    expect(d).toMatchObject({ active: 3, deactivated: 1, superadmins: 1, pendingPasswordChange: 1, locked: 1 });
    expect(d.failuresByDay).toHaveLength(30);
    expect(d.failuresByDay.at(-1)).toEqual({ day: '2026-10-12', failures: 2 });
    expect(d.failuresByDay.find((x) => x.day === '2026-10-10')?.failures).toBe(1);
    expect(d.failuresByDay.find((x) => x.day === '2026-10-11')?.failures).toBe(0);
    expect(d.failedSignIns7d).toBe(3);
    expect(d.recentActions.map((a) => a.action)).toEqual(['admin.create']);
    expect(d.lastSignIns).toHaveLength(3);
  });
});
