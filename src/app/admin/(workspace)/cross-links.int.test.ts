import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminProviders } from '@/components/admin/api-provider';
import type { Capability } from '@/config/capabilities';
import { Project } from '@/models';
import { setupTestDb } from '@/test/db';
import { makeClient, makeProject, makeTask } from '@/test/domain-factories';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { makeMember } from '@/test/team-factories';
import type { SessionUser } from '@/types/session';

/**
 * The shortcuts that tie the modules together: the team directory, My work, a project's Money and Tasks tabs and a client's Money
 * tab. Each link must lead somewhere the viewer can open, so these render the real pages for different viewers. Only the framework
 * edges are stubbed (the session, the router hooks and the request cookies).
 */
let signedIn: SessionUser;

vi.mock('@/lib/auth/page-guard', () => ({
  requireAdminPage: async () => signedIn,
  getCurrentAdmin: async () => ({ admin: signedIn, hadCookie: true }),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import ClientPage from './clients/[clientId]/page';
import MyWorkPage from './my/page';
import ProjectPage from './projects/[projectId]/page';
import TeamPage from './team/page';

setupTestDb();

beforeEach(() => {
  signedIn = undefined as unknown as SessionUser;
});

const html = (node: ReactElement) => renderToStaticMarkup(h(AdminProviders, null, node));
const hrefs = (markup: string) => [...markup.matchAll(/href="([^"]+)"/g)].map((m) => (m[1] ?? '').replaceAll('&amp;', '&'));
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/** The same person, with exactly these capabilities, for the cases a real account cannot reach (grants are limited). */
const holding = (viewer: SessionUser, ...caps: Capability[]): SessionUser => ({ ...viewer, capabilities: new Set(caps) });

const teamPage = async () => html(await TeamPage({ searchParams: Promise.resolve({}) }));
const myPage = async () => html(await MyWorkPage({ searchParams: Promise.resolve({}) }));
const projectPage = async (id: string, tab: string) => html(await ProjectPage({ params: Promise.resolve({ projectId: id }), searchParams: Promise.resolve({ tab }) }));
const clientPage = async (id: string, tab: string) => html(await ClientPage({ params: Promise.resolve({ clientId: id }), searchParams: Promise.resolve({ tab }) }));

describe('the team directory', () => {
  it('offers Payouts only to a holder of team:payView, and Job roles only to a holder of settings:edit', async () => {
    const sa = await sessionFor(await makeSuperadmin());
    signedIn = sa;
    const both = hrefs(await teamPage());
    expect(both).toContain('/admin/team/payouts');
    expect(both).toContain('/admin/team/roles');

    signedIn = holding(sa, 'team:view', 'team:payView');
    const payOnly = hrefs(await teamPage());
    expect(payOnly).toContain('/admin/team/payouts');
    expect(payOnly).not.toContain('/admin/team/roles');

    signedIn = holding(sa, 'team:view', 'settings:edit');
    const rolesOnly = hrefs(await teamPage());
    expect(rolesOnly).toContain('/admin/team/roles');
    expect(rolesOnly).not.toContain('/admin/team/payouts');

    signedIn = await sessionFor(await makeAdmin());
    const plain = hrefs(await teamPage());
    expect(plain).not.toContain('/admin/team/payouts');
    expect(plain).not.toContain('/admin/team/roles');
  });

  it('links a name to the person page only where that page opens for the viewer', async () => {
    const me = await makeAdmin({ name: 'Mira Plain' });
    const asha = await makeMember({ name: 'Asha Rao' });
    const sa = await sessionFor(await makeSuperadmin());

    // an ordinary admin may open their own page, and a colleague's would be a 404: plain text there
    signedIn = await sessionFor(me);
    const own = await teamPage();
    expect(text(own)).toContain('Asha Rao');
    expect(hrefs(own)).toContain(`/admin/team/${String(me._id)}`);
    expect(hrefs(own)).not.toContain(`/admin/team/${String(asha._id)}`);

    // someone who may read other people's activity (audit:viewAll) opens everyone's
    signedIn = sa;
    const all = hrefs(await teamPage());
    expect(all).toContain(`/admin/team/${String(me._id)}`);
    expect(all).toContain(`/admin/team/${String(asha._id)}`);
  });
});

describe('My work', () => {
  it('links to my payouts (the Pay tab of my own page) for every admin, and the page it points at exists for them', async () => {
    for (const admin of [await makeAdmin(), await makeSuperadmin()]) {
      signedIn = await sessionFor(admin);
      const links = hrefs(await myPage());
      expect(links).toContain(`/admin/team/${String(admin._id)}?tab=pay`);
      // team:view is what the person page asks for, and the Pay tab is open to the person themself
      expect(signedIn.capabilities.has('team:view')).toBe(true);
    }
  });
});

describe("a project's Money tab", () => {
  async function world() {
    const client = await makeClient({ name: 'Acme Robotics' });
    const project = await makeProject(client, { name: 'Checkout redesign', contract: { pricingModel: 'fixed', amountMinor: 1_000_000, currency: 'INR' } });
    return { client, project, id: String(project._id) };
  }

  it('offers every shortcut to a viewer who holds each capability, each aimed at this project', async () => {
    const w = await world();
    signedIn = await sessionFor(await makeSuperadmin());
    const markup = await projectPage(w.id, 'money');
    const links = hrefs(markup);
    expect(links).toContain(`/admin/payments/new?projectId=${w.id}`);
    expect(links).toContain(`/admin/payments?project=${w.id}`);
    expect(links).toContain(`/admin/expenses/new?projectId=${w.id}`);
    expect(links).toContain(`/admin/third-parties/work-orders/new?project=${w.id}`);
    expect(links).toContain(`/admin/third-parties/payouts?project=${w.id}`);
    const words = text(markup);
    for (const label of ['Record payment', 'View payments', 'Record expense', 'New work order', 'Payouts']) expect(words, label).toContain(label);
  });

  it('shows only what the viewer may open', async () => {
    const w = await world();
    // payment:view and the default expense:submit, nothing else money-related
    signedIn = await sessionFor(await makeAdmin({ grants: ['payment:view'] }));
    const links = hrefs(await projectPage(w.id, 'money'));
    expect(links).toContain(`/admin/payments?project=${w.id}`);
    expect(links).toContain(`/admin/expenses/new?projectId=${w.id}`); // expense:submit is enough to open the expense form
    expect(links).not.toContain(`/admin/payments/new?projectId=${w.id}`);
    expect(links).not.toContain(`/admin/third-parties/work-orders/new?project=${w.id}`);
    expect(links).not.toContain(`/admin/third-parties/payouts?project=${w.id}`);

    // payment:view alone: no expense form either
    signedIn = holding(signedIn, 'project:view', 'payment:view');
    const viewOnly = hrefs(await projectPage(w.id, 'money'));
    expect(viewOnly).toContain(`/admin/payments?project=${w.id}`);
    expect(viewOnly.filter((l) => /expenses\/new|payments\/new|work-orders\/new|third-parties\/payouts/.test(l))).toEqual([]);
  });

  it('keeps the view links but drops the ones that start a new record on an archived project', async () => {
    const w = await world();
    await Project.updateOne({ _id: w.project._id }, { $set: { archivedAt: new Date() } });
    signedIn = await sessionFor(await makeSuperadmin());
    const links = hrefs(await projectPage(w.id, 'money'));
    expect(links).toContain(`/admin/payments?project=${w.id}`);
    expect(links).toContain(`/admin/third-parties/payouts?project=${w.id}`);
    expect(links.filter((l) => /payments\/new|expenses\/new|work-orders\/new/.test(l))).toEqual([]);
  });
});

describe("a project's Tasks tab", () => {
  it('offers Add task to a viewer who may create tasks, with and without tasks in the project', async () => {
    const client = await makeClient();
    const project = await makeProject(client);
    const id = String(project._id);
    signedIn = await sessionFor(await makeAdmin());

    const empty = await projectPage(id, 'tasks');
    expect(text(empty)).toContain('No tasks yet');
    expect(hrefs(empty)).toContain(`/admin/tasks/new?projectId=${id}`);

    await makeTask(project, { title: 'Payment step' });
    const filled = await projectPage(id, 'tasks');
    expect(text(filled)).toContain('Payment step');
    expect(text(filled)).toContain('Add task');
    expect(hrefs(filled)).toContain(`/admin/tasks/new?projectId=${id}`);
  });

  it('leaves it out for a viewer without task:edit, and for an archived project', async () => {
    const client = await makeClient();
    const project = await makeProject(client);
    const id = String(project._id);
    await makeTask(project);

    signedIn = holding(await sessionFor(await makeAdmin()), 'project:view', 'task:view');
    expect(hrefs(await projectPage(id, 'tasks')).filter((l) => l.startsWith('/admin/tasks/new'))).toEqual([]);

    await Project.updateOne({ _id: project._id }, { $set: { archivedAt: new Date() } });
    signedIn = await sessionFor(await makeAdmin());
    expect(hrefs(await projectPage(id, 'tasks')).filter((l) => l.startsWith('/admin/tasks/new'))).toEqual([]);
  });
});

describe("a client's Money tab", () => {
  it('links to that client\'s payments for a holder of payment:view', async () => {
    const client = await makeClient({ name: 'Acme Robotics' });
    await makeProject(client, { name: 'Checkout redesign' });
    const id = String(client._id);

    signedIn = await sessionFor(await makeSuperadmin());
    const markup = await clientPage(id, 'money');
    expect(text(markup)).toContain('View payments');
    expect(hrefs(markup)).toContain(`/admin/payments?client=${id}`);
  });

  it('has no Money tab, so no payments link, for a viewer without payment:view', async () => {
    const client = await makeClient();
    await makeProject(client);
    signedIn = await sessionFor(await makeAdmin());
    const markup = await clientPage(String(client._id), 'money');
    // the tab falls back to the overview
    expect(hrefs(markup).filter((l) => l.startsWith('/admin/payments'))).toEqual([]);
    expect(text(markup)).not.toContain('View payments');
  });
});
