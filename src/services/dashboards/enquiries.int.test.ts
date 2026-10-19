import { describe, expect, it } from 'vitest';
import type { Capability } from '@/config/capabilities';
import { resolvePeriod } from '@/lib/dates/ranges';
import { Settings } from '@/models';
import { getEnquiriesDashboard, medianOf, weekStarts } from '@/services/dashboards/enquiries';
import { makeAdmin, sessionFor } from '@/test/factories';
import { dateOnly, makeLead, makeService } from '@/test/lead-factories';
import { setupTestDb } from '@/test/db';
import type { SessionUser } from '@/types/session';

setupTestDb();

// Wednesday 14 Oct 2026, 15:30 in India: inside FY27 (1 Apr 2026 to 31 Mar 2027).
const NOW = new Date('2026-10-14T10:00:00Z');
const FY = resolvePeriod({}, NOW);
const at = (iso: string) => new Date(iso);
const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60_000);

describe('pure helpers', () => {
  it('medianOf takes the middle, or the mean of the two middle values, and is null for nothing', () => {
    expect(medianOf([])).toBeNull();
    expect(medianOf([5])).toBe(5);
    expect(medianOf([1, 3, 9])).toBe(3);
    expect(medianOf([1, 3, 9, 11])).toBe(6);
  });
  it('weekStarts lists every Monday from the week containing the start up to the end', () => {
    // 1 Apr 2026 is a Wednesday, so the first week starts on Monday 30 Mar
    const weeks = weekStarts(dateOnly('2026-04-01'), dateOnly('2026-10-14'));
    expect(weeks[0]).toBe('2026-03-30');
    expect(weeks.at(-1)).toBe('2026-10-12');
    expect(weeks).toHaveLength(29);
    expect(weekStarts(dateOnly('2026-10-12'), dateOnly('2026-10-12'))).toEqual(['2026-10-12']); // a Monday is its own week
    expect(weekStarts(dateOnly('2026-10-18'), dateOnly('2026-10-18'))).toEqual(['2026-10-12']); // a Sunday belongs to the week before
    expect(weekStarts(dateOnly('2026-10-20'), dateOnly('2026-10-14'))).toEqual([]);
  });
});

