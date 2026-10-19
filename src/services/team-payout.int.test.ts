import { afterEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { AuditLog, Counter, Project, TeamPayout, WorkLog } from '@/models';
import { toInrMinor } from '@/lib/money/fx';
import * as auditModule from '@/services/audit.service';
import { getProjectMargins } from '@/services/dashboards/ledger';
import { computeSuggestedMinor, createTeamPayout, getPayoutSuggestion, getTeamPayout, markTeamPayoutPaid, updateTeamPayout, voidTeamPayout } from '@/services/team-payout.service';
import { createWorkLog, deleteWorkLog, updateWorkLog } from '@/services/work-log.service';
import { makeAssignedTask, makePayProfile } from '@/test/team-factories';
import {
  day,
  holding,
  logTime,
  lockedLogIds,
  makeAdmin,
  makePayoutWorld,
  NOW,
  payoutBody,
  recordPayout,
  rejects,
  sessionFor,
  setupTestDb,
  usdRate,
  without,
} from '@/test/team-payout-factories';

setupTestDb();
afterEach(() => vi.restoreAllMocks());

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const PAID = { paidOn: '2026-05-10', mode: 'bank_transfer', transactionRef: 'UTR-001' };

describe('the suggestion: what the pay profile proposes', () => {
  it('monthly pays the rate, whatever was logged', async () => {
    const w = await makePayoutWorld({ pay: { basis: 'monthly', rateMinor: 5_000_000 } });
    await logTime(w, 0, '2026-04-10', 600);
    const s = await getPayoutSuggestion(w.sa, { adminId: String(w.person._id), from: '2026-04-01', to: '2026-04-30' });
    expect(s).toMatchObject({ payoutBasis: 'salary', computedMinor: 5_000_000, minutes: 600, terms: { basis: 'monthly', rateMinor: 5_000_000, currency: 'INR' } });
    expect(s.suggestion).toEqual({ minutes: 600, taskCount: 0, rateMinor: 5_000_000, currency: 'INR', computedMinor: 5_000_000 });
  });

  it('hourly pays the logged minutes divided by 60 times the rate, rounded half up to the minor unit', async () => {
    const w = await makePayoutWorld({ pay: { basis: 'hourly', rateMinor: 120_000 } });
    await logTime(w, 0, '2026-04-02', 90);
    await logTime(w, 1, '2026-04-30', 150); // the last day of the period counts
    await logTime(w, 1, '2026-05-01', 600); // after it: does not
    await logTime(w, 1, '2026-03-31', 600); // before it: does not
    const s = await getPayoutSuggestion(w.sa, { adminId: String(w.person._id), from: '2026-04-01', to: '2026-04-30' });
    expect(s).toMatchObject({ payoutBasis: 'hours', minutes: 240, computedMinor: 480_000 }); // 4 h x INR 1,200.00

    expect(computeSuggestedMinor({ basis: 'hourly', rateMinor: 100_001, currency: 'INR' }, 7, 0)).toBe(11_667); // 11666.78 rounds up
    expect(computeSuggestedMinor({ basis: 'hourly', rateMinor: 100_000, currency: 'INR' }, 1, 0)).toBe(1_667); // 1666.67 rounds up
    expect(computeSuggestedMinor({ basis: 'hourly', rateMinor: 6_000, currency: 'INR' }, 1, 0)).toBe(100); // exact
    expect(computeSuggestedMinor({ basis: 'hourly', rateMinor: 100, currency: 'INR' }, 0, 0)).toBe(0);
  });

  it('per task pays the tasks THEY completed in the period times the rate, and nobody else\'s, and nothing outside it', async () => {
    const w = await makePayoutWorld({ pay: { basis: 'per_task', rateMinor: 250_000 } });
    const p = w.projects[0]!;
    const other = await makeAdmin();
    await makeAssignedTask(p, [w.person], { status: 'done', completedAt: new Date('2026-04-10T10:00:00Z') });
    await makeAssignedTask(p, [w.person, other], { status: 'done', completedAt: new Date('2026-04-30T18:00:00Z') }); // 23:30 IST on the 30th: inside
    await makeAssignedTask(p, [w.person], { status: 'done', completedAt: new Date('2026-04-30T19:00:00Z') }); // 00:30 IST on 1 May: outside
    await makeAssignedTask(p, [w.person], { status: 'done', completedAt: new Date('2026-03-31T10:00:00Z') }); // before
    await makeAssignedTask(p, [w.person], { status: 'in_progress' }); // not done
    await makeAssignedTask(p, [other], { status: 'done', completedAt: new Date('2026-04-12T10:00:00Z') }); // not theirs
    const s = await getPayoutSuggestion(w.sa, { adminId: String(w.person._id), from: '2026-04-01', to: '2026-04-30' });
    expect(s).toMatchObject({ payoutBasis: 'tasks', taskCount: 2, computedMinor: 500_000 });
  });

  it('no pay basis, or no profile at all, proposes no amount and says so, but still reports where the time went', async () => {
    const none = await makePayoutWorld({ pay: { basis: 'none', rateMinor: 0 } });
    await logTime(none, 0, '2026-04-10', 120);
    const a = await getPayoutSuggestion(none.sa, { adminId: String(none.person._id), from: '2026-04-01', to: '2026-04-30' });
    expect(a).toMatchObject({ terms: null, computedMinor: null, suggestion: null, payoutBasis: null, minutes: 120, proposedAllocations: [] });
    expect(a.warnings.join(' ')).toMatch(/no pay basis/);

    const bare = await makePayoutWorld({ pay: null });
    const b = await getPayoutSuggestion(bare.sa, { adminId: String(bare.person._id), from: '2026-04-01', to: '2026-04-30' });
    expect(b).toMatchObject({ terms: null, computedMinor: null });
    expect(b.warnings.join(' ')).toMatch(/no pay profile/);
  });

  it('uses the terms in force on the last day of the period, and warns when they changed inside it', async () => {
    const w = await makePayoutWorld({ pay: null });
    // 40,000 from April, 50,000 from 15 May: the history keeps the old terms
    await makePayProfile(w.person, { basis: 'monthly', rateMinor: 5_000_000, effectiveFrom: '2026-05-15' });
    const { PayProfile } = await import('@/models');
    await PayProfile.updateOne(
      { adminId: w.person._id },
      { $push: { history: { basis: 'monthly', rateMinor: 4_000_000, currency: 'INR', effectiveFrom: day('2026-04-01'), effectiveTo: day('2026-05-14'), changedBy: { id: null, name: 'Test' } } } },
    );
    const april = await getPayoutSuggestion(w.sa, { adminId: String(w.person._id), from: '2026-04-01', to: '2026-04-30' });
    expect(april.computedMinor).toBe(4_000_000); // April uses April's rate even though a raise is on file
    expect(april.warnings.join(' ')).not.toMatch(/terms changed/);
    const may = await getPayoutSuggestion(w.sa, { adminId: String(w.person._id), from: '2026-05-01', to: '2026-05-31' });
    expect(may.computedMinor).toBe(5_000_000);
    expect(may.warnings.join(' ')).toMatch(/terms changed during this period/);
  });

  it('proposes a split of the proposed amount in proportion to the minutes per project, and flags an archived project', async () => {
    const w = await makePayoutWorld({ pay: { basis: 'monthly', rateMinor: 1_000_000 } });
    await logTime(w, 0, '2026-04-03', 300);
    await logTime(w, 0, '2026-04-04', 300);
    await logTime(w, 1, '2026-04-05', 200);
    await logTime(w, 2, '2026-04-06', 100);
    await Project.updateOne({ _id: w.projects[2]!._id }, { $set: { archivedAt: new Date() } });
    const s = await getPayoutSuggestion(w.sa, { adminId: String(w.person._id), from: '2026-04-01', to: '2026-04-30' });
    expect(s.projects.map((p) => [p.projectId, p.minutes, p.archived])).toEqual([
      [String(w.projects[0]!._id), 600, false],
      [String(w.projects[1]!._id), 200, false],
      [String(w.projects[2]!._id), 100, true],
    ]);
    expect(s.proposedAllocations.map((a) => a.amountMinor)).toEqual([666_667, 222_222, 111_111]);
    expect(sum(s.proposedAllocations.map((a) => a.amountMinor))).toBe(1_000_000);
  });

  it('warns about time already covered by a paid payout, and about payouts that already cover the period', async () => {
    const w = await makePayoutWorld();
    await logTime(w, 0, '2026-04-10', 60);
    const first = await recordPayout(w);
    await usdRate(80, '2026-05-08');
    await markTeamPayoutPaid(w.sa, first.id, PAID, {}, NOW);
    const s = await getPayoutSuggestion(w.sa, { adminId: String(w.person._id), from: '2026-04-01', to: '2026-04-30' });
    expect(s.warnings.join(' ')).toMatch(/already covered by a paid payout/);
    expect(s.warnings.join(' ')).toContain(first.ref);
  });

  it('is for a superadmin only: it needs teamPayout:record and team:payView, and a bad query is a 422', async () => {
    const w = await makePayoutWorld();
    const q = { adminId: String(w.person._id), from: '2026-04-01', to: '2026-04-30' };
    expect((await rejects(getPayoutSuggestion(w.personSession, q))).code).toBe('FORBIDDEN');
    expect((await rejects(getPayoutSuggestion(without(w.sa, 'team:payView'), q))).code).toBe('FORBIDDEN');
    expect((await rejects(getPayoutSuggestion(without(w.sa, 'teamPayout:record'), q))).code).toBe('FORBIDDEN');
    expect((await rejects(getPayoutSuggestion(w.sa, { ...q, to: '2026-03-01' }))).code).toBe('VALIDATION_FAILED');
    expect((await rejects(getPayoutSuggestion(w.sa, { ...q, from: '2020-01-01', to: '2026-04-30' }))).fields?.to).toMatch(/at most 366/);
    expect((await rejects(getPayoutSuggestion(w.sa, { ...q, adminId: 'nope' }))).code).toBe('VALIDATION_FAILED');
    expect((await rejects(getPayoutSuggestion(w.sa, { ...q, adminId: String(new Types.ObjectId()) }))).code).toBe('NOT_FOUND');
  });
});

describe('recording a payout', () => {
  it('creates a DUE INR payout numbered in the financial year of its due date, with the amount built by the server', async () => {
    const w = await makePayoutWorld();
    const { payout, warnings } = await createTeamPayout(w.sa, payoutBody(w, { note: ' April salary ' }), {}, NOW);
    expect(warnings).toEqual([]);
    expect(payout).toMatchObject({
      ref: 'TMP-FY27-0001',
      adminName: 'Asha Rao',
      basis: 'salary',
      periodFrom: '2026-04-01',
      periodTo: '2026-04-30',
      status: 'due',
      dueOn: '2026-05-05',
      paidOn: null,
      amount: { amountMinor: 5_000_000, currency: 'INR', fxRate: 1, fxSource: 'identity', inrMinor: 5_000_000, fxDate: '2026-05-05' },
    });
    expect(payout.detail).toMatchObject({ note: 'April salary', allocations: [], unallocatedInrMinor: 5_000_000, recordedBy: w.superadmin.name, paidBy: null });
    // the proposal is stored next to the final amount, because the basis is the kind the pay profile proposes
    expect(payout.detail?.suggestion).toMatchObject({ computedMinor: 5_000_000, rateMinor: 5_000_000, currency: 'INR' });
    const next = await recordPayout(w, { basis: 'bonus', periodFrom: '2026-05-01', periodTo: '2026-05-31' });
    expect(next.ref).toBe('TMP-FY27-0002');
    expect(next.detail?.suggestion).toBeNull(); // a bonus is not a salary suggestion
  });

  it('defaults the due date to today in the organisation zone, and restarts the numbering with the financial year', async () => {
    const w = await makePayoutWorld();
    const today = await createTeamPayout(w.sa, payoutBody(w, { dueOn: undefined }), {}, NOW);
    expect(today.payout.dueOn).toBe('2026-10-12');
    const old = await recordPayout(w, { dueOn: '2026-03-30', periodFrom: '2026-03-01', periodTo: '2026-03-31' });
    expect(old.ref).toBe('TMP-FY26-0001'); // 30 March belongs to FY26
  });

  it('captures a foreign amount at the table rate for the due date and stores the whole Money entry', async () => {
    const w = await makePayoutWorld();
    await usdRate(83.5, '2026-05-03');
    const p = await recordPayout(w, { currency: 'USD', amountMinor: 100_000 });
    expect(p.amount).toEqual({ amountMinor: 100_000, currency: 'USD', fxRate: 83.5, fxDate: '2026-05-03', fxSource: 'table', inrMinor: 8_350_000 });
  });

  it('asks for a rate when there is none for the due date (422 on fxRate), and accepts one typed by hand or the INR that left', async () => {
    const w = await makePayoutWorld();
    const err = await rejects(createTeamPayout(w.sa, payoutBody(w, { currency: 'USD', amountMinor: 100_000 }), {}, NOW));
    expect(err.code).toBe('FX_RATE_MISSING');
    expect(err.fields?.fxRate).toBeTruthy();
    expect(await TeamPayout.countDocuments()).toBe(0);

    const manual = await createTeamPayout(w.sa, payoutBody(w, { currency: 'USD', amountMinor: 100_000, manualRate: 84.25 }), {}, NOW);
    expect(manual.payout.amount).toMatchObject({ fxSource: 'manual', fxRate: 84.25, inrMinor: 8_425_000 });
    const bank = await createTeamPayout(w.sa, payoutBody(w, { currency: 'USD', amountMinor: 100_000, settledInrMinor: 8_410_000 }), {}, NOW);
    expect(bank.payout.amount).toMatchObject({ fxSource: 'bank', inrMinor: 8_410_000 });
    expect((await rejects(createTeamPayout(w.sa, payoutBody(w, { currency: 'USD', amountMinor: 1, manualRate: 80, settledInrMinor: 80 }), {}, NOW))).fields?.manualRate).toBeTruthy();
  });

  it('splits across projects: client and minutes are derived, the INR shares follow the payout, and the rest is overhead', async () => {
    const w = await makePayoutWorld();
    await logTime(w, 0, '2026-04-03', 400);
    await logTime(w, 1, '2026-04-04', 100);
    const body = payoutBody(w, {
      allocations: [
        { projectId: String(w.projects[0]!._id), amountMinor: 3_000_000 },
        { projectId: String(w.projects[1]!._id), amountMinor: 1_000_000 },
        { projectId: String(w.projects[2]!._id), amountMinor: 500_000, clientId: String(w.client._id) },
      ],
    });
    const { payout } = await createTeamPayout(w.sa, body, {}, NOW);
    const d = payout.detail!;
    expect(d.allocations.map((a) => [a.projectRef, a.amountMinor, a.inrMinor, a.minutes, a.clientId])).toEqual([
      [w.projects[0]!.ref, 3_000_000, 3_000_000, 400, String(w.client._id)],
      [w.projects[1]!.ref, 1_000_000, 1_000_000, 100, String(w.client._id)],
      [w.projects[2]!.ref, 500_000, 500_000, 0, String(w.client._id)], // no time logged: stored as 0, not invented
    ]);
    expect(d.allocatedInrMinor).toBe(4_500_000);
    expect(d.unallocatedInrMinor).toBe(500_000); // overhead is derived, never typed
  });

  it('a three-way split of an odd foreign amount never exceeds the payout in INR, and a full split adds up to exactly its INR value', async () => {
    const w = await makePayoutWorld();
    await usdRate(83.4167, '2026-05-04');
    const ids = w.projects.map((p) => String(p._id));
    const amount = 100_001;
    const inr = toInrMinor(amount, 'USD', 83.4167);
    const full = await recordPayout(w, {
      currency: 'USD',
      amountMinor: amount,
      allocations: [
        { projectId: ids[0]!, amountMinor: 33_334 },
        { projectId: ids[1]!, amountMinor: 33_334 },
        { projectId: ids[2]!, amountMinor: 33_333 },
      ],
    });
    const shares = full.detail!.allocations.map((a) => a.inrMinor);
    expect(sum(shares)).toBe(inr);
    expect(full.detail!.unallocatedInrMinor).toBe(0);
    shares.forEach((s) => expect(s).toBeGreaterThan(0));

    const part = await recordPayout(w, {
      currency: 'USD',
      amountMinor: amount,
      allocations: [
        { projectId: ids[0]!, amountMinor: 33_333 },
        { projectId: ids[1]!, amountMinor: 33_333 },
        { projectId: ids[2]!, amountMinor: 33_333 },
      ],
    });
    expect(sum(part.detail!.allocations.map((a) => a.inrMinor))).toBeLessThanOrEqual(inr);
    expect(part.detail!.unallocatedInrMinor).toBe(inr - sum(part.detail!.allocations.map((a) => a.inrMinor)));
    expect(part.detail!.unallocatedInrMinor).toBeGreaterThan(0);

    const over = await rejects(
      createTeamPayout(
        w.sa,
        payoutBody(w, {
          currency: 'USD',
          amountMinor: amount,
          allocations: [
            { projectId: ids[0]!, amountMinor: 33_334 },
            { projectId: ids[1]!, amountMinor: 33_334 },
            { projectId: ids[2]!, amountMinor: 33_334 },
          ],
        }),
        {},
        NOW,
      ),
    );
    expect(over.code).toBe('VALIDATION_FAILED');
    expect(over.fields?.allocations).toMatch(/more than the payout/);
  });

  it('refuses a project that is missing, archived, repeated or from another client, and writes nothing', async () => {
    const w = await makePayoutWorld();
    const ids = w.projects.map((p) => String(p._id));
    const attempt = (allocations: Array<{ projectId: string; amountMinor: number; clientId?: string }>) => rejects(createTeamPayout(w.sa, payoutBody(w, { allocations }), {}, NOW));

    expect((await attempt([{ projectId: String(new Types.ObjectId()), amountMinor: 100 }])).fields?.['allocations.0.projectId']).toMatch(/does not exist/);
    expect((await attempt([{ projectId: ids[0]!, amountMinor: 100 }, { projectId: ids[0]!, amountMinor: 100 }])).fields?.['allocations.1.projectId']).toMatch(/already in the split/);
    expect((await attempt([{ projectId: ids[0]!, amountMinor: 100, clientId: String(new Types.ObjectId()) }])).code).toBe('LINK_MISMATCH');
    await Project.updateOne({ _id: w.projects[1]!._id }, { $set: { archivedAt: new Date() } });
    const archived = await attempt([{ projectId: ids[1]!, amountMinor: 100 }]);
    expect(archived.code).toBe('CONFLICT');
    expect(archived.fields?.['allocations.0.projectId']).toMatch(/archived/);
    expect((await attempt([{ projectId: ids[0]!, amountMinor: 0 }])).fields?.['allocations.0.amountMinor']).toBeTruthy();

    expect(await TeamPayout.countDocuments()).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'teamPayout.create' })).toBe(0);
  });

  it('is atomic: a failed create leaves no payout, no audit entry and no consumed reference number', async () => {
    const w = await makePayoutWorld();
    await rejects(createTeamPayout(w.sa, payoutBody(w, { allocations: [{ projectId: String(new Types.ObjectId()), amountMinor: 100 }] }), {}, NOW));
    expect(await TeamPayout.countDocuments()).toBe(0);
    expect(await Counter.countDocuments({ _id: /^teamPayout:/ })).toBe(0);
    expect((await recordPayout(w)).ref).toBe('TMP-FY27-0001');
  });

  it('warns, but does not block, when the period overlaps another payout of the same kind for the same person', async () => {
    const w = await makePayoutWorld();
    const first = await recordPayout(w);
    const overlap = await createTeamPayout(w.sa, payoutBody(w, { periodFrom: '2026-04-20', periodTo: '2026-05-10' }), {}, NOW);
    expect(overlap.payout.status).toBe('due'); // recorded
    expect(overlap.warnings).toHaveLength(1);
    expect(overlap.warnings[0]).toContain(first.ref);
    expect(overlap.warnings[0]).toMatch(/not paid twice/);
    expect(overlap.payout.detail?.warnings).toEqual(overlap.warnings);

    // a different kind of payout, another person, a void one and a period next door do not warn
    expect((await createTeamPayout(w.sa, payoutBody(w, { basis: 'bonus' }), {}, NOW)).warnings).toEqual([]);
    const other = await makePayoutWorld();
    expect((await createTeamPayout(w.sa, payoutBody(other), {}, NOW)).warnings).toEqual([]);
    expect((await createTeamPayout(w.sa, payoutBody(w, { periodFrom: '2026-05-11', periodTo: '2026-05-31' }), {}, NOW)).warnings).toEqual([]);
    await voidTeamPayout(w.sa, first.id, { reason: 'Entered twice' }, {}, NOW);
    await voidTeamPayout(w.sa, overlap.payout.id, { reason: 'Entered twice' }, {}, NOW);
    expect((await createTeamPayout(w.sa, payoutBody(w), {}, NOW)).warnings).toEqual([]);
  });

  it('warns when the period runs past today, because paying it will refuse time logged for the remaining days', async () => {
    const w = await makePayoutWorld();
    const r = await createTeamPayout(w.sa, payoutBody(w, { periodFrom: '2026-10-01', periodTo: '2026-10-31' }), {}, NOW);
    expect(r.warnings.join(' ')).toMatch(/after today/);
  });

  it('validates the body per field, and refuses unknown keys, writing nothing', async () => {
    const w = await makePayoutWorld();
    const bad = (over: Record<string, unknown>) => rejects(createTeamPayout(w.sa, { ...payoutBody(w), ...over } as never, {}, NOW));
    expect((await bad({ amountMinor: 0 })).fields?.amountMinor).toBeTruthy();
    expect((await bad({ amountMinor: 12.5 })).fields?.amountMinor).toBeTruthy();
    expect((await bad({ amountMinor: -5 })).fields?.amountMinor).toBeTruthy();
    expect((await bad({ amountMinor: 2_000_000_000_000 })).fields?.amountMinor).toMatch(/too large/);
    expect((await bad({ currency: 'XXX' })).fields?.currency).toBeTruthy();
    expect((await bad({ currency: 'JPY' })).fields?.currency).toMatch(/not turned on/); // a real code, not enabled
    expect((await bad({ basis: 'commission' })).fields?.basis).toBeTruthy();
    expect((await bad({ periodFrom: '2026-02-30' })).fields?.periodFrom).toBeTruthy();
    expect((await bad({ periodFrom: '2026-05-01', periodTo: '2026-04-01' })).fields?.periodTo).toMatch(/cannot end before/);
    expect((await bad({ periodFrom: '2025-01-01', periodTo: '2026-04-01' })).fields?.periodTo).toMatch(/at most 366/);
    expect((await bad({ adminId: 'nope' })).fields?.adminId).toBeTruthy();
    expect((await bad({ adminId: String(new Types.ObjectId()) })).code).toBe('NOT_FOUND');
    expect((await bad({ inrMinor: 1 })).code).toBe('VALIDATION_FAILED'); // the INR value is never accepted from a client
    expect((await bad({ status: 'paid' })).code).toBe('VALIDATION_FAILED');
    expect((await bad({ note: 'x'.repeat(1001) })).fields?.note).toBeTruthy();
    expect(await TeamPayout.countDocuments()).toBe(0);
  });

  it('can be recorded for a person whose account was removed (their final pay), and for yourself', async () => {
    const w = await makePayoutWorld();
    const { Admin } = await import('@/models');
    await Admin.updateOne({ _id: w.person._id }, { $set: { status: 'deactivated' } });
    expect((await recordPayout(w)).status).toBe('due');
    const self = await createTeamPayout(w.sa, payoutBody({ person: w.superadmin }), {}, NOW);
    expect(self.payout.adminId).toBe(String(w.superadmin._id));
  });

  it('writes one audit entry with the figures', async () => {
    const w = await makePayoutWorld();
    const p = await recordPayout(w);
    const entries = await AuditLog.find({ action: 'teamPayout.create' }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actor: { name: w.superadmin.name }, entity: { type: 'teamPayout', ref: p.ref, label: 'Asha Rao' } });
    expect(entries[0]!.changes.map((c) => c.path)).toEqual(expect.arrayContaining(['basis', 'periodFrom', 'periodTo', 'amount.amountMinor', 'amount.inrMinor', 'allocations']));
  });
});

