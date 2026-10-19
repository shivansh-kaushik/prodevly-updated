import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as getRoute, PUT as putRoute } from '@/app/api/admin/team/pay-profiles/[adminId]/route';
import { AuditLog, PayProfile } from '@/models';
import type { ActorDoc } from '@/models/shared.schema';
import {
  applyPayChange,
  getPayProfile,
  payTermsOn,
  putPayProfile,
  type PayState,
} from '@/services/pay-profile.service';
import * as auditModule from '@/services/audit.service';
import { searchTeam } from '@/services/team.service';
import { setupTestDb } from '@/test/db';
import { call, cookieFor, makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { day, makeMember, makePayProfile } from '@/test/team-factories';
import type { PayProfileInput } from '@/lib/validation/team';
import { Types } from 'mongoose';

setupTestDb();
afterEach(() => vi.restoreAllMocks());

const NOW = new Date('2026-10-12T10:00:00Z'); // 12 Oct 2026 in India
const RANGE = { from: day('2026-04-01'), to: day('2027-03-31') };

const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; status?: number; fields?: Record<string, string> };
  }
  throw new Error('expected the call to be rejected');
};

/** The per-field messages a rejected call carries (the top-level message is generic). */
const fieldsOf = (fn: () => unknown): Record<string, string> => {
  try {
    fn();
  } catch (e) {
    return (e as { fields?: Record<string, string> }).fields ?? {};
  }
  throw new Error('expected the call to throw');
};

const MONTHLY: PayProfileInput = { basis: 'monthly', rateMinor: 5_000_000, currency: 'INR', effectiveFrom: '2026-04-01' };
const put = (sa: Awaited<ReturnType<typeof sessionFor>>, id: string, over: Partial<PayProfileInput> = {}, now = NOW) =>
  putPayProfile(sa, id, { ...MONTHLY, ...over }, {}, now);

/** A superadmin who has recently re-entered their password. */
const steppedUp = async () => sessionFor(await makeSuperadmin(), { stepUp: true });

describe('who may read a pay profile', () => {
  it('lets a person read their OWN basis and rate, but never the history or the payout note', async () => {
    const person = await makeMember();
    await makePayProfile(person, { basis: 'hourly', rateMinor: 120_000, payoutNote: 'UPI: person@bank' });
    const dto = await getPayProfile(await sessionFor(person), String(person._id));
    expect(dto).toMatchObject({ exists: true, basis: 'hourly', rateMinor: 120_000, currency: 'INR', effectiveFrom: '2026-04-01' });
    expect(dto).not.toHaveProperty('payoutNote');
    expect(dto).not.toHaveProperty('history');
    expect(JSON.stringify(dto)).not.toContain('UPI');
  });

  it('refuses another admin outright (they hold team:view, which is not pay access)', async () => {
    const person = await makeMember();
    await makePayProfile(person);
    const colleague = await sessionFor(await makeAdmin());
    expect((await rejects(getPayProfile(colleague, String(person._id)))).code).toBe('FORBIDDEN');
  });

  it('lets a superadmin read anyone\'s in full, including the history and the payout note', async () => {
    const person = await makeMember();
    await makePayProfile(person, { payoutNote: 'UPI: person@bank' });
    const sa = await sessionFor(await makeSuperadmin());
    const dto = await getPayProfile(sa, String(person._id));
    expect(dto.payoutNote).toBe('UPI: person@bank');
    expect(dto.history).toEqual([]);
  });

  it('reads "no pay basis" for a person without a profile, and 404 for an unknown or malformed id', async () => {
    const person = await makeMember();
    const dto = await getPayProfile(await sessionFor(person), String(person._id));
    expect(dto).toMatchObject({ exists: false, basis: 'none', rateMinor: 0, effectiveFrom: null });

    const sa = await sessionFor(await makeSuperadmin());
    expect((await rejects(getPayProfile(sa, '5f3a9c0b1d2e4f6a8b7c9d0e'))).code).toBe('NOT_FOUND');
    expect((await rejects(getPayProfile(sa, 'nope'))).code).toBe('NOT_FOUND');
  });

  it('answers through the route: self 200, colleague 403, superadmin 200', async () => {
    const person = await makeMember();
    await makePayProfile(person, { payoutNote: 'secret-note' });
    const id = String(person._id);
    const own = await call(getRoute, `/api/admin/team/pay-profiles/${id}`, { cookie: await cookieFor(person) }, { adminId: id });
    expect(own.status).toBe(200);
    expect(JSON.stringify(own.body)).not.toContain('secret-note');
    const other = await call(getRoute, `/api/admin/team/pay-profiles/${id}`, { cookie: await cookieFor(await makeAdmin()) }, { adminId: id });
    expect(other.status).toBe(403);
    const sa = await call(getRoute, `/api/admin/team/pay-profiles/${id}`, { cookie: await cookieFor(await makeSuperadmin()) }, { adminId: id });
    expect(sa.status).toBe(200);
    expect(sa.body.data.payProfile.payoutNote).toBe('secret-note');
    expect((await call(getRoute, `/api/admin/team/pay-profiles/${id}`)).status).toBe(401);
  });
});

