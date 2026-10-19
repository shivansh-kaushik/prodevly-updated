import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { formatCycleTime, formatWeek, PersonDashboardView } from '@/components/admin/person-dashboard';
import type { PersonDashboard } from '@/services/dashboards/person';
import type { TasksDashboard } from '@/services/dashboards/tasks';
import type { BoardColumn, TaskListItemDTO } from '@/services/task.service';
import { TaskBoard } from './task-board';
import { TaskList } from './task-list';
import { TasksDashboardBand } from './tasks-dashboard';

/** Server-rendered views against plain fixtures: no NaN, no "undefined", ratios only when they exist. */
const weeks = Array.from({ length: 12 }, (_, i) => `2026-0${(i % 9) + 1}-01`);

const emptyTasks = (): TasksDashboard => ({
  period: { key: 'this_fy', label: 'This financial year', from: '2026-04-01', to: '2027-03-31' },
  openTotal: 0,
  openByStatus: { backlog: 0, todo: 0, in_progress: 0, in_review: 0, blocked: 0 },
  overdue: 0,
  unassigned: 0,
  blocked: 0,
  completedInPeriod: 0,
  medianCycleMs: null,
  cycleSampleSize: 0,
  hours: { scope: 'all', minutes: 0, billableMinutes: 0, billableShare: null },
  completedPerWeek: weeks.map((weekStart) => ({ weekStart, completed: 0 })),
  openPerAssignee: [],
  hoursPerWeek: { scope: 'all', weeks, people: [] },
  hoursByProject: [],
  estimateVsLogged: [],
});

const emptyPerson = (): PersonDashboard => ({
  person: { id: 'a'.repeat(24), name: 'Riya Sen', designation: null, active: true, lastLoginAt: null },
  period: { key: 'this_fy', label: 'This financial year', from: '2026-04-01', to: '2027-03-31' },
  hours: { thisWeekMinutes: 0, thisMonthMinutes: 0, periodMinutes: 0, periodBillableMinutes: 0 },
  hoursPerWeek: weeks.map((weekStart) => ({ weekStart, minutes: 0 })),
  hoursByProject: [],
  tasks: { open: 0, overdue: 0, completedInPeriod: 0, withDueDate: 0, onTime: 0, onTimePercent: null, medianCycleMs: null, cycleSampleSize: 0 },
  pay: null,
  recentActivity: [],
});

const task = (o: Partial<TaskListItemDTO> = {}): TaskListItemDTO => ({
  id: 'b'.repeat(24),
  ref: 'PRJ-0001-T001',
  title: 'Build the form',
  status: 'todo',
  priority: 'medium',
  dueOn: null,
  overdue: false,
  estimateMinutes: null,
  loggedMinutes: 0,
  assignees: [],
  project: { id: 'c'.repeat(24), ref: 'PRJ-0001', name: 'Website', clientId: 'd'.repeat(24), clientName: 'Acme', archived: false },
  order: 1,
  archived: false,
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...o,
});