describe('who may see it', () => {
  it('needs lead:view', async () => {
    const viewer: SessionUser = { ...(await sessionFor(await makeAdmin())), capabilities: new Set<Capability>(['dashboard:view']) };
    await expect(getEnquiriesDashboard(viewer, FY, { now: NOW })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('an empty database', () => {
  it('shows zeros, no ratios, and an empty (but week-complete) chart set', async () => {
    const d = await getEnquiriesDashboard(await sessionFor(await makeAdmin()), FY, { now: NOW });
    expect(d).toMatchObject({
      period: { from: '2026-04-01', to: '2027-03-31' },
      newInPeriod: 0,
      spamInPeriod: 0,
      open: { total: 0, byStatus: [{ status: 'new', count: 0 }, { status: 'contacted', count: 0 }, { status: 'qualified', count: 0 }, { status: 'proposal_sent', count: 0 }] },
      waitingForFirstReply: 0,
      firstReply: { medianMinutes: null, replied: 0 },
      conversion: { won: 0, lost: 0, rate: null },
      followUpsDue: 0,
      byService: [],
      byBudget: [],
      bySourcePath: [],
      byUtmSource: [],
    });
    expect(d.funnel.map((f) => f.count)).toEqual([0, 0, 0, 0, 0]);
    expect(d.funnel.map((f) => f.label)).toEqual(['Received', 'Contacted', 'Qualified', 'Proposal sent', 'Won']);
    // weeks run from the start of the year to this week and are all zero: the chart decides to show its empty state
    expect(d.perWeek).toHaveLength(29);
    expect(d.perWeek.every((w) => w.count === 0)).toBe(true);
  });
});

describe('the figures, from records', () => {
  async function seed() {
    await Settings.create({ budgetRanges: ['Under 5 lakh', '5 to 15 lakh'] });
    const web = await makeService({ title: 'Web apps' });
    const mobile = await makeService({ title: 'Mobile apps' });

    const l1 = at('2026-10-12T09:00:00Z'); // Monday, won after a 30 minute first reply
    await makeLead({ name: 'L1', status: 'won', history: [{ to: 'contacted' }, { to: 'qualified' }, { to: 'won' }], createdAt: l1, firstResponseAt: plus(l1, 30), serviceIds: [web._id], budgetRange: '5 to 15 lakh', sourcePath: '/contact', utm: { source: 'google' }, followUpOn: dateOnly('2026-10-01') });
    const l2 = at('2026-10-13T09:00:00Z'); // lost after a 2 hour first reply
    await makeLead({ name: 'L2', status: 'lost', history: [{ to: 'contacted' }, { to: 'lost' }], createdAt: l2, firstResponseAt: plus(l2, 120), serviceIds: [web._id, mobile._id], budgetRange: '5 to 15 lakh', sourcePath: '/' });
    await makeLead({ name: 'L3', status: 'new', createdAt: at('2026-10-14T08:00:00Z'), sourcePath: '/contact', utm: { source: 'google' }, followUpOn: dateOnly('2026-10-14') });
    const l4 = at('2026-10-05T09:00:00Z');
    await makeLead({ name: 'L4', status: 'contacted', createdAt: l4, firstResponseAt: plus(l4, 60), serviceIds: [mobile._id], followUpOn: dateOnly('2026-10-01') });
    const l5 = at('2026-10-06T09:00:00Z');
    await makeLead({ name: 'L5', status: 'proposal_sent', history: [{ to: 'contacted' }, { to: 'qualified' }, { to: 'proposal_sent' }], createdAt: l5, firstResponseAt: plus(l5, 210), followUpOn: dateOnly('2026-10-20') });
    await makeLead({ name: 'L6 spam', status: 'spam', createdAt: at('2026-10-07T09:00:00Z'), serviceIds: [web._id], sourcePath: '/spam', utm: { source: 'bot' }, followUpOn: dateOnly('2026-10-01') });
    await makeLead({ name: 'L7 before the year', status: 'new', createdAt: at('2026-03-15T09:00:00Z'), followUpOn: dateOnly('2026-03-20') });
    const l8 = at('2026-09-01T09:00:00Z'); // won straight away, never qualified
    await makeLead({ name: 'L8', status: 'won', createdAt: l8, firstResponseAt: plus(l8, 10) });
  }

  it('counts what was received in the period (spam apart) and what is open right now', async () => {
    await seed();
    const d = await getEnquiriesDashboard(await sessionFor(await makeAdmin()), FY, { now: NOW });
    expect(d.newInPeriod).toBe(6); // L1 L2 L3 L4 L5 L8
    expect(d.spamInPeriod).toBe(1);
    // snapshot, not period-bound: L7 (received before the year) is still open
    expect(d.open.byStatus).toEqual([
      { status: 'new', count: 2 }, // L3, L7
      { status: 'contacted', count: 1 }, // L4
      { status: 'qualified', count: 0 },
      { status: 'proposal_sent', count: 1 }, // L5
    ]);
    expect(d.open.total).toBe(4);
    expect(d.waitingForFirstReply).toBe(2);
  });

  it('follow-ups due: open enquiries dated today or earlier, in the organisation zone; closed, future and spam ones do not count', async () => {
    await seed();
    const d = await getEnquiriesDashboard(await sessionFor(await makeAdmin()), FY, { now: NOW });
    // L3 (today), L4 (1 Oct) and L7 (20 Mar): open and due. L1 is won, L5 is 20 Oct, L6 is spam.
    expect(d.followUpsDue).toBe(3);
    // 20:00 UTC on 14 Oct is already 15 Oct in India: nothing changes for these dates
    expect((await getEnquiriesDashboard(await sessionFor(await makeAdmin()), FY, { now: at('2026-10-20T20:00:00Z') })).followUpsDue).toBe(4); // L5 is due by 21 Oct IST
  });

  it('median first reply is the middle of created-to-first-response times, over the period\'s enquiries that have one', async () => {
    await seed();
    const d = await getEnquiriesDashboard(await sessionFor(await makeAdmin()), FY, { now: NOW });
    // L8 10 min, L1 30, L4 60, L2 120, L5 210 -> median 60. L3 (no reply) and the spam one are left out.
    expect(d.firstReply).toEqual({ medianMinutes: 60, replied: 5 });
  });

  it('conversion is won over won plus lost, for the period\'s enquiries', async () => {
    await seed();
    const d = await getEnquiriesDashboard(await sessionFor(await makeAdmin()), FY, { now: NOW });
    expect(d.conversion).toEqual({ won: 2, lost: 1, rate: 2 / 3 });
  });

  it('conversion stays null until something is decided', async () => {
    await makeLead({ status: 'contacted', createdAt: at('2026-10-12T09:00:00Z') });
    const d = await getEnquiriesDashboard(await sessionFor(await makeAdmin()), FY, { now: NOW });
    expect(d.conversion).toEqual({ won: 0, lost: 0, rate: null });
    await makeLead({ status: 'lost', createdAt: at('2026-10-12T09:00:00Z') });
    expect((await getEnquiriesDashboard(await sessionFor(await makeAdmin()), FY, { now: NOW })).conversion).toEqual({ won: 0, lost: 1, rate: 0 });
  });

  it('the funnel counts how far each enquiry ever got, including ones that were later lost', async () => {
    await seed();
    const d = await getEnquiriesDashboard(await sessionFor(await makeAdmin()), FY, { now: NOW });
    // L2 was contacted before it was lost, so it reached "contacted" but not "qualified". L8 went straight to won.
    expect(d.funnel).toEqual([
      { stage: 'new', label: 'Received', count: 6 },
      { stage: 'contacted', label: 'Contacted', count: 5 },
      { stage: 'qualified', label: 'Qualified', count: 3 },
      { stage: 'proposal_sent', label: 'Proposal sent', count: 3 },
      { stage: 'won', label: 'Won', count: 2 },
    ]);
    for (let i = 1; i < d.funnel.length; i++) expect(d.funnel[i]!.count).toBeLessThanOrEqual(d.funnel[i - 1]!.count);
  });

  it('enquiries per week: Monday-start weeks in the organisation zone, zero-filled up to this week', async () => {
    await seed();
    const d = await getEnquiriesDashboard(await sessionFor(await makeAdmin()), FY, { now: NOW });
    const counts = Object.fromEntries(d.perWeek.filter((w) => w.count > 0).map((w) => [w.weekStart, w.count]));
    expect(counts).toEqual({ '2026-08-31': 1, '2026-10-05': 2, '2026-10-12': 3 });
    expect(d.perWeek.reduce((s, w) => s + w.count, 0)).toBe(d.newInPeriod);
    expect(d.perWeek[0]).toMatchObject({ weekStart: '2026-03-30', count: 0 });
    expect(d.perWeek.at(-1)).toMatchObject({ weekStart: '2026-10-12', label: '12 Oct' });
  });

  it('puts an enquiry from just after midnight in India in the new week, not the old one', async () => {
    // 19:00 UTC on Sunday 11 Oct is 00:30 on Monday 12 Oct in India
    await makeLead({ createdAt: at('2026-10-11T19:00:00Z') });
    const d = await getEnquiriesDashboard(await sessionFor(await makeAdmin()), FY, { now: NOW });
    expect(d.perWeek.find((w) => w.count > 0)?.weekStart).toBe('2026-10-12');
  });

  it('breaks enquiries down by service, budget range, source page and UTM source, with readable labels for "none"', async () => {
    await seed();
    const d = await getEnquiriesDashboard(await sessionFor(await makeAdmin()), FY, { now: NOW });
    expect(d.byService).toEqual([
      { label: 'No service chosen', count: 3 },
      { label: 'Mobile apps', count: 2 },
      { label: 'Web apps', count: 2 },
    ]);
    // configured ranges first, in the configured order; then what was not given
    expect(d.byBudget).toEqual([{ label: '5 to 15 lakh', count: 2 }, { label: 'Not given', count: 4 }]);
    expect(d.bySourcePath).toEqual([{ label: 'Unknown', count: 3 }, { label: '/contact', count: 2 }, { label: '/', count: 1 }]);
    expect(d.byUtmSource).toEqual([{ label: 'Direct or untagged', count: 4 }, { label: 'google', count: 2 }]);
  });

  it('keeps naming a removed or archived service, and folds a long tail into "Other"', async () => {
    const archived = await makeService({ title: 'Old offer', status: 'archived' });
    await makeLead({ serviceIds: [archived._id], createdAt: at('2026-10-12T09:00:00Z') });
    for (let i = 0; i < 9; i++) await makeLead({ createdAt: at('2026-10-12T09:00:00Z'), sourcePath: `/page-${i}` });
    const d = await getEnquiriesDashboard(await sessionFor(await makeAdmin()), FY, { now: NOW });
    expect(d.byService.find((s) => s.label === 'Old offer')?.count).toBe(1);
    expect(d.bySourcePath).toHaveLength(9); // top 8 plus "Other"
    expect(d.bySourcePath.at(-1)).toEqual({ label: 'Other', count: 2 });
    expect(d.bySourcePath.reduce((s, r) => s + r.count, 0)).toBe(10);
  });

  it('the period changes the cohort figures but not the snapshots', async () => {
    await seed();
    const october = resolvePeriod({ period: 'custom', from: '2026-10-12', to: '2026-10-14' }, NOW);
    const d = await getEnquiriesDashboard(await sessionFor(await makeAdmin()), october, { now: NOW });
    expect(d.newInPeriod).toBe(3); // L1 L2 L3
    expect(d.spamInPeriod).toBe(0);
    expect(d.open.total).toBe(4); // unchanged
    expect(d.followUpsDue).toBe(3); // unchanged
    expect(d.conversion).toEqual({ won: 1, lost: 1, rate: 0.5 });
    expect(d.firstReply).toEqual({ medianMinutes: 75, replied: 2 }); // 30 and 120
    expect(d.perWeek).toHaveLength(1); // only the week the range starts in, through the range end
  });

  it('includes the first instant of the period and excludes the instant it ends at', async () => {
    const period = resolvePeriod({ period: 'custom', from: '2026-10-12', to: '2026-10-12' }, NOW);
    await makeLead({ name: 'on the first instant', createdAt: period.fromInstant });
    await makeLead({ name: 'one ms before', createdAt: new Date(period.fromInstant.getTime() - 1) });
    await makeLead({ name: 'on the end instant', createdAt: period.toInstant });
    await makeLead({ name: 'one ms before the end', createdAt: new Date(period.toInstant.getTime() - 1) });
    const d = await getEnquiriesDashboard(await sessionFor(await makeAdmin()), period, { now: NOW });
    expect(d.newInPeriod).toBe(2);
  });
});
