import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { formatInr } from '@/lib/admin/format';
import type { OverviewDashboard } from '@/services/dashboards/overview';
import { buildMoneyStats, buildWorkStats, periodTag } from './overview-stats';
import { TopProjectsPanel } from './top-projects';

const period: OverviewDashboard['period'] = { key: 'this_fy', label: 'This financial year', fyLabel: 'FY27', from: '2026-04-01', to: '2027-03-31' };

const none: OverviewDashboard['money'] = { net: null, received: null, thirdParties: null, expenses: null, team: null, outstanding: null, payables: null };

function dashboard(o: Partial<OverviewDashboard> = {}): OverviewDashboard {
  return {
    period,
    money: none,
    cashFlow: null,
    topProjects: null,
    projects: null,
    tasks: null,
    enquiries: null,
    activity: { scope: 'own', entries: [] },
    setup: { hasClients: null, hasProjects: null },
    ...o,
  };
}

const full: OverviewDashboard['money'] = {
  net: { inrMinor: 8_336_200 },
  received: { inrMinor: 10_810_400 },
  thirdParties: { inrMinor: 1_184_200, payouts: 3 },
  expenses: { inrMinor: 290_000, count: 1 },
  team: { inrMinor: 1_000_000 },
  outstanding: { inrMinor: 51_178_000, missingRates: [], overdueMilestones: 0 },
  payables: { inrMinor: 970_000, duePayouts: { inrMinor: 900_000, count: 1, overdueCount: 0 }, reimbursements: { inrMinor: 70_000, count: 1 } },
};

const labels = (stats: Array<{ label: string }>) => stats.map((s) => s.label);

describe('periodTag', () => {
  it('uses the financial year when there is one, else the period\'s own words', () => {
    expect(periodTag(period)).toBe('FY27');
    expect(periodTag({ ...period, key: 'this_month', label: 'This month', fyLabel: null })).toBe('This month');
  });
});

describe('the money tiles', () => {
  it('lead with company net, then the four ledgers, then what is owed each way', () => {
    expect(labels(buildMoneyStats(dashboard({ money: full }), {}))).toEqual([
      'Company net', 'Received from clients', 'Paid to third parties', 'Expenses', 'Team payouts', 'Outstanding from clients', 'Payables',
    ]);
  });

  it('lead with the first tile the viewer may see when there is no net', () => {
    const stats = buildMoneyStats(dashboard({ money: { ...none, received: full.received, outstanding: full.outstanding } }), {});
    expect(labels(stats)).toEqual(['Received from clients', 'Outstanding from clients']);
  });

  it('leave out every tile the viewer may not see, and the whole band when that is all of them', () => {
    expect(buildMoneyStats(dashboard(), {})).toEqual([]);
    expect(labels(buildMoneyStats(dashboard({ money: { ...none, team: full.team } }), {}))).toEqual(['Team payouts']);
  });

  it('format INR with Indian grouping and name the period in the sub-line', () => {
    const [net, received, thirdParties] = buildMoneyStats(dashboard({ money: full }), {});
    expect(net?.value).toBe(formatInr(8_336_200));
    expect(String(net?.value)).toBe('₹83,362.00');
    expect(received?.sub).toBe('FY27, net of refunds');
    expect(thirdParties?.sub).toBe('3 payouts, FY27');
  });

  it('flag a loss, an overdue milestone, a missing rate and an overdue payout, and nothing else', () => {
    const calm = buildMoneyStats(dashboard({ money: full }), {});
    expect(calm.every((s) => !s.attention)).toBe(true);

    const bad = buildMoneyStats(
      dashboard({
        money: {
          ...full,
          net: { inrMinor: -1 },
          outstanding: { inrMinor: 500, missingRates: ['EUR', 'USD'], overdueMilestones: 2 },
          payables: { inrMinor: 5, duePayouts: { inrMinor: 5, count: 1, overdueCount: 1 }, reimbursements: { inrMinor: 0, count: 0 } },
        },
      }),
      {},
    );
    const by = Object.fromEntries(bad.map((s) => [s.label, s]));
    expect(by['Company net']?.attention).toBe(true);
    expect(by['Outstanding from clients']?.attention).toBe(true);
    expect(by.Payables?.attention).toBe(true);
    expect(by['Received from clients']?.attention).toBeFalsy();
    expect(by['Outstanding from clients']?.sub).toBe('At latest rates. No rate for EUR and USD, left out. 2 milestones overdue.');
  });

  it('say so when nothing outstanding can be totalled, instead of showing zero', () => {
    const [o] = buildMoneyStats(dashboard({ money: { ...none, outstanding: { inrMinor: null, missingRates: ['USD'], overdueMilestones: 0 } } }), {});
    expect(o?.value).toBe('Needs a rate');
    expect(o?.sub).toBe('At latest rates. No rate for USD.');
  });

  it('keep the chosen period on the links to period-bound pages and nowhere else', () => {
    const stats = buildMoneyStats(dashboard({ money: full }), { period: 'last_fy', q: 'ignored' });
    const href = (label: string) => stats.find((s) => s.label === label)?.href;
    expect(href('Received from clients')).toBe('/admin/payments?period=last_fy');
    expect(href('Expenses')).toBe('/admin/expenses?period=last_fy');
    expect(href('Team payouts')).toBe('/admin/team/payouts');
    expect(href('Payables')).toBe('/admin/third-parties/payouts?status=due');
  });
});