describe('who may write a pay profile', () => {
  it('refuses an admin without team:payView, even a granted one, and writes nothing', async () => {
    const person = await makeMember();
    const admin = await sessionFor(await makeAdmin({ grants: ['payment:record', 'payout:record', 'expense:record'] }), { stepUp: true });
    expect((await rejects(put(admin, String(person._id)))).code).toBe('FORBIDDEN');
    expect(await PayProfile.countDocuments()).toBe(0);
    expect(await AuditLog.countDocuments({ action: /^payProfile\./ })).toBe(0);
  });

  it('needs a recent step-up: a superadmin without one is refused and nothing is written', async () => {
    const person = await makeMember();
    const sa = await sessionFor(await makeSuperadmin()); // no step-up
    expect((await rejects(put(sa, String(person._id)))).code).toBe('STEP_UP_REQUIRED');
    expect(await PayProfile.countDocuments()).toBe(0);
  });

  it('is never allowed on your own profile, even for a stepped-up superadmin, whatever the id spelling', async () => {
    const me = await makeSuperadmin();
    const sa = await sessionFor(me, { stepUp: true });
    expect((await rejects(put(sa, String(me._id)))).code).toBe('SELF_ACTION');
    expect((await rejects(put(sa, String(me._id).toUpperCase()))).code).toBe('SELF_ACTION');
    expect(await PayProfile.countDocuments()).toBe(0);
  });

  it('checks the capability BEFORE the self rule: a plain admin editing themself is FORBIDDEN, not SELF_ACTION', async () => {
    const me = await makeAdmin();
    const admin = await sessionFor(me, { stepUp: true });
    expect((await rejects(put(admin, String(me._id)))).code).toBe('FORBIDDEN');
  });

  it('answers 403 on the route for an admin, STEP_UP_REQUIRED without step-up, SELF_ACTION on self, 200 otherwise', async () => {
    const person = await makeMember();
    const id = String(person._id);
    const body = { ...MONTHLY, effectiveFrom: '2025-04-01' };
    const path = `/api/admin/team/pay-profiles/${id}`;

    const asAdmin = await call(putRoute, path, { method: 'PUT', body, cookie: await cookieFor(await makeAdmin(), { stepUp: true }) }, { adminId: id });
    expect(asAdmin.status).toBe(403);
    expect(asAdmin.body.error.code).toBe('FORBIDDEN');

    const sa = await makeSuperadmin();
    const noStep = await call(putRoute, path, { method: 'PUT', body, cookie: await cookieFor(sa) }, { adminId: id });
    expect(noStep.status).toBe(403);
    expect(noStep.body.error.code).toBe('STEP_UP_REQUIRED');

    const own = await call(putRoute, `/api/admin/team/pay-profiles/${sa._id}`, { method: 'PUT', body, cookie: await cookieFor(sa, { stepUp: true }) }, { adminId: String(sa._id) });
    expect(own.body.error.code).toBe('SELF_ACTION');
    expect(await PayProfile.countDocuments()).toBe(0);

    const good = await call(putRoute, path, { method: 'PUT', body, cookie: await cookieFor(sa, { stepUp: true }) }, { adminId: id });
    expect(good.status).toBe(200);
    expect(good.body.data.payProfile).toMatchObject({ basis: 'monthly', rateMinor: 5_000_000, effectiveFrom: '2025-04-01' });
  });

  it('returns 404 for an unknown person and for a malformed id', async () => {
    const sa = await steppedUp();
    expect((await rejects(put(sa, '5f3a9c0b1d2e4f6a8b7c9d0e'))).code).toBe('NOT_FOUND');
    expect((await rejects(put(sa, 'nope'))).code).toBe('NOT_FOUND');
  });
});