describe('the audit context', () => {
  it('a payout charged to one project shows in that project\'s activity; one split across several names only the client', async () => {
    const { getActivity } = await import('@/services/activity.service');
    const w = await makePayoutWorld();
    const ids = w.projects.map((p) => String(p._id));
    const single = await recordPayout(w, { allocations: [{ projectId: ids[0]!, amountMinor: 1_000_000 }] });
    await markTeamPayoutPaid(w.sa, single.id, PAID, {}, NOW);
    const feed = await getActivity({ projectId: ids[0]! });
    expect(feed.map((e) => e.action).sort()).toEqual(['teamPayout.create', 'teamPayout.mark_paid']);
    expect((await getActivity({ clientId: String(w.client._id) })).length).toBe(2);

    const split = await recordPayout(w, { basis: 'bonus', allocations: [{ projectId: ids[1]!, amountMinor: 100 }, { projectId: ids[2]!, amountMinor: 100 }] });
    const entry = await AuditLog.findOne({ action: 'teamPayout.create', 'entity.id': new Types.ObjectId(split.id) }).lean();
    expect(entry?.context?.projectId).toBeUndefined();
    expect(String(entry?.context?.clientId)).toBe(String(w.client._id));
    expect((await getActivity({ projectId: ids[1]! })).length).toBe(0);
    const none = await recordPayout(w, { basis: 'other' });
    const bare = await AuditLog.findOne({ action: 'teamPayout.create', 'entity.id': new Types.ObjectId(none.id) }).lean();
    expect(bare?.context?.clientId).toBeUndefined();
  });
});