describe('the work tiles', () => {
  it('follow the viewer\'s sections, each pair or not at all', () => {
    expect(buildWorkStats(dashboard())).toEqual([]);
    const all = buildWorkStats(
      dashboard({
        projects: { total: 5, active: 4, overdue: 1, byStatus: [] },
        tasks: { open: 3, overdue: 1, blocked: 1, inProgress: 1 },
        enquiries: { newInPeriod: 4, waitingForFirstReply: 3 },
      }),
    );
    expect(labels(all)).toEqual(['Active projects', 'Overdue projects', 'Open tasks', 'Overdue tasks', 'New enquiries', 'Waiting for a first reply']);
    expect(labels(buildWorkStats(dashboard({ tasks: { open: 0, overdue: 0, blocked: 0, inProgress: 0 } })))).toEqual(['Open tasks', 'Overdue tasks']);
  });

  it('raise attention only when there is something to do', () => {
    const quiet = buildWorkStats(
      dashboard({
        projects: { total: 0, active: 0, overdue: 0, byStatus: [] },
        tasks: { open: 0, overdue: 0, blocked: 0, inProgress: 0 },
        enquiries: { newInPeriod: 0, waitingForFirstReply: 0 },
      }),
    );
    expect(quiet.every((s) => !s.attention)).toBe(true);
    const busy = buildWorkStats(
      dashboard({
        projects: { total: 2, active: 2, overdue: 1, byStatus: [] },
        tasks: { open: 2, overdue: 1, blocked: 1, inProgress: 0 },
        enquiries: { newInPeriod: 2, waitingForFirstReply: 2 },
      }),
    );
    expect(busy.filter((s) => s.attention).map((s) => s.label)).toEqual(['Overdue projects', 'Overdue tasks', 'Waiting for a first reply']);
    expect(busy.find((s) => s.label === 'Open tasks')?.sub).toBe('1 blocked');
  });
});

describe('the top projects panel', () => {
  const html = (projects: Parameters<typeof TopProjectsPanel>[0]['projects']) => renderToStaticMarkup(createElement(TopProjectsPanel, { projects, period }));

  it('lists each project with its margin, a percentage only when one exists, and links to it', () => {
    const markup = html([
      { projectId: '5f3a9c0b1d2e4f6a8b7c9d0e', ref: 'PRJ-0001', name: 'A one', clientName: 'Client A', receivedInr: 9_142_000, marginInr: 8_292_000, marginPct: 90.7 },
      { projectId: '5f3a9c0b1d2e4f6a8b7c9d0f', ref: 'PRJ-0002', name: 'A two', clientName: 'Client A', receivedInr: 0, marginInr: -300_000, marginPct: null },
    ]);
    expect(markup).toContain('href="/admin/projects/5f3a9c0b1d2e4f6a8b7c9d0e"');
    expect(markup).toContain(formatInr(8_292_000));
    expect(markup).toContain('90.7%');
    // A loss is told by its sign and the margin flag, never by colour alone.
    expect(markup).toContain(formatInr(-300_000));
    expect(markup).toContain('pd-margin-flag');
  });

  it('says what is missing when nothing settled in the period', () => {
    const markup = html([]);
    expect(markup).toContain('No settled money in this period');
    expect(markup).not.toContain('<table');
  });
});
