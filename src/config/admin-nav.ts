import type { Capability } from './capabilities';

/**
 * The sidebar. An item shows when the viewer holds ANY of its capabilities (`anyOf`); an item
 * with no `anyOf` shows to every signed-in admin. This only decides what to SHOW: every page,
 * route handler and service still checks the capability itself.
 */
export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: NavIcon;
  anyOf?: readonly Capability[];
  /** Highlights this item for every path that starts with the prefix (defaults to href). */
  match?: string;
}

export type NavIcon =
  | 'overview' | 'clients' | 'projects' | 'tasks' | 'worklogs' | 'my' | 'payments' | 'thirdparties' | 'expenses'
  | 'team' | 'admins' | 'content' | 'enquiries' | 'settings' | 'audit';

export interface NavGroup {
  label: string | null;
  items: readonly NavItem[];
}

export const ADMIN_NAV: readonly NavGroup[] = [
  {
    label: null,
    items: [{ key: 'overview', label: 'Overview', href: '/admin', icon: 'overview', anyOf: ['dashboard:view'], match: '/admin$' }],
  },
  {
    label: 'Work',
    items: [
      { key: 'my', label: 'My work', href: '/admin/my', icon: 'my' },
      { key: 'clients', label: 'Clients', href: '/admin/clients', icon: 'clients', anyOf: ['client:view'] },
      { key: 'projects', label: 'Projects', href: '/admin/projects', icon: 'projects', anyOf: ['project:view'] },
      { key: 'tasks', label: 'Tasks', href: '/admin/tasks', icon: 'tasks', anyOf: ['task:view'] },
      { key: 'work-logs', label: 'Work logs', href: '/admin/work-logs', icon: 'worklogs', anyOf: ['worklog:viewAll'] },
    ],
  },
  {
    label: 'Money',
    items: [
      { key: 'payments', label: 'Client payments', href: '/admin/payments', icon: 'payments', anyOf: ['payment:view'] },
      { key: 'third-parties', label: 'Third parties', href: '/admin/third-parties', icon: 'thirdparties', anyOf: ['thirdParty:view', 'payout:view'] },
      { key: 'expenses', label: 'Expenses', href: '/admin/expenses', icon: 'expenses', anyOf: ['expense:submit', 'expense:view'] },
    ],
  },
  {
    label: 'People',
    items: [
      { key: 'team', label: 'Team', href: '/admin/team', icon: 'team', anyOf: ['team:view'] },
      { key: 'admins', label: 'Admins', href: '/admin/admins', icon: 'admins', anyOf: ['admin:manage'] },
    ],
  },
  {
    label: 'Website',
    items: [
      { key: 'content', label: 'Content', href: '/admin/content', icon: 'content', anyOf: ['content:edit'] },
      { key: 'enquiries', label: 'Enquiries', href: '/admin/enquiries', icon: 'enquiries', anyOf: ['lead:view'] },
    ],
  },
  {
    label: 'System',
    items: [
      { key: 'settings', label: 'Settings', href: '/admin/settings', icon: 'settings', anyOf: ['settings:edit', 'fx:edit'] },
      { key: 'audit', label: 'Audit log', href: '/admin/audit', icon: 'audit' },
    ],
  },
];

/** The groups (and items) this viewer may see. Empty groups are dropped. */
export function visibleNav(capabilities: ReadonlySet<Capability>): NavGroup[] {
  return ADMIN_NAV.map((g) => ({
    label: g.label,
    items: g.items.filter((i) => !i.anyOf || i.anyOf.some((c) => capabilities.has(c))),
  })).filter((g) => g.items.length > 0);
}