describe('who may record, edit, pay and void', () => {
  it('recording and editing need teamPayout:record, and a refusal writes nothing', async () => {
    const w = await makePayoutWorld();
    const admin = await sessionFor(await makeAdmin({ grants: ['payment:record', 'payout:record', 'expense:record'] }));
    expect((await rejects(createTeamPayout(admin, payoutBody(w), {}, NOW))).code).toBe('FORBIDDEN');
    expect((await rejects(createTeamPayout(w.personSession, payoutBody(w), {}, NOW))).code).toBe('FORBIDDEN'); // not even for yourself
    expect((await rejects(createTeamPayout(without(w.sa, 'teamPayout:record'), payoutBody(w), {}, NOW))).code).toBe('FORBIDDEN');
    expect(await TeamPayout.countDocuments()).toBe(0);

    const p = await recordPayout(w);
    expect((await rejects(updateTeamPayout(admin, p.id, { note: 'x' }, {}, NOW))).code).toBe('FORBIDDEN');
    expect((await rejects(updateTeamPayout(without(w.sa, 'teamPayout:record'), p.id, { note: 'x' }, {}, NOW))).code).toBe('FORBIDDEN');
    // recording is not paying and not voiding
    const recorder = holding(w.sa, 'teamPayout:record', 'team:payView');
    expect((await rejects(markTeamPayoutPaid(recorder, p.id, PAID, {}, NOW))).code).toBe('FORBIDDEN');
    expect((await rejects(voidTeamPayout(recorder, p.id, { reason: 'because' }, {}, NOW))).code).toBe('FORBIDDEN');
    expect((await TeamPayout.findById(p.id).lean())?.status).toBe('due');
  });

  it('marking paid needs money:approve and voiding needs money:void', async () => {
    const w = await makePayoutWorld();
    const p = await recordPayout(w);
    const admin = await sessionFor(await makeAdmin());
    expect((await rejects(markTeamPayoutPaid(admin, p.id, PAID, {}, NOW))).code).toBe('FORBIDDEN');
    expect((await rejects(markTeamPayoutPaid(without(w.sa, 'money:approve'), p.id, PAID, {}, NOW))).code).toBe('FORBIDDEN');
    expect((await rejects(voidTeamPayout(admin, p.id, { reason: 'because' }, {}, NOW))).code).toBe('FORBIDDEN');
    expect((await rejects(voidTeamPayout(without(w.sa, 'money:void'), p.id, { reason: 'because' }, {}, NOW))).code).toBe('FORBIDDEN');
    expect(await TeamPayout.countDocuments({ status: 'due' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: /^teamPayout\.(mark_paid|void)$/ })).toBe(0);
  });
});

