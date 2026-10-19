import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { resolvePeriod } from '@/lib/dates/ranges';
import { parseAuditSearch } from '@/lib/validation/audit';
import { AuditLog } from '@/models';
import { audit } from '@/services/audit.service';
import { buildFilter, getAuditFilterOptions, groupAuditByDay, listAudit, resolveAuditFilterLabels, scopeFilter } from '@/services/audit-log.service';
import { actorOf, makeAuditEntries, makeAuditEntry } from '@/test/audit-factories';
import { setupTestDb } from '@/test/db';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { makeClient, makeProject, newId } from '@/test/domain-factories';

setupTestDb();

/** A superadmin, two plain admins and a mixed trail: theirs, each other's and the system's. */
async function seedTrail() {
  const sa = await makeSuperadmin({ name: 'Sara Admin' });
  const alice = await makeAdmin({ name: 'Alice Rao' });
  const bob = await makeAdmin({ name: 'Bob Das' });
  await makeAuditEntries([
    { at: '2026-10-01T10:00:00Z', actor: actorOf(alice), action: 'client.create', entity: { type: 'client', label: 'Acme Traders', ref: 'CL-0001' } },
    { at: '2026-10-02T10:00:00Z', actor: actorOf(alice), action: 'project.update', entity: { type: 'project', label: 'Shop redesign' } },
    { at: '2026-10-03T10:00:00Z', actor: actorOf(bob), action: 'client.create', entity: { type: 'client', label: 'Bob client' } },
    { at: '2026-10-04T10:00:00Z', actor: actorOf(sa), action: 'admin.deactivate', entity: { type: 'admin', label: 'Someone' } },
    { at: '2026-10-05T10:00:00Z', action: 'auth.login_failed', entity: { type: 'admin', label: 'Alice Rao' }, summary: 'Wrong password' },
  ]);
  return { sa, alice, bob, saS: await sessionFor(sa), aliceS: await sessionFor(alice), bobS: await sessionFor(bob) };
}

describe('who sees which entries', () => {
  it('shows a superadmin everything, newest first', async () => {
    const { saS } = await seedTrail();
    const page = await listAudit(saS, {});
    expect(page.scope).toBe('all');
    expect(page.meta.total).toBe(5);
    expect(page.entries.map((e) => e.action)).toEqual(['auth.login_failed', 'admin.deactivate', 'client.create', 'project.update', 'client.create']);
  });

  it('shows everyone else only their own entries', async () => {
    const { aliceS, bobS } = await seedTrail();
    const alice = await listAudit(aliceS, {});
    expect(alice.scope).toBe('own');
    expect(alice.meta.total).toBe(2);
    expect(alice.entries.every((e) => e.actorName === 'Alice Rao' && e.actorId === aliceS.id)).toBe(true);
    const bob = await listAudit(bobS, {});
    expect(bob.entries.map((e) => e.entity.label)).toEqual(['Bob client']);
  });

  it('ignores an actor filter from someone who cannot see everyone: they still get their own entries', async () => {
    const { aliceS, bobS } = await seedTrail();
    const asked = await listAudit(aliceS, { actorId: bobS.id });
    expect(asked.meta.total).toBe(2);
    expect(asked.entries.every((e) => e.actorId === aliceS.id)).toBe(true);
    // upper-case spelling of the same id is no way round it either
    const upper = await listAudit(aliceS, { actorId: bobS.id.toUpperCase() });
    expect(upper.entries.every((e) => e.actorId === aliceS.id)).toBe(true);
  });

  it('keeps the pin when other filters or free text are used', async () => {
    const { aliceS } = await seedTrail();
    // Bob's entry is the only "Bob client"; Alice must not find it by searching for it.
    expect((await listAudit(aliceS, { q: 'Bob client' })).entries).toEqual([]);
    expect((await listAudit(aliceS, { entityType: 'client', action: 'client.' })).entries.map((e) => e.entity.label)).toEqual(['Acme Traders']);
    // the system's failed sign-in (about Alice's account) is not Alice's entry
    expect((await listAudit(aliceS, { action: 'auth.' })).entries).toEqual([]);
  });

  it('lets a superadmin pick a person', async () => {
    const { saS, bobS } = await seedTrail();
    const page = await listAudit(saS, { actorId: bobS.id });
    expect(page.entries.map((e) => e.actorName)).toEqual(['Bob Das']);
    expect((await listAudit(saS, { actorId: String(newId()) })).entries).toEqual([]);
  });

  it('builds the scope from the viewer alone', async () => {
    const { saS, aliceS } = await seedTrail();
    expect(scopeFilter(saS)).toEqual({});
    expect(scopeFilter(aliceS)).toEqual({ 'actor.id': new Types.ObjectId(aliceS.id) });
  });

  it('only superadmins hold audit:viewAll, so a plain admin is scoped even with every grant', async () => {
    const granted = await makeAdmin({ grants: ['payment:view', 'worklog:viewAll', 'export:data'] });
    const s = await sessionFor(granted);
    expect(s.capabilities.has('audit:viewAll')).toBe(false);
    expect((await listAudit(s, {})).scope).toBe('own');
  });
});

