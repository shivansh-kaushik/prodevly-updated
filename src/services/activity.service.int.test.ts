import { describe, expect, it } from 'vitest';
import { AuditLog } from '@/models';
import { audit } from '@/services/audit.service';
import { getActivity } from '@/services/activity.service';
import { searchAdmins } from '@/services/admin.service';
import { makeAdmin } from '@/test/factories';
import { newId } from '@/test/domain-factories';
import { setupTestDb } from '@/test/db';

setupTestDb();

const actor = (name = 'Aman Gupta') => ({ id: String(newId()), name });

describe('getActivity', () => {
  it('filters by entity, actor, context and action prefix, newest first', async () => {
    const entity = newId();
    const project = newId();
    const a = actor();
    await audit({ actor: a, action: 'client.create', entity: { type: 'client', id: String(entity), label: 'Acme' } });
    await audit({ actor: a, action: 'payment.record', entity: { type: 'payment' }, context: { projectId: String(project) } });
    await audit({ actor: actor('Someone Else'), action: 'payment.void', entity: { type: 'payment' }, context: { projectId: String(project) } });

    expect((await getActivity({ entityType: 'client', entityId: String(entity) })).map((e) => e.action)).toEqual(['client.create']);
    expect((await getActivity({ projectId: String(project) })).map((e) => e.action)).toEqual(['payment.void', 'payment.record']);
    expect((await getActivity({ actorId: a.id })).map((e) => e.action)).toEqual(['payment.record', 'client.create']);
    expect((await getActivity({ actionPrefix: 'payment.' })).length).toBe(2);
    expect(await getActivity({ actionPrefix: 'pay.ment' })).toEqual([]); // the prefix is literal
  });

  it('pages with `before` and caps the limit, and returns redacted changes only', async () => {
    for (let i = 0; i < 5; i++) {
      await audit({ actor: actor(), action: 'client.update', entity: { type: 'client' }, changes: [{ path: 'passwordHash', before: 'x', after: 'y' }] });
    }
    const first = await getActivity({}, { limit: 2 });
    expect(first).toHaveLength(2);
    const older = await getActivity({}, { limit: 10, before: new Date(first[1]!.at) });
    expect(older.length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(first)).not.toContain('"x"');
    expect(await AuditLog.countDocuments({})).toBe(5);
  });

  it('ignores a malformed id instead of matching everything', async () => {
    await audit({ actor: actor(), action: 'client.create', entity: { type: 'client' } });
    expect((await getActivity({ entityId: 'not-an-id' })).length).toBe(1); // dropped filter, not an error
  });
});

describe('searchAdmins', () => {
  it('filters by text, status and role, and sorts', async () => {
    await makeAdmin({ name: 'Zoya Khan', email: 'zoya@example.com' });
    await makeAdmin({ name: 'Arun Das', email: 'arun@example.com', status: 'deactivated' });
    await makeAdmin({ name: 'Mira Rao', email: 'mira@example.com', role: 'superadmin' });
    expect((await searchAdmins({})).map((a) => a.name)).toEqual(['Arun Das', 'Mira Rao', 'Zoya Khan']);
    expect((await searchAdmins({ q: 'zoy' })).map((a) => a.name)).toEqual(['Zoya Khan']);
    expect((await searchAdmins({ status: 'deactivated' })).map((a) => a.name)).toEqual(['Arun Das']);
    expect((await searchAdmins({ role: 'superadmin' })).map((a) => a.name)).toEqual(['Mira Rao']);
    expect((await searchAdmins({ sort: 'name', dir: 'desc' })).map((a) => a.name)).toEqual(['Zoya Khan', 'Mira Rao', 'Arun Das']);
    expect(await searchAdmins({ q: '.*' })).toEqual([]); // literal, not a pattern
  });
});