describe('editing a due payout', () => {
  it('changes the amount and recomputes the rate, the INR value and every allocation share', async () => {
    const w = await makePayoutWorld();
    const ids = w.projects.map((p) => String(p._id));
    const p = await recordPayout(w, { allocations: [{ projectId: ids[0]!, amountMinor: 2_000_000 }, { projectId: ids[1]!, amountMinor: 1_000_000 }] });
    const { payout } = await updateTeamPayout(w.sa, p.id, { amountMinor: 3_000_000, allocations: [{ projectId: ids[0]!, amountMinor: 2_000_000 }, { projectId: ids[1]!, amountMinor: 1_000_000 }] }, {}, NOW);
    expect(payout.amount).toMatchObject({ amountMinor: 3_000_000, inrMinor: 3_000_000 });
    expect(payout.detail).toMatchObject({ unallocatedInrMinor: 0 });
    // the same payout in USD: the shares follow the INR value of the new amount
    await usdRate(83.4167, '2026-05-04');
    const { payout: usd } = await updateTeamPayout(w.sa, p.id, { currency: 'USD', amountMinor: 100_001, allocations: [{ projectId: ids[0]!, amountMinor: 66_667 }, { projectId: ids[1]!, amountMinor: 33_334 }] }, {}, NOW);
    expect(usd.amount).toMatchObject({ currency: 'USD', fxSource: 'table', inrMinor: toInrMinor(100_001, 'USD', 83.4167) });
    expect(sum(usd.detail!.allocations.map((a) => a.inrMinor))).toBe(usd.amount.inrMinor);
  });

  it('keeps a rate typed by hand when only the amount changes, and looks the table up again when the date moves', async () => {
    const w = await makePayoutWorld();
    await usdRate(80, '2026-05-04');
    await usdRate(90, '2026-05-20');
    const p = (await createTeamPayout(w.sa, payoutBody(w, { currency: 'USD', amountMinor: 100_000, manualRate: 82 }), {}, NOW)).payout;
    const bigger = (await updateTeamPayout(w.sa, p.id, { amountMinor: 200_000 }, {}, NOW)).payout;
    expect(bigger.amount).toMatchObject({ fxSource: 'manual', fxRate: 82, inrMinor: 16_400_000 });
    const later = (await updateTeamPayout(w.sa, p.id, { dueOn: '2026-05-20', manualRate: 91 }, {}, NOW)).payout;
    expect(later.amount).toMatchObject({ fxRate: 91, fxSource: 'manual' });
    const t = (await createTeamPayout(w.sa, payoutBody(w, { currency: 'USD', amountMinor: 100_000 }), {}, NOW)).payout;
    expect(t.amount.fxRate).toBe(80);
    const moved = (await updateTeamPayout(w.sa, t.id, { dueOn: '2026-05-20' }, {}, NOW)).payout;
    expect(moved.amount).toMatchObject({ fxRate: 90, fxDate: '2026-05-20', fxSource: 'table' });
  });

  it('rejects an edit that leaves the split bigger than the payout, and writes nothing', async () => {
    const w = await makePayoutWorld();
    const ids = w.projects.map((p) => String(p._id));
    const p = await recordPayout(w, { allocations: [{ projectId: ids[0]!, amountMinor: 4_000_000 }] });
    const err = await rejects(updateTeamPayout(w.sa, p.id, { amountMinor: 3_000_000 }, {}, NOW));
    expect(err.fields?.allocations).toMatch(/more than the payout/);
    const stored = await TeamPayout.findById(p.id).lean();
    expect(stored?.amount.amountMinor).toBe(5_000_000);
    expect(await AuditLog.countDocuments({ action: 'teamPayout.update' })).toBe(0);
  });

  it('keeps a project in the split after it was archived, but refuses to add an archived one', async () => {
    const w = await makePayoutWorld();
    const ids = w.projects.map((p) => String(p._id));
    const p = await recordPayout(w, { allocations: [{ projectId: ids[0]!, amountMinor: 1_000_000 }] });
    await Project.updateOne({ _id: w.projects[0]!._id }, { $set: { archivedAt: new Date() } });
    await Project.updateOne({ _id: w.projects[1]!._id }, { $set: { archivedAt: new Date() } });
    const ok = (await updateTeamPayout(w.sa, p.id, { note: 'still fine' }, {}, NOW)).payout;
    expect(ok.detail?.allocations).toHaveLength(1);
    expect((await rejects(updateTeamPayout(w.sa, p.id, { allocations: [{ projectId: ids[0]!, amountMinor: 1_000_000 }, { projectId: ids[1]!, amountMinor: 1 }] }, {}, NOW))).code).toBe('CONFLICT');
  });

  it('takes the proposal again when the period changes, and leaves it alone when only the amount does', async () => {
    const w = await makePayoutWorld({ pay: { basis: 'hourly', rateMinor: 60_000 } });
    await logTime(w, 0, '2026-04-10', 120);
    await logTime(w, 0, '2026-05-10', 600);
    const p = await recordPayout(w, { basis: 'hours', amountMinor: 120_000 });
    expect(p.detail?.suggestion).toMatchObject({ minutes: 120, computedMinor: 120_000 });
    const edited = (await updateTeamPayout(w.sa, p.id, { amountMinor: 150_000 }, {}, NOW)).payout;
    expect(edited.detail?.suggestion).toMatchObject({ minutes: 120, computedMinor: 120_000 }); // still what the system proposed
    const moved = (await updateTeamPayout(w.sa, p.id, { periodFrom: '2026-05-01', periodTo: '2026-05-31' }, {}, NOW)).payout;
    expect(moved.detail?.suggestion).toMatchObject({ minutes: 600, computedMinor: 600_000 });
    const bonus = (await updateTeamPayout(w.sa, p.id, { basis: 'bonus' }, {}, NOW)).payout;
    expect(bonus.detail?.suggestion).toBeNull();
  });

  it('a request that changes nothing writes nothing: no new audit entry', async () => {
    const w = await makePayoutWorld();
    const p = await recordPayout(w, { note: 'Same' });
    await updateTeamPayout(w.sa, p.id, { note: 'Same', amountMinor: 5_000_000, periodFrom: '2026-04-01', dueOn: '2026-05-05' }, {}, NOW);
    expect(await AuditLog.countDocuments({ action: 'teamPayout.update' })).toBe(0);
    await updateTeamPayout(w.sa, p.id, { note: '' }, {}, NOW);
    const entry = await AuditLog.findOne({ action: 'teamPayout.update' }).lean();
    expect(entry?.changes).toEqual([{ path: 'note', before: 'Same', after: null }]);
    expect((await TeamPayout.findById(p.id).lean())?.note).toBeUndefined();
  });

  it('refuses an empty edit, and a paid or void payout cannot be edited at all', async () => {
    const w = await makePayoutWorld();
    const p = await recordPayout(w);
    expect((await rejects(updateTeamPayout(w.sa, p.id, {}, {}, NOW))).code).toBe('VALIDATION_FAILED');
    await markTeamPayoutPaid(w.sa, p.id, PAID, {}, NOW);
    expect((await rejects(updateTeamPayout(w.sa, p.id, { note: 'late' }, {}, NOW))).code).toBe('ENTRY_LOCKED');
    expect((await TeamPayout.findById(p.id).lean())?.note).toBeUndefined();
    await voidTeamPayout(w.sa, p.id, { reason: 'Wrong person' }, {}, NOW);
    expect((await rejects(updateTeamPayout(w.sa, p.id, { note: 'late' }, {}, NOW))).code).toBe('CONFLICT');
    expect((await rejects(updateTeamPayout(w.sa, 'nope', { note: 'x' }, {}, NOW))).code).toBe('NOT_FOUND');
  });
});