const clean = (html: string) => {
  expect(html).not.toMatch(/NaN|undefined|Infinity|\[object/);
  return html;
};

describe('formatters', () => {
  it('says cycle time the way people do', () => {
    expect(formatCycleTime(5 * 3_600_000)).toBe('5 h');
    expect(formatCycleTime(20 * 60_000)).toBe('1 h');
    expect(formatCycleTime(86_400_000)).toBe('1 day');
    expect(formatCycleTime(2.5 * 86_400_000)).toBe('2.5 days');
  });
  it('labels a week by its Monday', () => {
    expect(formatWeek('2026-10-05')).toBe('5 Oct');
  });
});

describe('tasks dashboard band', () => {
  it('renders an empty database as zeros and empty states, with no ratio tile', () => {
    const html = clean(renderToStaticMarkup(createElement(TasksDashboardBand, { data: emptyTasks(), sp: {} })));
    for (const label of ['Open tasks', 'Overdue', 'Unassigned', 'Blocked', 'Completed', 'Median cycle time', 'Hours logged']) expect(html).toContain(label);
    expect(html).not.toContain('Billable share');
    expect(html).toContain('No records yet');
    expect(html).toContain('No finished tasks that were started');
  });

  it('shows the billable share and the median cycle time once they exist, and labels own-only hours', () => {
    const data = { ...emptyTasks(), medianCycleMs: 3 * 86_400_000, cycleSampleSize: 4, hours: { scope: 'own' as const, minutes: 600, billableMinutes: 300, billableShare: 0.5 }, openTotal: 7, overdue: 2 };
    const html = clean(renderToStaticMarkup(createElement(TasksDashboardBand, { data, sp: { period: 'last_fy' } })));
    expect(html).toContain('Billable share');
    expect(html).toContain('50%');
    expect(html).toContain('3 days');
    expect(html).toContain('My hours logged');
    expect(html).toContain('My hours per week');
    expect(html).toContain('period=last_fy'); // tiles keep the period when they link into the list
  });

  it('leaves out the estimate chart when the viewer may not see everyone\'s hours', () => {
    const html = renderToStaticMarkup(createElement(TasksDashboardBand, { data: { ...emptyTasks(), estimateVsLogged: null }, sp: {} }));
    expect(html).not.toContain('Estimate against logged');
    expect(renderToStaticMarkup(createElement(TasksDashboardBand, { data: emptyTasks(), sp: {} }))).toContain('Estimate against logged');
  });
});

describe('person dashboard', () => {
  it('renders an empty person with zeros, no ratio and no pay section', () => {
    const html = clean(renderToStaticMarkup(createElement(PersonDashboardView, { data: emptyPerson(), isSelf: true })));
    expect(html).toContain('Hours this week');
    expect(html).toContain('Open tasks');
    expect(html).not.toContain('Completed on time');
    expect(html).not.toContain('My payouts');
    expect(html).toContain('Has not signed in yet');
    expect(html).toContain('No activity yet');
  });

  it('shows pay with the native amount beside INR, and the on-time ratio once there is a denominator', () => {
    const data: PersonDashboard = {
      ...emptyPerson(),
      tasks: { open: 3, overdue: 1, completedInPeriod: 4, withDueDate: 3, onTime: 2, onTimePercent: 67, medianCycleMs: 2 * 86_400_000, cycleSampleSize: 2 },
      pay: {
        paidInPeriodInrMinor: 9_350_000,
        paidInPeriodCount: 2,
        paidInPeriodNative: [{ currency: 'INR', amountMinor: 1_000_000, inrMinor: 1_000_000 }, { currency: 'USD', amountMinor: 100_000, inrMinor: 8_350_000 }],
        dueCount: 1,
        dueInrMinor: 400_000,
        reimbursements: { owedCount: 1, owedInrMinor: 250_000, awaitingApprovalCount: 1, awaitingApprovalInrMinor: 100_000 },
      },
    };
    const html = clean(renderToStaticMarkup(createElement(PersonDashboardView, { data, isSelf: true, tasksHref: '/admin/tasks?assignee=me' })));
    expect(html).toContain('My payouts');
    expect(html).toContain('$1,000.00');
    expect(html).toContain('₹83,500.00');
    expect(html).toContain('Completed on time');
    expect(html).toContain('67%');
    expect(html).toContain('2 of 3 with a due date');
    expect(html).toContain('assignee=me&amp;overdue=1');
    expect(renderToStaticMarkup(createElement(PersonDashboardView, { data, isSelf: false }))).toContain('Payouts');
  });
});

describe('task list and board', () => {
  it('lists tasks with an overdue marker, and shows an empty state with the next step', () => {
    const html = clean(renderToStaticMarkup(createElement(TaskList, { items: [task({ dueOn: '2026-09-01', overdue: true, estimateMinutes: 120, loggedMinutes: 30, assignees: [{ kind: 'admin', id: 'e'.repeat(24), name: 'Riya Sen', assignedAt: null }] })], sp: {}, sort: 'updatedAt', dir: 'desc', filtered: false, canCreate: true })));
    expect(html).toContain('Build the form');
    expect(html).toContain('Overdue');
    expect(html).toContain('Riya Sen');
    expect(html).toContain('30m');
    expect(html).toContain('of 2h');
    const empty = clean(renderToStaticMarkup(createElement(TaskList, { items: [], sp: {}, sort: 'updatedAt', dir: 'desc', filtered: false, canCreate: true })));
    expect(empty).toContain('No tasks yet');
    expect(empty).toContain('/admin/tasks/new');
    expect(renderToStaticMarkup(createElement(TaskList, { items: [], sp: { q: 'x' }, sort: 'updatedAt', dir: 'desc', filtered: true, canCreate: true }))).toContain('Clear filters');
  });

  it('renders every column, truthful totals and a way to the full list', () => {
    const columns: BoardColumn[] = (['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'] as const).map((status) => ({
      status,
      total: status === 'todo' ? 40 : 0,
      tasks: status === 'todo' ? [task()] : [],
    }));
    const html = clean(renderToStaticMarkup(createElement(TaskBoard, { columns, sp: { period: 'last_fy' }, canEdit: false, projectScoped: false })));
    for (const name of ['Backlog', 'Todo', 'In progress', 'In review', 'Blocked', 'Done', 'Cancelled']) expect(html).toContain(name);
    expect(html).toContain('Showing 1 of 40');
    expect(html).toContain('view=list');
    expect(html).toContain('status=todo');
    expect(html).toContain('Website'); // the project shows when the board spans projects
    expect(html).not.toContain('>Move<'); // no actions without task:edit
  });
});
