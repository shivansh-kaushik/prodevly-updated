import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AdminProviders } from '@/components/admin/api-provider';
import { Project } from '@/models';
import { getProjectMoney, getProjectsDashboard, getProjectTasks, getProjectTeam } from '@/services/dashboards/projects';
import { getProject, listProjects } from '@/services/project.service';
import { setupTestDb } from '@/test/db';
import { makeClient, makeProject, makeTask } from '@/test/domain-factories';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { D, makeExpense, makeFxRate, makeInternalClient, makePayment, makeThirdPartyPayout, makeWorkLog } from '@/test/project-factories';
import { BudgetPanel } from './budget-panel';
import { StartedDeliveredChart, StatusPanel, TypeChart } from './dashboard-charts';
import { ProjectsStatBand, slipText } from './dashboard-stats';
import { MarginTable } from './margin-table';
import { ProjectActions } from './project-actions';
import { ProjectForm } from './project-form';
import { ProjectsTable } from './projects-table';
import { StatusDialog } from './status-dialog';
import { MoneyTab } from './tab-money';
import { OverviewTab } from './tab-overview';
import { TasksTab } from './tab-tasks';
import { TeamTab } from './tab-team';

// The pages run inside Next's router; here the hooks are stubs, so client components can be rendered to markup.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => '/admin/projects',
  useSearchParams: () => new URLSearchParams(),
}));

setupTestDb();

const FY27 = { from: D('2026-04-01'), to: D('2027-03-31') };
const NOW = new Date('2026-10-12T10:00:00Z');
const html = (node: ReactElement) => renderToStaticMarkup(h(AdminProviders, null, node));
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

async function world() {
  const sa = await sessionFor(await makeSuperadmin());
  const plain = await sessionFor(await makeAdmin());
  const client = await makeClient({ name: 'Acme Robotics' });
  const internal = await makeInternalClient();
  const lead = await makeAdmin({ name: 'Lena Lead' });
  const project = await makeProject(client, {
    name: 'Checkout redesign',
    status: 'active',
    type: 'web_app',
    health: 'at_risk',
    lead: { id: lead._id, name: lead.name },
    memberIds: [lead._id],
    startOn: D('2026-06-01'),
    deadlineOn: D('2026-09-30'),
    scopeSummary: 'Rebuild the checkout flow',
    costBudgetInrMinor: 500_000,
    contract: { pricingModel: 'fixed', amountMinor: 1_000_000, currency: 'USD' },
    milestones: [{ title: 'Design sign-off', amountMinor: 300_000, status: 'invoiced', dueOn: D('2026-09-01') }] as never,
    links: { live: 'https://acme.example/checkout', repo: 'javascript:alert(1)' } as never,
    tags: ['priority-client'],
    agreed: { scope: 'Rebuild checkout', amountMinor: 800_000, currency: 'USD', deadlineOn: D('2026-08-31'), capturedAt: new Date('2026-06-02T10:00:00Z'), capturedBy: { id: null, name: 'Aman' } },
    statusHistory: [{ from: null, to: 'active', at: new Date('2026-06-02T10:00:00Z'), by: { id: null, name: 'Aman' } }] as never,
  });
  const own = await makeProject(internal, { name: 'Our product', status: 'active' });
  await makeFxRate('USD', 84, '2026-10-01');
  await makePayment(project, { amountMinor: 400_000, currency: 'USD', rate: 83.42, receivedOn: '2026-06-10' });
  await makeThirdPartyPayout(project, { amountMinor: 5_000_000, paidOn: '2026-07-01' });
  await makeExpense({ project: own, amountMinor: 70_000, spentOn: '2026-07-02' });
  const task = await makeTask(project, { title: 'Payment step', status: 'in_progress' });
  await makeWorkLog(project, task, lead, { minutes: 150 });
  return { sa, plain, client, project, own, lead };
}