describe('marking a payout paid', () => {
  it('records the paid date, mode, reference and who paid, and audits it with the figures', async () => {
    const w = await makePayoutWorld();
    const p = await recordPayout(w);
    const { payout } = await markTeamPayoutPaid(w.sa, p.id, { ...PAID, note: 'Paid from the HDFC account' }, {}, NOW);
    expect(payout).toMatchObject({ status: 'paid', paidOn: '2026-05-10', mode: 'bank_transfer', transactionRef: 'UTR-001' });
    expect(payout.detail).toMatchObject({ paidBy: w.superadmin.name, note: 'Paid from the HDFC account' });
    const entry = await AuditLog.findOne({ action: 'teamPayout.mark_paid' }).lean();
    expect(entry?.entity).toMatchObject({ type: 'teamPayout', ref: p.ref });
    expect(entry?.changes).toEqual(expect.arrayContaining([{ path: 'status', before: 'due', after: 'paid' }, { path: 'transactionRef', after: 'UTR-001' }]));
  });

  it('needs the paid date, a mode from Settings and a reference; not in the future; and only once', async () => {
    const w = await makePayoutWorld();
    const p = await recordPayout(w);
    const bad = (over: Record<string, unknown>) => rejects(markTeamPayoutPaid(w.sa, p.id, { ...PAID, ...over } as never, {}, NOW));
    expect((await bad({ paidOn: undefined })).fields?.paidOn).toBeTruthy();
    expect((await bad({ paidOn: '2026-10-13' })).fields?.paidOn).toMatch(/future/); // tomorrow in India
    expect((await bad({ mode: '' })).fields?.mode).toBeTruthy();
    expect((await bad({ mode: 'barter' })).fields?.mode).toMatch(/Settings/);
    expect((await bad({ transactionRef: '  ' })).fields?.transactionRef).toBeTruthy();
    expect((await bad({ inrMinor: 5 })).code).toBe('VALIDATION_FAILED');
    expect((await TeamPayout.findById(p.id).lean())?.status).toBe('due');

    await markTeamPayoutPaid(w.sa, p.id, PAID, {}, NOW);
    expect((await rejects(markTeamPayoutPaid(w.sa, p.id, PAID, {}, NOW))).code).toBe('CONFLICT');
    expect(await AuditLog.countDocuments({ action: 'teamPayout.mark_paid' })).toBe(1);
  });

  it('captures the rate AGAIN for the paid date: the INR value changes, the amount does not', async () => {
    const w = await makePayoutWorld();
    await usdRate(80, '2026-05-04');
    await usdRate(84, '2026-05-09');
    const p = await recordPayout(w, { currency: 'USD', amountMinor: 100_000 });
    expect(p.amount).toMatchObject({ fxRate: 80, inrMinor: 8_000_000, fxDate: '2026-05-04' });
    const { payout } = await markTeamPayoutPaid(w.sa, p.id, PAID, {}, NOW);
    expect(payout.amount).toEqual({ amountMinor: 100_000, currency: 'USD', fxRate: 84, fxDate: '2026-05-09', fxSource: 'table', inrMinor: 8_400_000 });
    const entry = await AuditLog.findOne({ action: 'teamPayout.mark_paid' }).lean();
    expect(entry?.changes).toEqual(expect.arrayContaining([{ path: 'amount.fxRate', before: 80, after: 84 }, { path: 'amount.inrMinor', before: 8_000_000, after: 8_400_000 }]));
  });

  it('takes the exact rate, or the INR that left the account, for the paid date', async () => {
    const w = await makePayoutWorld();
    await usdRate(80, '2026-05-04');
    await usdRate(80, '2026-05-08');
    const a = await recordPayout(w, { currency: 'USD', amountMinor: 100_000 });
    expect((await markTeamPayoutPaid(w.sa, a.id, { ...PAID, manualRate: 83.1 }, {}, NOW)).payout.amount).toMatchObject({ fxSource: 'manual', fxRate: 83.1, inrMinor: 8_310_000 });
    const b = await recordPayout(w, { currency: 'USD', amountMinor: 100_000 });
    expect((await markTeamPayoutPaid(w.sa, b.id, { ...PAID, settledInrMinor: 8_040_000 }, {}, NOW)).payout.amount).toMatchObject({ fxSource: 'bank', inrMinor: 8_040_000 });
    const c = await recordPayout(w, { currency: 'USD', amountMinor: 100_000 });
    expect((await rejects(markTeamPayoutPaid(w.sa, c.id, { ...PAID, settledInrMinor: 1_000_000 }, {}, NOW))).fields?.settledInrMinor).toMatch(/far from the table rate/);
  });

  it('with no rate for the paid date it answers FX_RATE_MISSING and changes nothing: not the status, not the locks', async () => {
    const w = await makePayoutWorld();
    await usdRate(80, '2026-05-04');
    const log = await logTime(w, 0, '2026-04-10', 60);
    const p = await recordPayout(w, { currency: 'USD', amountMinor: 100_000 });
    const err = await rejects(markTeamPayoutPaid(w.sa, p.id, { ...PAID, paidOn: '2026-06-30' }, {}, NOW)); // 57 days after the only rate
    expect(err.code).toBe('FX_RATE_MISSING');
    expect((await TeamPayout.findById(p.id).lean())?.status).toBe('due');
    expect((await WorkLog.findById(log._id).lean())?.lockedByPayoutId).toBeUndefined();
    expect(await AuditLog.countDocuments({ action: 'teamPayout.mark_paid' })).toBe(0);
  });

  it('recomputes every allocation share from the new INR value: they never exceed the payout, and project margins read them', async () => {
    const w = await makePayoutWorld();
    await usdRate(83.4167, '2026-05-04');
    await usdRate(84.0833, '2026-05-09');
    const ids = w.projects.map((p) => String(p._id));
    const p = await recordPayout(w, {
      currency: 'USD',
      amountMinor: 100_001,
      allocations: [
        { projectId: ids[0]!, amountMinor: 33_334 },
        { projectId: ids[1]!, amountMinor: 33_334 },
        { projectId: ids[2]!, amountMinor: 33_333 },
      ],
    });
    expect(sum(p.detail!.allocations.map((a) => a.inrMinor))).toBe(toInrMinor(100_001, 'USD', 83.4167));

    const { payout } = await markTeamPayoutPaid(w.sa, p.id, PAID, {}, NOW);
    const newInr = toInrMinor(100_001, 'USD', 84.0833);
    expect(payout.amount.inrMinor).toBe(newInr);
    const shares = payout.detail!.allocations.map((a) => a.inrMinor);
    expect(sum(shares)).toBe(newInr); // fully allocated: exactly the new INR value
    expect(payout.detail!.unallocatedInrMinor).toBe(0);
    expect(payout.detail!.allocations.map((a) => a.amountMinor)).toEqual([33_334, 33_334, 33_333]); // native amounts untouched

    // the ledger sums the allocation shares of PAID payouts per project
    const margins = await getProjectMargins(undefined, ids);
    const byProject = new Map(margins.map((m) => [m.projectId, m.teamInr]));
    expect(ids.map((id) => byProject.get(id))).toEqual(shares);
    expect(sum([...byProject.values()])).toBe(newInr);
  });

  it('a payout allocated in part leaves the rest as overhead that follows the new rate', async () => {
    const w = await makePayoutWorld();
    await usdRate(80, '2026-05-04');
    await usdRate(85, '2026-05-09');
    const ids = w.projects.map((p) => String(p._id));
    const p = await recordPayout(w, { currency: 'USD', amountMinor: 100_000, allocations: [{ projectId: ids[0]!, amountMinor: 25_000 }] });
    expect(p.detail).toMatchObject({ allocatedInrMinor: 2_000_000, unallocatedInrMinor: 6_000_000 });
    const { payout } = await markTeamPayoutPaid(w.sa, p.id, PAID, {}, NOW);
    expect(payout.detail).toMatchObject({ allocatedInrMinor: 2_125_000, unallocatedInrMinor: 6_375_000 });
  });

  it('locks THIS person\'s work logs dated inside the period, and only those, in the same transaction as the status', async () => {
    const w = await makePayoutWorld();
    const inside = [await logTime(w, 0, '2026-04-01', 60), await logTime(w, 1, '2026-04-15', 60), await logTime(w, 2, '2026-04-30', 60)];
    await logTime(w, 0, '2026-03-31', 60);
    await logTime(w, 0, '2026-05-01', 60);
    const colleague = await makeAdmin();
    const theirs = await (await import('@/test/team-factories')).makeWorkLog(colleague, w.tasks[0]!, { workedOn: '2026-04-10', minutes: 60 });
    const p = await recordPayout(w);
    const { payout } = await markTeamPayoutPaid(w.sa, p.id, PAID, {}, NOW);
    expect(await lockedLogIds(w.person._id)).toEqual(inside.map((l) => String(l._id)).sort());
    expect((await WorkLog.findById(theirs._id).lean())?.lockedByPayoutId).toBeUndefined();
    expect(payout.detail?.lockedLogs).toBe(3);
    expect((await WorkLog.findById(inside[0]!._id).lean())?.lockedByPayoutId?.toString()).toBe(p.id);
    const entry = await AuditLog.findOne({ action: 'teamPayout.mark_paid' }).lean();
    expect(entry?.changes).toEqual(expect.arrayContaining([{ path: 'workLogsLocked', after: 3 }]));
    expect((await getTeamPayout(w.sa, p.id, NOW)).detail?.lockedLogs).toBe(3);
  });

  it('the work-log rules then refuse to edit, delete or add time inside the paid period', async () => {
    const w = await makePayoutWorld();
    const log = await logTime(w, 0, '2026-04-10', 60);
    const p = await recordPayout(w);
    await markTeamPayoutPaid(w.sa, p.id, PAID, {}, NOW);
    const me = w.personSession;
    expect((await rejects(updateWorkLog(w.sa, String(log._id), { minutes: 30 }))).code).toBe('ENTRY_LOCKED');
    expect((await rejects(deleteWorkLog(w.sa, String(log._id)))).code).toBe('ENTRY_LOCKED');
    expect((await rejects(createWorkLog(me, { taskId: String(w.tasks[0]!._id), workedOn: '2026-04-20', minutes: 30, note: 'late entry' }))).code).toBe('ENTRY_LOCKED');
    expect((await WorkLog.findById(log._id).lean())?.minutes).toBe(60);
  });

  it('does not take over logs another paid payout already holds when periods overlap', async () => {
    const w = await makePayoutWorld();
    const log = await logTime(w, 0, '2026-04-20', 60);
    const a = await recordPayout(w, { periodFrom: '2026-04-01', periodTo: '2026-04-30' });
    const b = await recordPayout(w, { periodFrom: '2026-04-15', periodTo: '2026-05-15' });
    await markTeamPayoutPaid(w.sa, a.id, PAID, {}, NOW);
    const second = await markTeamPayoutPaid(w.sa, b.id, { ...PAID, transactionRef: 'UTR-002' }, {}, NOW);
    expect((await WorkLog.findById(log._id).lean())?.lockedByPayoutId?.toString()).toBe(a.id);
    expect(second.warnings.join(' ')).toContain(a.ref); // the overlap is reported when paying
  });

  it('a log being added at the very moment of payment cannot end up unlocked inside the paid period', async () => {
    for (let round = 0; round < 4; round++) {
      const w = await makePayoutWorld();
      const p = await recordPayout(w, { periodFrom: '2026-04-01', periodTo: '2026-04-30' });
      const add = createWorkLog(w.personSession, { taskId: String(w.tasks[0]!._id), workedOn: '2026-04-15', minutes: 45, note: 'raced the payout' });
      const pay = markTeamPayoutPaid(w.sa, p.id, PAID, {}, NOW);
      const [added, paid] = await Promise.allSettled([add, pay]);
      expect(paid.status).toBe('fulfilled');
      const logs = await WorkLog.find({ adminId: w.person._id }).lean();
      if (added.status === 'fulfilled') {
        // it got in first: it must be locked
        expect(logs).toHaveLength(1);
        expect(logs[0]?.lockedByPayoutId?.toString()).toBe(p.id);
      } else {
        // it lost: refused as locked, and nothing slipped in
        expect((added.reason as { code?: string }).code).toBe('ENTRY_LOCKED');
        expect(logs).toHaveLength(0);
      }
    }
  });

  it('the person, a colleague and an admin holding every grantable capability cannot pay', async () => {
    const w = await makePayoutWorld();
    const p = await recordPayout(w);
    const granted = await sessionFor(await makeAdmin({ grants: ['payment:record', 'payout:record', 'expense:record', 'content:publish', 'fx:edit', 'export:data'] }));
    for (const who of [w.personSession, granted]) {
      expect((await rejects(markTeamPayoutPaid(who, p.id, PAID, {}, NOW))).code).toBe('FORBIDDEN');
    }
    expect((await TeamPayout.findById(p.id).lean())?.status).toBe('due');
  });
});

