import { describe, expect, it } from 'vitest';
import { resolvePeriod } from '@/lib/dates/ranges';
import { AuditLog } from '@/models';
import { getAuditDashboard } from '@/services/dashboards/audit';
import { actorOf, makeAuditEntries } from '@/test/audit-factories';
import { setupTestDb } from '@/test/db';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';

setupTestDb();

const NOW = new Date('2026-10-12T10:00:00Z'); // 12 Oct 15:30 in India
const ZONE = 'Asia/Kolkata';
const october = resolvePeriod({ period: 'this_month' }, NOW, { timeZone: ZONE });

async function seed() {
  const sa = await makeSuperadmin({ name: 'Sara Admin' });
  const alice = await makeAdmin({ name: 'Alice Rao' });
  const bob = await makeAdmin({ name: 'Bob Das' });
  await makeAuditEntries([
    // In October
    { at: '2026-10-12T08:00:00Z', actor: actorOf(alice), action: 'client.create', entity: { type: 'client' } },
    { at: '2026-10-12T09:00:00Z', actor: actorOf(alice), action: 'project.update', entity: { type: 'project' } },
    { at: '2026-10-11T20:00:00Z', actor: actorOf(bob), action: 'client.update', entity: { type: 'client' } }, // 12 Oct 01:30 in India
    { at: '2026-10-10T08:00:00Z', actor: actorOf(sa), action: 'admin.deactivate', entity: { type: 'admin' } },
    { at: '2026-10-09T08:00:00Z', actor: actorOf(sa), action: 'payment.void', entity: { type: 'payment' } },
    { at: '2026-10-08T08:00:00Z', action: 'auth.login_failed', entity: { type: 'admin' } }, // actor: System
    { at: '2026-10-07T08:00:00Z', action: 'auth.login_failed', entity: { type: 'admin' } },
    // Before October, inside the last 30 days
    { at: '2026-09-20T08:00:00Z', actor: actorOf(alice), action: 'client.create', entity: { type: 'client' } },
    // Before October, outside the last 30 days
    { at: '2026-08-01T08:00:00Z', actor: actorOf(sa), action: 'admin.create', entity: { type: 'admin' } },
  ]);
  return { sa, alice, bob, saS: await sessionFor(sa), aliceS: await sessionFor(alice) };
}

const perDay = (d: { actionsByDay: Array<{ day: string; actions: number }> }) => Object.fromEntries(d.actionsByDay.filter((x) => x.actions > 0).map((x) => [x.day, x.actions]));