describe('filters', () => {
  it('matches an action prefix literally, from the start', async () => {
    const { saS } = await seedTrail();
    await makeAuditEntries([
      { action: 'payment.record', entity: { type: 'payment' } },
      { action: 'payment.void', entity: { type: 'payment' } },
      { action: 'clientPayment.void', entity: { type: 'clientPayment' } },
    ]);
    const actions = async (action: string) => (await listAudit(saS, { action })).entries.map((e) => e.action).sort();
    expect(await actions('payment.')).toEqual(['payment.record', 'payment.void']);
    expect(await actions('payment.void')).toEqual(['payment.void']);
    expect(await actions('pay.ment')).toEqual([]); // the dot is a dot, not "any character"
    expect(await actions('ayment.')).toEqual([]); // a prefix, not "contains"
  });

  it('filters by record type, client and project', async () => {
    const { saS } = await seedTrail();
    const client = await makeClient();
    const project = await makeProject(client);
    const otherProject = await makeProject(client);
    await makeAuditEntries([
      { action: 'task.create', entity: { type: 'task' }, context: { clientId: client._id, projectId: project._id } },
      { action: 'task.update', entity: { type: 'task' }, context: { clientId: client._id, projectId: otherProject._id } },
      { action: 'payment.record', entity: { type: 'payment' }, context: { clientId: client._id, projectId: project._id } },
    ]);
    expect((await listAudit(saS, { entityType: 'task' })).meta.total).toBe(2);
    expect((await listAudit(saS, { clientId: String(client._id) })).meta.total).toBe(3);
    expect((await listAudit(saS, { projectId: String(project._id) })).entries.map((e) => e.action).sort()).toEqual(['payment.record', 'task.create']);
    expect((await listAudit(saS, { projectId: String(project._id), entityType: 'task' })).entries.map((e) => e.action)).toEqual(['task.create']);
    expect((await listAudit(saS, { clientId: String(client._id).toUpperCase() })).meta.total).toBe(3);
  });

  it('searches text literally: person, action, summary, record name and reference, and the request id exactly', async () => {
    const { saS } = await seedTrail();
    await makeAuditEntry({ action: 'client.note', entity: { type: 'client', label: 'Dot.Com (India) [Pvt]' }, summary: 'Spoke about 100% fixed pricing', requestId: 'req-8f3a-00aa' });
    const hits = async (q: string) => (await listAudit(saS, { q })).entries.map((e) => e.entity.label ?? e.action);
    expect(await hits('acme')).toEqual(['Acme Traders']); // case-insensitive, by label
    expect(await hits('CL-0001')).toEqual(['Acme Traders']); // by reference
    expect(await hits('alice rao')).toEqual(['Alice Rao', 'Shop redesign', 'Acme Traders']); // by actor name, and the failed sign-in about her
    expect(await hits('wrong pass')).toEqual(['Alice Rao']); // by summary
    expect(await hits('deactivate')).toEqual(['Someone']); // by action
    expect(await hits('(India) [Pvt]')).toEqual(['Dot.Com (India) [Pvt]']); // metacharacters are text
    expect(await hits('100%')).toEqual(['Dot.Com (India) [Pvt]']);
    expect(await hits('.*')).toEqual([]); // not a pattern
    expect(await hits('Dot.*Com')).toEqual([]);
    expect(await hits('req-8f3a-00aa')).toEqual(['Dot.Com (India) [Pvt]']); // exact request id
    expect(await hits('req-8f3a')).toEqual([]); // a request id is not searched by prefix
  });

  it('treats an operator-shaped search or action as text, never as a query', async () => {
    const { saS } = await seedTrail();
    // Typed as unknown to prove a hostile object cannot get through the schema.
    await expect(listAudit(saS, { q: { $ne: '' } as unknown as string })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(listAudit(saS, { action: '{"$ne":1}' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(listAudit(saS, { entityType: 'client$' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await listAudit(saS, { q: '$ne' })).entries).toEqual([]);
  });

  it('narrows to sensitive actions: account management, voids and failed sign-ins', async () => {
    const { saS } = await seedTrail();
    await makeAuditEntries([
      { action: 'payment.void', entity: { type: 'payment' } },
      { action: 'expense.void', entity: { type: 'expense' } },
      { action: 'payment.record', entity: { type: 'payment' } },
      { action: 'auth.login', entity: { type: 'admin' } },
      { action: 'avoid.thing', entity: { type: 'thing' } }, // "void" inside a word is not a void
    ]);
    const sensitive = (await listAudit(saS, { sensitive: true })).entries.map((e) => e.action).sort();
    expect(sensitive).toEqual(['admin.deactivate', 'auth.login_failed', 'expense.void', 'payment.void']);
    // combined with a prefix, both must hold
    expect((await listAudit(saS, { sensitive: true, action: 'payment.' })).entries.map((e) => e.action)).toEqual(['payment.void']);
  });

  it('rejects malformed ids and an inverted period instead of matching everything', async () => {
    const { saS } = await seedTrail();
    await expect(listAudit(saS, { clientId: 'not-an-id' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', fields: { clientId: expect.any(String) } });
    await expect(listAudit(saS, { actorId: '123' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(listAudit(saS, { from: new Date('2026-10-02'), to: new Date('2026-10-01') })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', fields: { to: expect.any(String) } });
    await expect(listAudit(saS, { from: new Date('nonsense') })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('period bounds in the organisation zone', () => {
  it('includes the first instant of the month in India and excludes the first instant after it', async () => {
    const { saS } = await seedTrail();
    // 1 Oct 2026 00:00 in India is 30 Sep 18:30 UTC.
    await makeAuditEntries([
      { at: '2026-09-30T18:29:59Z', action: 'edge.before', entity: { type: 'edge' } },
      { at: '2026-09-30T18:30:00Z', action: 'edge.first', entity: { type: 'edge' } },
      { at: '2026-10-31T18:29:59Z', action: 'edge.last', entity: { type: 'edge' } },
      { at: '2026-10-31T18:30:00Z', action: 'edge.after', entity: { type: 'edge' } },
    ]);
    const period = resolvePeriod({ period: 'this_month' }, new Date('2026-10-12T10:00:00Z'), { timeZone: 'Asia/Kolkata' });
    const page = await listAudit(saS, { entityType: 'edge', from: period.fromInstant, to: period.toInstant });
    expect(page.entries.map((e) => e.action)).toEqual(['edge.last', 'edge.first']);
    // the same month read in UTC would have started 5.5 hours later
    const utc = resolvePeriod({ period: 'this_month' }, new Date('2026-10-12T10:00:00Z'), { timeZone: 'UTC' });
    expect((await listAudit(saS, { entityType: 'edge', from: utc.fromInstant, to: utc.toInstant })).entries.map((e) => e.action)).toEqual(['edge.after', 'edge.last']);
  });

  it('accepts an open-ended range', async () => {
    const { saS } = await seedTrail();
    expect((await listAudit(saS, { from: new Date('2026-10-04T00:00:00Z') })).meta.total).toBe(2);
    expect((await listAudit(saS, { to: new Date('2026-10-02T00:00:00Z') })).meta.total).toBe(1);
  });
});

describe('pagination', () => {
  it('pages newest first, reports the totals and never repeats or skips a row', async () => {
    const { saS } = await seedTrail();
    // three entries share one millisecond: their order must still be fixed
    const tie = '2026-11-01T09:00:00Z';
    await makeAuditEntries([
      { at: tie, action: 'tie.one', entity: { type: 'tie' } },
      { at: tie, action: 'tie.two', entity: { type: 'tie' } },
      { at: tie, action: 'tie.three', entity: { type: 'tie' } },
    ]);
    const full = await listAudit(saS, {}, { pageSize: 100 });
    expect(full.meta).toMatchObject({ total: 8, pages: 1, from: 1, to: 8 });

    const seen: string[] = [];
    for (let p = 1; p <= 3; p++) {
      const page = await listAudit(saS, {}, { page: p, pageSize: 3 });
      expect(page.meta).toMatchObject({ page: p, pageSize: 3, total: 8, pages: 3 });
      seen.push(...page.entries.map((e) => e.id));
    }
    expect(seen).toEqual(full.entries.map((e) => e.id));
    expect(new Set(seen).size).toBe(8);
    expect(full.entries.slice(0, 3).map((e) => e.action)).toEqual(['tie.three', 'tie.two', 'tie.one']);

    const last = await listAudit(saS, {}, { page: 3, pageSize: 3 });
    expect(last.meta).toMatchObject({ from: 7, to: 8 });
    expect(last.entries).toHaveLength(2);
  });

  it('answers the last page for a page past the end, and clamps odd sizes', async () => {
    const { saS } = await seedTrail();
    const beyond = await listAudit(saS, {}, { page: 99, pageSize: 2 });
    expect(beyond.meta).toMatchObject({ page: 3, pages: 3, total: 5 });
    expect(beyond.entries).toHaveLength(1);
    expect((await listAudit(saS, {}, { page: 0, pageSize: 2 })).meta.page).toBe(1);
    expect((await listAudit(saS, {}, { page: Number.NaN, pageSize: Number.NaN })).meta).toMatchObject({ page: 1, pageSize: 25 });
    expect((await listAudit(saS, {}, { pageSize: 5000 })).meta.pageSize).toBe(100);
    expect((await listAudit(saS, {}, { pageSize: -4 })).meta.pageSize).toBe(1);
  });

  it('answers an empty page, with a total of zero, when nothing matches or nothing exists', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const none = await listAudit(sa, {});
    expect(none.entries).toEqual([]);
    expect(none.meta).toMatchObject({ total: 0, pages: 1, page: 1, from: 0, to: 0 });
    await makeAuditEntry({ action: 'client.create' });
    expect((await listAudit(sa, { q: 'no such thing' })).meta.total).toBe(0);
  });

  it('counts the entries a person is allowed to see, not the whole log, in the total', async () => {
    const { aliceS } = await seedTrail();
    expect((await listAudit(aliceS, {}, { pageSize: 1 })).meta).toMatchObject({ total: 2, pages: 2 });
  });
});

describe('what an entry exposes', () => {
  const hashed = { ipHash: 'ip_9d2f6b1c', userAgent: 'Mozilla/5.0 (test)', requestId: 'req-1234' };

  it('gives the IP hash to superadmins only, and never the user agent', async () => {
    const { saS, aliceS, alice } = await seedTrail();
    await makeAuditEntry({ actor: actorOf(alice), action: 'task.create', entity: { type: 'task' }, ...hashed });

    const own = (await listAudit(aliceS, { entityType: 'task' })).entries[0]!;
    expect(own).not.toHaveProperty('ipHash');
    expect(JSON.stringify(own)).not.toContain('ip_9d2f6b1c');
    expect(own.requestId).toBe('req-1234'); // the request id is for everyone

    const all = (await listAudit(saS, { entityType: 'task' })).entries[0]!;
    expect(all.ipHash).toBe('ip_9d2f6b1c');
    expect(all.requestId).toBe('req-1234');
    for (const e of [own, all]) {
      expect(e).not.toHaveProperty('userAgent');
      expect(JSON.stringify(e)).not.toContain('Mozilla');
    }
  });

  it('shows null, not a missing key, when a superadmin reads an entry that has no hash', async () => {
    const { saS } = await seedTrail();
    const e = (await listAudit(saS, { action: 'admin.deactivate' })).entries[0]!;
    expect(e.ipHash).toBeNull();
    expect(e.requestId).toBeNull();
  });

  it('describes the actor, record, summary, context and time', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const client = await makeClient();
    const project = await makeProject(client);
    const entityId = newId();
    await makeAuditEntry({
      at: '2026-10-07T04:30:00Z',
      actor: { id: sa.id, name: 'Sara Admin', role: 'superadmin' },
      action: 'payment.void',
      entity: { type: 'payment', id: entityId, ref: 'PAY-FY27-0001', label: 'Acme receipt' },
      summary: 'Entered twice',
      context: { clientId: client._id, projectId: project._id },
    });
    const [e] = (await listAudit(sa, {})).entries;
    expect(e).toMatchObject({
      at: '2026-10-07T04:30:00.000Z',
      actorId: sa.id,
      actorName: 'Sara Admin',
      actorRole: 'superadmin',
      action: 'payment.void',
      summary: 'Entered twice',
      entity: { type: 'payment', id: String(entityId), ref: 'PAY-FY27-0001', label: 'Acme receipt' },
      context: { clientId: String(client._id), projectId: String(project._id), taskId: null },
    });
  });

  it('turns stored ids and dates into plain JSON, so an entry can cross to the browser', async () => {
    const { saS } = await seedTrail();
    const jobRole = new Types.ObjectId();
    await makeAuditEntry({
      action: 'admin.update',
      entity: { type: 'admin' },
      changes: [
        { path: 'profile.jobRoleId', before: null, after: jobRole },
        { path: 'dueOn', before: new Date('2026-10-01T00:00:00Z'), after: { moved: new Date('2026-10-09T00:00:00Z'), by: [jobRole] } },
      ],
    });
    const [e] = (await listAudit(saS, { action: 'admin.update' })).entries;
    expect(e!.changes).toEqual([
      { path: 'profile.jobRoleId', before: null, after: String(jobRole) },
      { path: 'dueOn', before: '2026-10-01T00:00:00.000Z', after: { moved: '2026-10-09T00:00:00.000Z', by: [String(jobRole)] } },
    ]);
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });

  it('redacts secrets again on the way out, by path and by nested key', async () => {
    const { saS } = await seedTrail();
    // Written raw, as if some other code path had skipped redactChanges.
    await makeAuditEntry({
      action: 'settings.update',
      entity: { type: 'settings' },
      changes: [
        { path: 'passwordHash', before: '$2b$12$abcdefghijk', after: '$2b$12$lmnopqrstuv' },
        { path: 'profile', before: { phone: '98', paymentNote: 'UPI abc@bank' }, after: { phone: '99', nested: { apiToken: 'tok_live_123', keep: 'visible' } } },
        { path: 'name', before: 'Old', after: 'New' },
      ],
    });
    const [e] = (await listAudit(saS, { action: 'settings.' })).entries;
    const text = JSON.stringify(e);
    for (const secret of ['$2b$12$', 'UPI abc@bank', 'tok_live_123']) expect(text).not.toContain(secret);
    expect(e!.changes).toEqual([
      { path: 'passwordHash', before: '[redacted]', after: '[redacted]' },
      { path: 'profile', before: { phone: '98', paymentNote: '[redacted]' }, after: { phone: '99', nested: { apiToken: '[redacted]', keep: 'visible' } } },
      { path: 'name', before: 'Old', after: 'New' },
    ]);
  });

  it('reads back what audit() wrote, already redacted at write time', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    await audit({
      actor: { id: sa.id, name: sa.name, role: sa.role },
      action: 'admin.reset_password',
      entity: { type: 'admin', label: 'Someone' },
      changes: [{ path: 'passwordHash', before: 'a', after: 'b' }],
      meta: { ipHash: 'ip_abc', requestId: 'req-w', userAgent: 'UA' },
    });
    const [e] = (await listAudit(sa, {})).entries;
    expect(e).toMatchObject({ requestId: 'req-w', ipHash: 'ip_abc', changes: [{ path: 'passwordHash', before: '[redacted]', after: '[redacted]' }] });
  });

  it('stops at a sane depth instead of walking a hostile payload forever', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 20; i++) deep = { next: deep };
    await makeAuditEntry({ action: 'deep.thing', entity: { type: 'deep' }, changes: [{ path: 'x', after: deep }] });
    const [e] = (await listAudit(sa, { action: 'deep.' })).entries;
    expect(JSON.stringify(e!.changes)).toContain('[too deep]');
  });

  it('survives a row with missing parts, such as one written by older code', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    // Straight to the collection: the model would refuse it, which is exactly why it must be survivable.
    await AuditLog.collection.insertOne({ at: new Date('2026-10-01T10:00:00Z'), action: 'legacy.thing', changes: [] });
    await makeAuditEntry({ at: '2026-10-02T10:00:00Z', action: 'client.create' });
    const page = await listAudit(sa, {});
    expect(page.entries.map((e) => e.action)).toEqual(['client.create', 'legacy.thing']);
    expect(page.entries[1]).toMatchObject({ actorName: 'Unknown', actorId: null, entity: { type: 'unknown', id: null, ref: null, label: null }, changes: [] });
  });

  it('is append-only: reading changes nothing', async () => {
    const { saS } = await seedTrail();
    const before = await AuditLog.countDocuments({});
    await listAudit(saS, {});
    await getAuditFilterOptions(saS);
    expect(await AuditLog.countDocuments({})).toBe(before);
  });
});

describe('how the list is read', () => {
  /** True when the plan contains a stage that sorts in memory (a SORT stage), the thing indexes are meant to avoid. */
  const sortsInMemory = (plan: unknown) => JSON.stringify(plan).includes('"stage":"SORT"');

  it('serves the newest-first order from an index, for a superadmin and for a person reading their own entries', async () => {
    const { saS, aliceS } = await seedTrail();
    await AuditLog.syncIndexes();
    const period = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-11-01T00:00:00Z') };
    for (const viewer of [saS, aliceS]) {
      const filter = buildFilter(viewer, { q: undefined, ...period });
      const explained = (await AuditLog.find(filter).sort({ at: -1, _id: -1 }).limit(25).explain('queryPlanner')) as unknown as { queryPlanner: { winningPlan: unknown } };
      expect(sortsInMemory(explained.queryPlanner.winningPlan)).toBe(false);
    }
  });
});

describe('filter options and labels', () => {
  it('offers only record types and actions that exist in the viewer\'s part of the log', async () => {
    const { saS, aliceS } = await seedTrail();
    expect(await getAuditFilterOptions(saS)).toEqual({
      entityTypes: ['admin', 'client', 'project'],
      actions: ['admin.deactivate', 'auth.login_failed', 'client.create', 'project.update'],
    });
    expect(await getAuditFilterOptions(aliceS)).toEqual({ entityTypes: ['client', 'project'], actions: ['client.create', 'project.update'] });
  });

  it('offers nothing on an empty log', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    expect(await getAuditFilterOptions(sa)).toEqual({ entityTypes: [], actions: [] });
  });

  it('names the person, client and project behind the ids, including a removed person', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const gone = await makeAdmin({ name: 'Removed Rani', status: 'deactivated' });
    const client = await makeClient({ name: 'Acme Traders' });
    const project = await makeProject(client, { name: 'Shop redesign' });
    const labels = await resolveAuditFilterLabels(sa, { actorId: String(gone._id), clientId: String(client._id), projectId: String(project._id) });
    expect(labels.actor).toEqual({ id: String(gone._id), label: 'Removed Rani' });
    expect(labels.client).toMatchObject({ id: String(client._id), label: 'Acme Traders', ref: client.ref });
    expect(labels.project).toMatchObject({ id: String(project._id), label: 'Shop redesign', ref: project.ref });
  });

  it('never names a person for a viewer who cannot pick one', async () => {
    const { aliceS, bobS } = await seedTrail();
    expect((await resolveAuditFilterLabels(aliceS, { actorId: bobS.id })).actor).toBeUndefined();
  });

  it('keeps an unknown id visible as such, and ignores malformed ones', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const id = String(newId());
    expect((await resolveAuditFilterLabels(sa, { actorId: id })).actor).toEqual({ id, label: 'Unknown person' });
    expect(await resolveAuditFilterLabels(sa, { actorId: 'bad', clientId: 'bad', projectId: 'bad' })).toEqual({});
    expect(await resolveAuditFilterLabels(sa, {})).toEqual({});
  });
});

describe('reading the URL', () => {
  it('parses what is valid and drops the rest', () => {
    expect(
      parseAuditSearch({
        actor: '5F3A1B2C3D4E5F6A7B8C9D0E',
        action: 'payment.',
        entity: 'thirdParty',
        client: 'nope',
        project: ['5f3a1b2c3d4e5f6a7b8c9d0f', 'ignored'],
        q: '  acme  ',
        sensitive: '1',
      }),
    ).toEqual({
      actorId: '5f3a1b2c3d4e5f6a7b8c9d0e', // lower-cased
      action: 'payment.',
      entityType: 'thirdParty',
      clientId: undefined,
      projectId: '5f3a1b2c3d4e5f6a7b8c9d0f',
      q: 'acme',
      sensitive: true,
    });
  });

  it('drops operator-looking junk and cuts long search text', () => {
    const parsed = parseAuditSearch({ action: '$ne', entity: '{"a":1}', sensitive: 'yes', q: 'x'.repeat(300) });
    expect(parsed).toMatchObject({ action: undefined, entityType: undefined, sensitive: undefined });
    expect(parsed.q).toHaveLength(100);
    expect(parseAuditSearch({})).toEqual({ actorId: undefined, action: undefined, entityType: undefined, clientId: undefined, projectId: undefined, q: undefined, sensitive: undefined });
  });
});

describe('grouping by day', () => {
  it('splits at midnight in the organisation zone, keeping the order', () => {
    const entries = [
      { id: 'a', at: '2026-10-12T20:00:00Z' }, // 13 Oct 01:30 in India
      { id: 'b', at: '2026-10-12T18:29:59Z' }, // 12 Oct 23:59 in India
      { id: 'c', at: '2026-10-12T02:00:00Z' }, // 12 Oct 07:30
      { id: 'd', at: '2026-10-11T10:00:00Z' },
    ];
    const groups = groupAuditByDay(entries, 'Asia/Kolkata');
    expect(groups.map((g) => [g.day, g.entries.map((e) => e.id)])).toEqual([
      ['2026-10-13', ['a']],
      ['2026-10-12', ['b', 'c']],
      ['2026-10-11', ['d']],
    ]);
    expect(groups[0]!.label).toMatch(/^Tuesday,? 13 October 2026$/); // ICU decides the comma
    expect(groupAuditByDay(entries, 'UTC').map((g) => g.day)).toEqual(['2026-10-12', '2026-10-11']);
    expect(groupAuditByDay([], 'UTC')).toEqual([]);
  });

  it('falls back to the default zone for a bad zone name', () => {
    expect(groupAuditByDay([{ at: '2026-10-12T20:00:00Z' }], 'Not/AZone')[0]!.day).toBe('2026-10-13');
  });
});