describe('voiding a payout', () => {
  it('needs a reason, marks it void, keeps it on record and audits it', async () => {
    const w = await makePayoutWorld();
    const p = await recordPayout(w);
    expect((await rejects(voidTeamPayout(w.sa, p.id, { reason: '' }, {}, NOW))).fields?.reason).toBeTruthy();
    expect((await rejects(voidTeamPayout(w.sa, p.id, { reason: 'ab' }, {}, NOW))).fields?.reason).toBeTruthy();
    expect((await TeamPayout.findById(p.id).lean())?.status).toBe('due');
    const { payout } = await voidTeamPayout(w.sa, p.id, { reason: 'Entered for the wrong month' }, {}, NOW);
    expect(payout).toMatchObject({ status: 'void' });
    expect(payout.detail).toMatchObject({ voidReason: 'Entered for the wrong month', voidedBy: w.superadmin.name });
    expect(payout.detail?.voidedAt).toBeTruthy();
    expect(await TeamPayout.countDocuments()).toBe(1); // never deleted
    const entry = await AuditLog.findOne({ action: 'teamPayout.void' }).lean();
    expect(entry).toMatchObject({ summary: 'Entered for the wrong month', entity: { ref: p.ref } });
    expect(entry?.changes).toEqual(expect.arrayContaining([{ path: 'status', before: 'due', after: 'void' }]));
    expect((await rejects(voidTeamPayout(w.sa, p.id, { reason: 'again' }, {}, NOW))).code).toBe('CONFLICT');
    expect((await rejects(markTeamPayoutPaid(w.sa, p.id, PAID, {}, NOW))).code).toBe('CONFLICT');
  });

  it('releases the work logs a paid payout locked, and the work-log rules accept edits again', async () => {
    const w = await makePayoutWorld();
    const log = await logTime(w, 0, '2026-04-10', 60);
    const p = await recordPayout(w);
    await markTeamPayoutPaid(w.sa, p.id, PAID, {}, NOW);
    expect(await lockedLogIds(w.person._id)).toHaveLength(1);
    const { payout } = await voidTeamPayout(w.sa, p.id, { reason: 'Paid the wrong amount' }, {}, NOW);
    expect(payout.detail?.lockedLogs).toBe(0);
    expect(await lockedLogIds(w.person._id)).toEqual([]);
    expect((await updateWorkLog(w.sa, String(log._id), { minutes: 90 })).minutes).toBe(90);
    const entry = await AuditLog.findOne({ action: 'teamPayout.void' }).lean();
    expect(entry?.changes).toEqual(expect.arrayContaining([{ path: 'workLogsUnlocked', after: 1 }]));
  });

  it('voiding a due payout touches no log, and voiding a paid one re-locks logs that another paid payout still covers', async () => {
    const w = await makePayoutWorld();
    const log = await logTime(w, 0, '2026-04-20', 60);
    const a = await recordPayout(w, { periodFrom: '2026-04-01', periodTo: '2026-04-30' });
    const b = await recordPayout(w, { periodFrom: '2026-04-15', periodTo: '2026-05-15' });
    await markTeamPayoutPaid(w.sa, a.id, PAID, {}, NOW);
    await markTeamPayoutPaid(w.sa, b.id, { ...PAID, transactionRef: 'UTR-002' }, {}, NOW);
    await voidTeamPayout(w.sa, a.id, { reason: 'Superseded by the next one' }, {}, NOW);
    expect((await WorkLog.findById(log._id).lean())?.lockedByPayoutId?.toString()).toBe(b.id); // still covered by the other paid payout
    await voidTeamPayout(w.sa, b.id, { reason: 'Superseded too' }, {}, NOW);
    expect((await WorkLog.findById(log._id).lean())?.lockedByPayoutId).toBeUndefined();

    const c = await recordPayout(w);
    await voidTeamPayout(w.sa, c.id, { reason: 'Never paid' }, {}, NOW);
    expect(await lockedLogIds(w.person._id)).toEqual([]);
  });

  it('keeps a void payout out of every total and of the project margins', async () => {
    const w = await makePayoutWorld();
    const ids = w.projects.map((p) => String(p._id));
    const p = await recordPayout(w, { allocations: [{ projectId: ids[0]!, amountMinor: 1_000_000 }] });
    await markTeamPayoutPaid(w.sa, p.id, PAID, {}, NOW);
    expect((await getProjectMargins(undefined, ids)).find((m) => m.projectId === ids[0])?.teamInr).toBe(1_000_000);
    await voidTeamPayout(w.sa, p.id, { reason: 'Reversed by the bank' }, {}, NOW);
    expect((await getProjectMargins(undefined, ids)).find((m) => m.projectId === ids[0])?.teamInr).toBe(0);
  });
});