describe('audit dashboard for a superadmin', () => {
  it('counts the actions and the sensitive ones in the period', async () => {
    const { saS } = await seed();
    const d = await getAuditDashboard(saS, october, { now: NOW, timeZone: ZONE });
    expect(d.scope).toBe('all');
    expect(d.actions).toBe(7);
    expect(d.sensitive).toEqual({ total: 4, adminManagement: 1, voids: 1, failedSignIns: 2 });
  });

  it('keeps entries outside the period out of the tiles (period bounds in the organisation zone)', async () => {
    const { saS } = await seed();
    // 1 Oct 00:00 in India is 30 Sep 18:30 UTC: one entry just inside, one just outside.
    await makeAuditEntries([
      { at: '2026-09-30T18:30:00Z', action: 'edge.first', entity: { type: 'edge' } },
      { at: '2026-09-30T18:29:59Z', action: 'edge.before', entity: { type: 'edge' } },
    ]);
    const d = await getAuditDashboard(saS, october, { now: NOW, timeZone: ZONE });
    expect(d.actions).toBe(8);
    expect(d.byEntityType.find((e) => e.type === 'edge')?.actions).toBe(1);
  });

  it('reads another period for the tiles without touching the 30-day chart', async () => {
    const { saS } = await seed();
    const september = resolvePeriod({ period: 'last_month' }, NOW, { timeZone: ZONE });
    const d = await getAuditDashboard(saS, september, { now: NOW, timeZone: ZONE });
    expect(d.actions).toBe(1);
    expect(d.sensitive).toEqual({ total: 0, adminManagement: 0, voids: 0, failedSignIns: 0 });
    expect(d.byPerson).toEqual([{ id: expect.any(String), name: 'Alice Rao', actions: 1 }]);
    // the chart is always the last 30 days, so October's entries are still in it
    expect(perDay(d)['2026-10-12']).toBe(3);
  });

  it('charts the last 30 days, oldest first, zero-filled, bucketed in the organisation zone', async () => {
    const { saS } = await seed();
    const d = await getAuditDashboard(saS, october, { now: NOW, timeZone: ZONE });
    expect(d.actionsByDay).toHaveLength(30);
    expect(d.actionsByDay[0]!.day).toBe('2026-09-13');
    expect(d.actionsByDay.at(-1)!.day).toBe('2026-10-12');
    // Bob's entry (11 Oct 20:00 UTC) is already 12 Oct in India; the 1 Aug entry is outside the window.
    expect(perDay(d)).toEqual({ '2026-09-20': 1, '2026-10-07': 1, '2026-10-08': 1, '2026-10-09': 1, '2026-10-10': 1, '2026-10-12': 3 });
    expect(d.actionsByDay.find((x) => x.day === '2026-10-11')?.actions).toBe(0);

    const utc = await getAuditDashboard(saS, october, { now: NOW, timeZone: 'UTC' });
    expect(perDay(utc)['2026-10-11']).toBe(1);
    expect(perDay(utc)['2026-10-12']).toBe(2);
  });

  it('falls back to the default zone when the setting is not a real zone', async () => {
    const { saS } = await seed();
    const d = await getAuditDashboard(saS, october, { now: NOW, timeZone: 'Not/AZone' });
    expect(perDay(d)['2026-10-12']).toBe(3);
  });

  it('ranks people by actions, telling people apart by id and the system by name', async () => {
    const { saS, alice } = await seed();
    const d = await getAuditDashboard(saS, october, { now: NOW, timeZone: ZONE });
    expect(d.byPerson.map((p) => [p.name, p.actions])).toEqual([
      ['Alice Rao', 2],
      ['Sara Admin', 2],
      ['System', 2],
      ['Bob Das', 1],
    ]);
    expect(d.byPerson[0]!.id).toBe(String(alice._id));
    expect(d.byPerson.find((p) => p.name === 'System')!.id).toBeNull();
  });

  it('does not merge two people who share a name', async () => {
    const { saS } = await seed();
    const twin = await makeAdmin({ name: 'Alice Rao' });
    await makeAuditEntries([{ at: '2026-10-12T07:00:00Z', actor: actorOf(twin), action: 'client.create', entity: { type: 'client' } }]);
    const d = await getAuditDashboard(saS, october, { now: NOW, timeZone: ZONE });
    expect(d.byPerson.filter((p) => p.name === 'Alice Rao').map((p) => p.actions).sort()).toEqual([1, 2]);
  });

  it('ranks record types and folds the tail into "other"', async () => {
    const { saS } = await seed();
    const d = await getAuditDashboard(saS, october, { now: NOW, timeZone: ZONE });
    expect(d.byEntityType).toEqual([
      { type: 'admin', actions: 3 },
      { type: 'client', actions: 2 },
      { type: 'payment', actions: 1 },
      { type: 'project', actions: 1 },
    ]);

    // ten more types, one entry each: 4 + 10 = 14 types, the top 8 are named and the other 6 are folded
    await makeAuditEntries(Array.from({ length: 10 }, (_, i) => ({ at: '2026-10-05T08:00:00Z', action: `t${i}.create`, entity: { type: `t${String(i).padStart(2, '0')}` } })));
    const many = await getAuditDashboard(saS, october, { now: NOW, timeZone: ZONE });
    expect(many.byEntityType).toHaveLength(9);
    expect(many.byEntityType.slice(0, 8).every((e) => e.type !== null)).toBe(true);
    expect(many.byEntityType.at(-1)).toEqual({ type: null, actions: 6 });
    expect(many.byEntityType.reduce((sum, e) => sum + e.actions, 0)).toBe(many.actions);
  });

  it('counts a row with missing parts under "unknown" instead of failing', async () => {
    const { saS } = await seed();
    await AuditLog.collection.insertOne({ at: new Date('2026-10-06T08:00:00Z'), action: 'legacy.thing', changes: [] });
    const d = await getAuditDashboard(saS, october, { now: NOW, timeZone: ZONE });
    expect(d.actions).toBe(8);
    expect(d.byPerson.find((p) => p.name === 'Unknown')).toEqual({ id: null, name: 'Unknown', actions: 1 });
    expect(d.byEntityType.find((e) => e.type === 'unknown')).toEqual({ type: 'unknown', actions: 1 });
  });

  it('counts a void once even when two categories would claim it', async () => {
    const { saS } = await seed();
    // "admin.void" is both account management and a void
    await makeAuditEntries([{ at: '2026-10-06T08:00:00Z', action: 'admin.void', entity: { type: 'admin' } }]);
    const d = await getAuditDashboard(saS, october, { now: NOW, timeZone: ZONE });
    expect(d.sensitive).toEqual({ total: 5, adminManagement: 2, voids: 2, failedSignIns: 2 });
  });
});