describe('the projects dashboard renders from real figures', () => {
  it('shows the stat band, charts, margin table and budgets for a viewer with money access', async () => {
    const w = await world();
    const d = await getProjectsDashboard(w.sa, FY27, { now: NOW });
    const markup = html(
      h('div', null,
        h(ProjectsStatBand, { dashboard: d, periodLabel: 'This financial year', params: {} }),
        h(StatusPanel, { dashboard: d }),
        h(StartedDeliveredChart, { dashboard: d, periodLabel: 'This financial year' }),
        h(TypeChart, { dashboard: d }),
        h(MarginTable, { money: d.money!, periodLabel: 'This financial year' }),
        h(BudgetPanel, { budgets: d.money!.budgets }),
      ),
    );
    const t = text(markup);
    expect(t).toContain('Active projects');
    expect(t).toContain('Overdue');
    expect(t).toContain('Checkout redesign');
    expect(t).toContain('Margin by project');
    expect(t).toContain('Internal');
    expect(t).toContain('Cost budget used');
    expect(t).toContain('Client projects');
    expect(markup).toContain('pd-total'); // the closing rule of the margin table
    expect(markup).toContain('role="progressbar"');
  });

  it('leaves the Margin tile out for a viewer without payment:view', async () => {
    const w = await world();
    const d = await getProjectsDashboard(w.plain, FY27, { now: NOW });
    const t = text(html(h(ProjectsStatBand, { dashboard: d, periodLabel: 'This financial year', params: {} })));
    expect(t).toContain('Active projects');
    expect(t).not.toContain('Margin');
  });

  it('renders zeros and empty states on an empty database', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    const d = await getProjectsDashboard(sa, FY27, { now: NOW });
    const t = text(
      html(
        h('div', null,
          h(ProjectsStatBand, { dashboard: d, periodLabel: 'This financial year', params: {} }),
          h(StatusPanel, { dashboard: d }),
          h(TypeChart, { dashboard: d }),
          h(MarginTable, { money: d.money!, periodLabel: 'This financial year' }),
          h(BudgetPanel, { budgets: d.money!.budgets }),
        ),
      ),
    );
    expect(t).toContain('None yet'); // average slip with no deliveries
    expect(t).toContain('No projects yet');
    expect(t).toContain('No settled money in this period');
    expect(t).toContain('No cost budgets set');
    expect(t).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('words the delivery slip plainly', () => {
    expect(slipText(0)).toBe('On time');
    expect(slipText(1)).toBe('1 day late');
    expect(slipText(2.5)).toBe('2.5 days late');
    expect(slipText(-3)).toBe('3 days early');
  });

  it('renders the register with overdue and money columns only when allowed', async () => {
    const w = await world();
    const withMoney = (await listProjects(w.sa, { now: NOW })).items;
    const without = (await listProjects(w.plain, { now: NOW })).items;
    const a = html(h(ProjectsTable, { items: withMoney, params: {}, sort: 'updatedAt', dir: 'desc', showMoney: true }));
    const b = html(h(ProjectsTable, { items: without, params: {}, sort: 'updatedAt', dir: 'desc', showMoney: false }));
    expect(text(a)).toContain('Overdue');
    expect(text(a)).toContain('Contract');
    expect(text(a)).toContain('$10,000.00');
    expect(text(b)).not.toContain('Contract');
    expect(text(b)).not.toContain('10,000.00');
    expect(a).toContain('/admin/projects/' + String(w.project._id));
  });
});

describe('the project page tabs render from real data', () => {
  it('overview: details, links that are safe, drift against what was agreed, and history', async () => {
    const w = await world();
    const project = await getProject(w.sa, String(w.project._id));
    const markup = html(h(OverviewTab, { project, canViewClient: true }));
    const t = text(markup);
    expect(t).toContain('Acme Robotics');
    expect(t).toContain('Rebuild the checkout flow');
    expect(t).toContain('As first agreed');
    expect(t).toContain('Changed'); // scope, deadline and price all moved since the agreement
    expect(t).toContain('Status history');
    expect(markup).toContain('href="https://acme.example/checkout"');
    expect(markup).not.toContain('javascript:'); // an address that is not http(s) is never a link
    expect(markup).toContain('rel="noopener noreferrer"');
  });

  it('overview: shows no price to a viewer without payment:view', async () => {
    const w = await world();
    const project = await getProject(w.plain, String(w.project._id));
    const t = text(html(h(OverviewTab, { project, canViewClient: false })));
    expect(t).toContain('As first agreed');
    expect(t).not.toMatch(/\$|8,000\.00|10,000\.00/);
    expect(t).not.toContain('Price');
  });

  it('money: contract, ledger, projection, milestones and the margin double rule', async () => {
    const w = await world();
    const project = await getProject(w.sa, String(w.project._id));
    const report = await getProjectMoney(w.sa, project.id);
    const markup = html(h(MoneyTab, { project: { ...project, money: project.money! }, report, canEdit: true }));
    const t = text(markup);
    expect(t).toContain('Projected margin');
    expect(t).toContain('Design sign-off');
    expect(t).toContain('Add milestone');
    expect(t).toContain('Margin so far');
    expect(t).toContain('at 84 INR per USD');
    expect(markup).toContain('pd-total');
    expect(t).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('money: asks for an exchange rate instead of inventing a projection', async () => {
    const w = await world();
    await Project.updateOne({ _id: w.project._id }, { $set: { 'contract.currency': 'EUR' } });
    const project = await getProject(w.sa, String(w.project._id));
    const report = await getProjectMoney(w.sa, project.id);
    const t = text(html(h(MoneyTab, { project: { ...project, money: project.money! }, report, canEdit: false })));
    expect(t).toContain('Needs a rate');
    expect(t).toContain('exchange rate for EUR');
    expect(t).not.toContain('Add milestone'); // read-only without payment:record
  });

  it('tasks and team', async () => {
    const w = await world();
    const tasks = html(h(TasksTab, { tasks: await getProjectTasks(w.sa, String(w.project._id)) }));
    expect(text(tasks)).toContain('Payment step');
    expect(tasks).toContain('/admin/tasks/');
    const empty = text(html(h(TasksTab, { tasks: { items: [], total: 0, byStatus: {} } })));
    expect(empty).toContain('No tasks yet');

    const team = await getProjectTeam(w.sa, String(w.project._id));
    const t = text(html(h(TeamTab, { projectId: String(w.project._id), team, canEdit: true })));
    expect(t).toContain('Lena Lead');
    expect(t).toContain('Lead');
    expect(t).toContain('2.5 h');
    expect(t).toContain('Manage team');
    const ownOnly = text(html(h(TeamTab, { projectId: String(w.project._id), team: await getProjectTeam(w.plain, String(w.project._id)), canEdit: false })));
    expect(ownOnly).toContain('your own hours');
    expect(ownOnly).not.toContain('Manage team');
  });
});

describe('the forms and dialogs render', () => {
  it('create form: no money section without payment:record, and says so', async () => {
    const t = text(html(h(ProjectForm, { canEditMoney: false, currencies: ['INR', 'USD'] })));
    expect(t).toContain('Create project');
    expect(t).toContain('Starts as');
    expect(t).not.toContain('Contract and billing');
    expect(t).toContain('someone with payment access');
  });

  it('create form: contract and budget for payment access, with the chosen client pre-filled', async () => {
    const markup = html(h(ProjectForm, { canEditMoney: true, currencies: ['INR', 'USD'], defaultClient: { id: 'a'.repeat(24), label: 'Acme Robotics' } }));
    expect(text(markup)).toContain('Contract and billing');
    expect(text(markup)).toContain('Cost budget (INR)');
    expect(markup).toContain('value="Acme Robotics"');
  });

  it('edit form: keeps health, hides the starting status, and locks the currency once milestones exist', async () => {
    const w = await world();
    const project = await getProject(w.sa, String(w.project._id));
    const markup = html(
      h(ProjectForm, {
        canEditMoney: true,
        currencies: ['INR', 'USD'],
        initial: {
          id: project.id, clientId: project.clientId, clientName: project.clientName, name: project.name, type: project.type,
          priority: project.priority, health: project.health, lead: { id: project.lead!.id!, label: project.lead!.name }, members: [],
          startOn: project.startOn, deadlineOn: project.deadlineOn, scopeSummary: project.scopeSummary, links: project.links, tags: project.tags,
          contract: project.money!.contract, costBudgetInrMinor: project.money!.costBudgetInrMinor, currencyLocked: true,
        },
      }),
    );
    const t = text(markup);
    expect(t).toContain('Save changes');
    expect(t).toContain('Health');
    expect(t).not.toContain('Starts as');
    expect(t).toContain('The currency is fixed because milestones or payments already use it.');
    expect(markup).toContain('value="Checkout redesign"');
    expect(markup).toContain('value="priority-client"');
  });

  it('status dialog: offers only the moves the table allows, and hides superadmin-only ones', () => {
    const closedForAdmin = text(html(h(StatusDialog, { open: true, onClose: () => {}, projectId: 'p', status: 'closed', canReopen: false })));
    expect(closedForAdmin).toContain('Only a superadmin can reopen');
    const closedForSuper = text(html(h(StatusDialog, { open: true, onClose: () => {}, projectId: 'p', status: 'closed', canReopen: true })));
    expect(closedForSuper).toContain('Move project');
    const active = html(h(StatusDialog, { open: true, onClose: () => {}, projectId: 'p', status: 'active', canReopen: false }));
    expect(active).toContain('value="in_review"');
    expect(active).toContain('value="on_hold"');
    expect(active).toContain('value="cancelled"');
    expect(active).not.toContain('value="delivered"');
    expect(text(active)).toContain('Note (optional)'); // moving to in review needs no note; on hold and cancelled do
  });

  it('project actions: each button only for someone who may use it', () => {
    const base = { id: 'p', name: 'Checkout', status: 'active' as const, archived: false, canReopen: false };
    const all = text(html(h(ProjectActions, { ...base, canEdit: true, canArchive: true })));
    expect(all).toContain('Change status');
    expect(all).toContain('Edit');
    expect(all).toContain('Archive');
    const none = text(html(h(ProjectActions, { ...base, canEdit: false, canArchive: false })));
    expect(none).not.toMatch(/Change status|Edit|Archive/);
    const archived = text(html(h(ProjectActions, { ...base, archived: true, canEdit: true, canArchive: true })));
    expect(archived).toContain('Restore');
    expect(archived).not.toContain('Change status');
  });
});