describe('every write is one transaction with its audit entry', () => {
  it('creating: when the audit write fails there is no payout and no consumed reference number', async () => {
    const w = await makePayoutWorld();
    vi.spyOn(auditModule, 'audit').mockRejectedValue(new Error('audit down'));
    await rejects(createTeamPayout(w.sa, payoutBody(w), {}, NOW));
    vi.restoreAllMocks();
    expect(await TeamPayout.countDocuments()).toBe(0);
    expect(await Counter.countDocuments({ _id: /^teamPayout:/ })).toBe(0);
  });

  it('editing: when the audit write fails the payout is as it was', async () => {
    const w = await makePayoutWorld();
    const p = await recordPayout(w);
    vi.spyOn(auditModule, 'audit').mockRejectedValue(new Error('audit down'));
    await rejects(updateTeamPayout(w.sa, p.id, { amountMinor: 1_000_000, note: 'changed' }, {}, NOW));
    vi.restoreAllMocks();
    const stored = await TeamPayout.findById(p.id).lean();
    expect(stored?.amount.amountMinor).toBe(5_000_000);
    expect(stored?.note).toBeUndefined();
  });

  it('paying: when the audit write fails the status, the rate, the allocations and the locks all roll back', async () => {
    const w = await makePayoutWorld();
    await usdRate(80, '2026-05-04');
    await usdRate(84, '2026-05-09');
    const logs = [await logTime(w, 0, '2026-04-10', 60), await logTime(w, 1, '2026-04-11', 60)];
    const p = await recordPayout(w, { currency: 'USD', amountMinor: 100_000, allocations: [{ projectId: String(w.projects[0]!._id), amountMinor: 50_000 }] });
    vi.spyOn(auditModule, 'audit').mockRejectedValue(new Error('audit down'));
    await rejects(markTeamPayoutPaid(w.sa, p.id, PAID, {}, NOW));
    vi.restoreAllMocks();
    const stored = await TeamPayout.findById(p.id).lean();
    expect(stored).toMatchObject({ status: 'due', amount: { fxRate: 80, inrMinor: 8_000_000 } });
    expect(stored?.paidOn).toBeUndefined();
    expect(stored?.allocations[0]?.inrMinor).toBe(4_000_000);
    expect(await lockedLogIds(w.person._id)).toEqual([]);
    expect(logs).toHaveLength(2);
    // and the payment can still be made afterwards
    expect((await markTeamPayoutPaid(w.sa, p.id, PAID, {}, NOW)).payout.status).toBe('paid');
  });

  it('voiding: when the audit write fails a paid payout stays paid and its logs stay locked', async () => {
    const w = await makePayoutWorld();
    await logTime(w, 0, '2026-04-10', 60);
    const p = await recordPayout(w);
    await markTeamPayoutPaid(w.sa, p.id, PAID, {}, NOW);
    vi.spyOn(auditModule, 'audit').mockRejectedValue(new Error('audit down'));
    await rejects(voidTeamPayout(w.sa, p.id, { reason: 'Wrong person' }, {}, NOW));
    vi.restoreAllMocks();
    expect((await TeamPayout.findById(p.id).lean())?.status).toBe('paid');
    expect(await lockedLogIds(w.person._id)).toHaveLength(1);
  });

  it('corrupt stored allocations (more than the payout) stop the payment with nothing changed', async () => {
    const w = await makePayoutWorld();
    await logTime(w, 0, '2026-04-10', 60);
    const p = await recordPayout(w);
    await TeamPayout.collection.updateOne({ _id: new Types.ObjectId(p.id) }, { $set: { allocations: [{ clientId: w.client._id, projectId: w.projects[0]!._id, amountMinor: 6_000_000, inrMinor: 6_000_000 }] } });
    await rejects(markTeamPayoutPaid(w.sa, p.id, PAID, {}, NOW));
    expect((await TeamPayout.findById(p.id).lean())?.status).toBe('due');
    expect(await lockedLogIds(w.person._id)).toEqual([]);
    expect(await AuditLog.countDocuments({ action: 'teamPayout.mark_paid' })).toBe(0);
  });
});