describe('audit dashboard for everyone else', () => {
  it('scopes every figure to the viewer\'s own entries', async () => {
    const { aliceS } = await seed();
    const d = await getAuditDashboard(aliceS, october, { now: NOW, timeZone: ZONE });
    expect(d.scope).toBe('own');
    expect(d.actions).toBe(2); // not the 7 in the whole log
    expect(d.sensitive).toEqual({ total: 0, adminManagement: 0, voids: 0, failedSignIns: 0 });
    expect(d.byEntityType).toEqual([
      { type: 'client', actions: 1 },
      { type: 'project', actions: 1 },
    ]);
    expect(perDay(d)).toEqual({ '2026-09-20': 1, '2026-10-12': 2 });
  });

  it('does not rank people for a viewer who may only see themselves', async () => {
    const { aliceS } = await seed();
    expect((await getAuditDashboard(aliceS, october, { now: NOW, timeZone: ZONE })).byPerson).toEqual([]);
  });

  it('does not count a failed sign-in as the viewer\'s own action (it is recorded under the system)', async () => {
    const { aliceS } = await seed();
    expect((await getAuditDashboard(aliceS, october, { now: NOW, timeZone: ZONE })).sensitive.failedSignIns).toBe(0);
  });

  it('shows a plain admin their sensitive actions when they have any', async () => {
    const { aliceS, alice } = await seed();
    await makeAuditEntries([{ at: '2026-10-11T08:00:00Z', actor: actorOf(alice), action: 'task.void', entity: { type: 'task' } }]);
    const d = await getAuditDashboard(aliceS, october, { now: NOW, timeZone: ZONE });
    expect(d.sensitive).toMatchObject({ total: 1, voids: 1 });
    expect(d.actions).toBe(3);
  });
});

describe('audit dashboard on an empty log', () => {
  it('answers zeros and empty lists, never a missing figure', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const d = await getAuditDashboard(sa, october, { now: NOW, timeZone: ZONE });
    expect(d).toMatchObject({
      scope: 'all',
      actions: 0,
      sensitive: { total: 0, adminManagement: 0, voids: 0, failedSignIns: 0 },
      byPerson: [],
      byEntityType: [],
    });
    expect(d.actionsByDay).toHaveLength(30);
    expect(d.actionsByDay.every((x) => x.actions === 0)).toBe(true);
  });

  it('answers zeros for a person with no entries of their own, even when the log is busy', async () => {
    const { saS } = await seed();
    const quiet = await sessionFor(await makeAdmin({ name: 'Quiet Person' }));
    const d = await getAuditDashboard(quiet, october, { now: NOW, timeZone: ZONE });
    expect(d.actions).toBe(0);
    expect(d.byEntityType).toEqual([]);
    expect(d.actionsByDay.every((x) => x.actions === 0)).toBe(true);
    expect((await getAuditDashboard(saS, october, { now: NOW, timeZone: ZONE })).actions).toBeGreaterThan(0);
  });
});