describe('validation', () => {
  it('rejects a bad rate, basis, currency, date and unknown keys, per field, writing nothing', async () => {
    const person = await makeMember();
    const id = String(person._id);
    const sa = await steppedUp();
    expect((await rejects(put(sa, id, { rateMinor: 12.5 }))).fields?.rateMinor).toBeTruthy();
    expect((await rejects(put(sa, id, { rateMinor: -1 }))).fields?.rateMinor).toBeTruthy();
    expect((await rejects(put(sa, id, { rateMinor: 0 }))).fields?.rateMinor).toBe('Enter the rate'); // monthly with no rate
    expect((await rejects(put(sa, id, { basis: 'none', rateMinor: 100 }))).fields?.rateMinor).toMatch(/no rate/);
    expect((await rejects(put(sa, id, { basis: 'weekly' as never }))).fields?.basis).toBeTruthy();
    expect((await rejects(put(sa, id, { currency: 'XXX' as never }))).fields?.currency).toBeTruthy();
    expect((await rejects(put(sa, id, { currency: 'JPY' }))).fields?.currency).toMatch(/not enabled/); // a real code, not enabled
    expect((await rejects(put(sa, id, { effectiveFrom: '2026-02-30' }))).fields?.effectiveFrom).toBeTruthy();
    expect((await rejects(put(sa, id, { effectiveFrom: '1999-01-01' }))).fields?.effectiveFrom).toBeTruthy();
    expect((await rejects(put(sa, id, { effectiveFrom: '2026-10-13' }))).fields?.effectiveFrom).toMatch(/future/); // tomorrow
    expect((await rejects(putPayProfile(sa, id, { ...MONTHLY, adminId: id } as never, {}, NOW))).code).toBe('VALIDATION_FAILED'); // unknown key
    expect(await PayProfile.countDocuments()).toBe(0);
    expect(await AuditLog.countDocuments({ action: /^payProfile\./ })).toBe(0);
  });

  it('accepts a profile with no pay basis (rate 0) and today as the start date', async () => {
    const person = await makeMember();
    const sa = await steppedUp();
    const dto = await put(sa, String(person._id), { basis: 'none', rateMinor: 0, effectiveFrom: '2026-10-12' });
    expect(dto).toMatchObject({ basis: 'none', rateMinor: 0, effectiveFrom: '2026-10-12' });
  });

  it('answers 422 on the route for a body that fails the schema', async () => {
    const person = await makeMember();
    const id = String(person._id);
    const cookie = await cookieFor(await makeSuperadmin(), { stepUp: true });
    const res = await call(putRoute, `/api/admin/team/pay-profiles/${id}`, { method: 'PUT', body: { ...MONTHLY, rateMinor: 'a lot' }, cookie }, { adminId: id });
    expect(res.status).toBe(422);
    expect(res.body.error.fields.rateMinor).toBeTruthy();
  });
});