describe('paid payouts really are immutable', () => {
  it('no service function changes a paid payout apart from voiding it', async () => {
    const w = await makePayoutWorld();
    const p = await recordPayout(w);
    await markTeamPayoutPaid(w.sa, p.id, PAID, {}, NOW);
    const before = await TeamPayout.findById(p.id).lean();
    expect((await rejects(updateTeamPayout(w.sa, p.id, { amountMinor: 1 }, {}, NOW))).code).toBe('ENTRY_LOCKED');
    expect((await rejects(markTeamPayoutPaid(w.sa, p.id, { ...PAID, transactionRef: 'other' }, {}, NOW))).code).toBe('CONFLICT');
    expect(await TeamPayout.findById(p.id).lean()).toEqual(before);
  });
});

describe('writes that race each other', () => {
  it('two payments of the same payout at once: exactly one wins, one audit entry, the logs locked once', async () => {
    const w = await makePayoutWorld();
    await logTime(w, 0, '2026-04-10', 60);
    const p = await recordPayout(w);
    const [a, b] = await Promise.allSettled([markTeamPayoutPaid(w.sa, p.id, PAID, {}, NOW), markTeamPayoutPaid(w.sa, p.id, { ...PAID, transactionRef: 'UTR-002' }, {}, NOW)]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    const lost = (a.status === 'rejected' ? a : b) as PromiseRejectedResult;
    expect((lost.reason as { code?: string }).code).toBe('CONFLICT');
    expect(await AuditLog.countDocuments({ action: 'teamPayout.mark_paid' })).toBe(1);
    expect(await lockedLogIds(w.person._id)).toHaveLength(1);
  });

  it('paying and voiding at once always ends void, with nothing left locked', async () => {
    for (let round = 0; round < 3; round++) {
      const w = await makePayoutWorld();
      await logTime(w, 0, '2026-04-10', 60);
      const p = await recordPayout(w);
      await Promise.allSettled([markTeamPayoutPaid(w.sa, p.id, PAID, {}, NOW), voidTeamPayout(w.sa, p.id, { reason: 'Changed our minds' }, {}, NOW)]);
      expect((await TeamPayout.findById(p.id).lean())?.status).toBe('void');
      expect(await lockedLogIds(w.person._id)).toEqual([]);
    }
  });

  it('an edit racing the payment either lands before it (and is what gets paid) or is refused as locked', async () => {
    for (let round = 0; round < 3; round++) {
      const w = await makePayoutWorld();
      const p = await recordPayout(w);
      const [edit, pay] = await Promise.allSettled([updateTeamPayout(w.sa, p.id, { amountMinor: 4_000_000 }, {}, NOW), markTeamPayoutPaid(w.sa, p.id, PAID, {}, NOW)]);
      expect(pay.status).toBe('fulfilled');
      const stored = await TeamPayout.findById(p.id).lean();
      expect(stored?.status).toBe('paid');
      if (edit.status === 'fulfilled') expect(stored?.amount.amountMinor).toBe(4_000_000);
      else {
        expect((edit.reason as { code?: string }).code).toBe('ENTRY_LOCKED');
        expect(stored?.amount.amountMinor).toBe(5_000_000);
      }
    }
  });

  it('payouts recorded at the same moment get different reference numbers', async () => {
    const w = await makePayoutWorld();
    const all = await Promise.all([1, 2, 3, 4].map(() => recordPayout(w, { basis: 'bonus' })));
    expect(new Set(all.map((p) => p.ref)).size).toBe(4);
    expect(all.map((p) => p.ref).sort()).toEqual(['TMP-FY27-0001', 'TMP-FY27-0002', 'TMP-FY27-0003', 'TMP-FY27-0004']);
  });
});