describe('applyPayChange: the history rules', () => {
  const by: ActorDoc = { id: new Types.ObjectId(), name: 'Sam' };
  const today = day('2026-10-12');
  const terms = (rateMinor: number) => ({ basis: 'monthly' as const, rateMinor, currency: 'INR' });
  const state = (rateMinor: number, from: string, history: PayState['history'] = []): PayState => ({ ...terms(rateMinor), effectiveFrom: day(from), history });

  it('starts a profile with an empty history', () => {
    const { kind, state: s } = applyPayChange(null, { ...terms(100), effectiveFrom: day('2026-04-01') }, by, today);
    expect(kind).toBe('start');
    expect(s.history).toEqual([]);
  });

  it('moves the old terms into history, ending the day BEFORE the new terms begin', () => {
    const { kind, state: s } = applyPayChange(state(100, '2026-04-01'), { ...terms(150), effectiveFrom: day('2026-07-01') }, by, today);
    expect(kind).toBe('new_period');
    expect(s).toMatchObject({ rateMinor: 150, effectiveFrom: day('2026-07-01') });
    expect(s.history).toEqual([{ ...terms(100), effectiveFrom: day('2026-04-01'), effectiveTo: day('2026-06-30'), changedBy: by }]);
  });

  it('keeps history contiguous across several changes', () => {
    const one = applyPayChange(state(100, '2026-04-01'), { ...terms(150), effectiveFrom: day('2026-07-01') }, by, today).state;
    const two = applyPayChange(one, { ...terms(200), effectiveFrom: day('2026-09-16') }, by, today).state;
    expect(two.history.map((h) => [h.rateMinor, h.effectiveFrom.toISOString().slice(0, 10), h.effectiveTo.toISOString().slice(0, 10)])).toEqual([
      [100, '2026-04-01', '2026-06-30'],
      [150, '2026-07-01', '2026-09-15'],
    ]);
    expect(two.effectiveFrom).toEqual(day('2026-09-16'));
  });

  it('treats the same start date with new terms as a correction: replaced in place, nothing added to history', () => {
    const { kind, state: s } = applyPayChange(state(100, '2026-04-01'), { ...terms(110), effectiveFrom: day('2026-04-01') }, by, today);
    expect(kind).toBe('correct');
    expect(s.rateMinor).toBe(110);
    expect(s.history).toEqual([]);
  });

  it('refuses to replace terms already in force from an EARLIER date', () => {
    expect(fieldsOf(() => applyPayChange(state(100, '2026-04-01'), { ...terms(150), effectiveFrom: day('2026-03-01') }, by, today)).effectiveFrom).toMatch(/applied since 2026-04-01/);
  });

  it('refuses a start date after today, so there is never a "scheduled" change to get stuck on', () => {
    expect(fieldsOf(() => applyPayChange(state(100, '2026-04-01'), { ...terms(150), effectiveFrom: day('2026-10-13') }, by, today)).effectiveFrom).toMatch(/future/);
    expect(fieldsOf(() => applyPayChange(null, { ...terms(150), effectiveFrom: day('2026-10-13') }, by, today)).effectiveFrom).toMatch(/future/);
  });

  it('is a no-op when nothing changed', () => {
    expect(applyPayChange(state(100, '2026-04-01'), { ...terms(100), effectiveFrom: day('2026-04-01') }, by, today).kind).toBe('none');
  });

  it('corrects a start date with the same terms, stretching the previous period to meet it', () => {
    const base = applyPayChange(state(100, '2026-04-01'), { ...terms(150), effectiveFrom: day('2026-07-01') }, by, today).state;
    const moved = applyPayChange(base, { ...terms(150), effectiveFrom: day('2026-08-01') }, by, today);
    expect(moved.kind).toBe('redate');
    expect(moved.state.effectiveFrom).toEqual(day('2026-08-01'));
    expect(moved.state.history[0]?.effectiveTo).toEqual(day('2026-07-31'));
    // moving it back before the previous period even began would leave that period empty
    expect(fieldsOf(() => applyPayChange(base, { ...terms(150), effectiveFrom: day('2026-04-01') }, by, today)).effectiveFrom).toMatch(/Must be after 2026-04-01/);
  });

  it('does not mutate the state it was given', () => {
    const before = state(100, '2026-04-01');
    const snapshot = JSON.stringify(before);
    applyPayChange(before, { ...terms(150), effectiveFrom: day('2026-07-01') }, by, today);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('putPayProfile: persistence, history and audit', () => {
  it('creates a profile, then records a raise in history with who changed it, and audits both', async () => {
    const person = await makeMember({ name: 'Riya Sen' });
    const id = String(person._id);
    const sa = await steppedUp();

    const first = await put(sa, id, { rateMinor: 5_000_000, effectiveFrom: '2026-04-01' });
    expect(first).toMatchObject({ exists: true, adminName: 'Riya Sen', basis: 'monthly', rateMinor: 5_000_000, effectiveFrom: '2026-04-01', history: [] });

    const second = await put(sa, id, { rateMinor: 6_000_000, effectiveFrom: '2026-07-01' });
    expect(second.rateMinor).toBe(6_000_000);
    expect(second.history).toEqual([
      { basis: 'monthly', rateMinor: 5_000_000, currency: 'INR', effectiveFrom: '2026-04-01', effectiveTo: '2026-06-30', changedBy: sa.name },
    ]);

    const stored = await PayProfile.findOne({ adminId: person._id }).lean();
    expect(stored?.history).toHaveLength(1);
    expect(stored?.effectiveFrom.toISOString()).toBe('2026-07-01T00:00:00.000Z');

    const entries = await AuditLog.find({ action: /^payProfile\./ }).sort({ at: 1 }).lean();
    expect(entries.map((e) => e.action)).toEqual(['payProfile.create', 'payProfile.update']);
    expect(entries[1]?.entity).toMatchObject({ type: 'payProfile', label: 'Riya Sen' });
    expect(entries[1]?.changes).toEqual(
      expect.arrayContaining([
        { path: 'rateMinor', before: 5_000_000, after: 6_000_000 },
        { path: 'effectiveFrom', before: '2026-04-01', after: '2026-07-01' },
      ]),
    );
  });

  it('changes currency and basis as a new period too', async () => {
    const person = await makeMember();
    const id = String(person._id);
    const sa = await steppedUp();
    await put(sa, id);
    const next = await put(sa, id, { basis: 'hourly', rateMinor: 2_500, currency: 'USD', effectiveFrom: '2026-09-01' });
    expect(next).toMatchObject({ basis: 'hourly', currency: 'USD', rateMinor: 2_500 });
    expect(next.history?.[0]).toMatchObject({ basis: 'monthly', currency: 'INR', effectiveTo: '2026-08-31' });
  });

  it('writes nothing, and audits nothing, when the request changes nothing', async () => {
    const person = await makeMember();
    const id = String(person._id);
    const sa = await steppedUp();
    await put(sa, id);
    const before = await PayProfile.findOne({ adminId: person._id }).lean();
    await put(sa, id); // identical
    const after = await PayProfile.findOne({ adminId: person._id }).lean();
    expect(after?.updatedAt).toEqual(before?.updatedAt);
    expect(await AuditLog.countDocuments({ action: /^payProfile\./ })).toBe(1);
  });

  it('keeps the payout note out of every audit entry, and out of every non-superadmin read', async () => {
    const person = await makeMember();
    const id = String(person._id);
    const sa = await steppedUp();
    const saved = await put(sa, id, { payoutNote: 'IFSC HDFC0001234 acct 9988776655' });
    expect(saved.payoutNote).toBe('IFSC HDFC0001234 acct 9988776655');

    const audits = JSON.stringify(await AuditLog.find({ action: /^payProfile\./ }).lean());
    expect(audits).not.toContain('9988776655');
    expect(audits).toContain('[redacted]');

    const own = JSON.stringify(await getPayProfile(await sessionFor(person), id));
    expect(own).not.toContain('9988776655');
    expect(JSON.stringify(await searchTeam(await sessionFor(await makeAdmin()), RANGE, { status: 'all' }, NOW))).not.toContain('9988776655');
  });

  it('updates, keeps and clears the note independently of the terms', async () => {
    const person = await makeMember();
    const id = String(person._id);
    const sa = await steppedUp();
    await put(sa, id, { payoutNote: 'first' });
    expect((await put(sa, id)).payoutNote).toBe('first'); // left out: kept
    expect((await put(sa, id, { payoutNote: 'second' })).payoutNote).toBe('second'); // note-only change
    expect((await PayProfile.findOne({ adminId: person._id }).lean())?.history).toHaveLength(0);
    expect((await put(sa, id, { payoutNote: '' })).payoutNote).toBeNull(); // empty: cleared
    expect(await AuditLog.countDocuments({ action: 'payProfile.update' })).toBe(2);
  });

  it('can still edit the profile of a person whose account was removed (a final settlement)', async () => {
    const person = await makeMember({ status: 'deactivated' });
    const sa = await steppedUp();
    expect((await put(sa, String(person._id))).exists).toBe(true);
  });

  it('is atomic: when the audit write fails, neither the create nor the update is saved', async () => {
    const person = await makeMember();
    const id = String(person._id);
    const sa = await steppedUp();

    const spy = vi.spyOn(auditModule, 'audit').mockRejectedValueOnce(new Error('audit down'));
    await rejects(put(sa, id));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await PayProfile.countDocuments()).toBe(0);

    await put(sa, id, { rateMinor: 100 });
    vi.spyOn(auditModule, 'audit').mockRejectedValueOnce(new Error('audit down'));
    await rejects(put(sa, id, { rateMinor: 999, effectiveFrom: '2026-08-01' }));
    const stored = await PayProfile.findOne({ adminId: person._id }).lean();
    expect(stored).toMatchObject({ rateMinor: 100, history: [] });
    expect(await AuditLog.countDocuments({ action: /^payProfile\./ })).toBe(1);
  });

  it('keeps history consistent when two superadmins save at the same moment', async () => {
    const person = await makeMember();
    const id = String(person._id);
    const a = await steppedUp();
    const b = await steppedUp();
    await put(a, id, { rateMinor: 100, effectiveFrom: '2026-04-01' });
    const results = await Promise.allSettled([
      put(a, id, { rateMinor: 200, effectiveFrom: '2026-06-01' }),
      put(b, id, { rateMinor: 300, effectiveFrom: '2026-07-01' }),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    const stored = await PayProfile.findOne({ adminId: person._id }).lean();
    // whatever the order, history is contiguous and ends the day before the current terms
    let expectedStart = day('2026-04-01').getTime();
    for (const h of stored?.history ?? []) {
      expect(h.effectiveFrom.getTime()).toBe(expectedStart);
      expectedStart = h.effectiveTo.getTime() + 86_400_000;
    }
    expect(stored?.effectiveFrom.getTime()).toBe(expectedStart);
  });
});

describe('payTermsOn: which terms applied on a date', () => {
  it('reads history for the past and the current terms from their start date', async () => {
    const person = await makeMember();
    const id = String(person._id);
    const sa = await steppedUp();
    await put(sa, id, { rateMinor: 100, effectiveFrom: '2026-04-01' });
    await put(sa, id, { rateMinor: 150, effectiveFrom: '2026-07-01' });
    const dto = await getPayProfile(sa, id);
    expect(payTermsOn(dto, '2026-03-31')).toBeNull(); // before the first record
    expect(payTermsOn(dto, '2026-04-01')?.rateMinor).toBe(100);
    expect(payTermsOn(dto, '2026-06-30')?.rateMinor).toBe(100); // March-style payout after a later raise still uses the old rate
    expect(payTermsOn(dto, '2026-07-01')?.rateMinor).toBe(150);
    expect(payTermsOn(dto, '2027-01-01')?.rateMinor).toBe(150);
  });

  it('knows nothing for a person without a profile', async () => {
    const person = await makeMember();
    const dto = await getPayProfile(await sessionFor(person), String(person._id));
    expect(payTermsOn(dto, '2026-04-01')).toBeNull();
  });
});
