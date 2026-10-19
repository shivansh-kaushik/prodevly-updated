/**
 * Capabilities: the only thing application code checks.
 *
 * Code never branches on a role name. Each role maps to a default set of
 * capabilities, and a superadmin may switch on extra ones for a specific admin
 * (`grants`). The effective set is computed fresh from the database on every
 * request, so a change applies on the person's next click.
 */

export const ADMIN_ROLES = ['superadmin', 'admin'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const CAPABILITIES = [
  'dashboard:view',
  'client:view',
  'client:edit',
  'client:archive',
  'client:delete',
  'project:view',
  'project:edit',
  'project:archive',
  'project:reopen',
  'task:view',
  'task:edit',
  'task:delete',
  'worklog:own',
  'worklog:viewAll',
  'worklog:editAll',
  'payment:view',
  'payment:record',
  'thirdParty:view',
  'thirdParty:edit',
  'thirdParty:payDetails',
  'payout:view',
  'payout:record',
  'expense:submit',
  'expense:view',
  'expense:record',
  'money:approve',
  'money:void',
  'team:view',
  'team:payView',
  'teamPayout:record',
  'admin:manage',
  'content:edit',
  'content:publish',
  'lead:view',
  'lead:edit',
  'lead:delete',
  'settings:edit',
  'fx:edit',
  'audit:viewAll',
  'export:data',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** What every plain `admin` can do before any grants. */
const ADMIN_DEFAULTS: readonly Capability[] = [
  'dashboard:view',
  'client:view',
  'client:edit',
  'project:view',
  'project:edit',
  'task:view',
  'task:edit',
  'worklog:own',
  'thirdParty:view',
  'expense:submit',
  'team:view',
  'content:edit',
  'lead:view',
  'lead:edit',
];

export const ROLE_DEFAULTS: Record<AdminRole, readonly Capability[]> = {
  superadmin: CAPABILITIES,
  admin: ADMIN_DEFAULTS,
};

/**
 * Extra capabilities a superadmin may switch on for one admin. Everything else
 * (managing admins, approving or voiding money, pay data, settings, the audit
 * log, permanent deletes) is superadmin-only and can never be granted.
 */
export const GRANTABLE: readonly Capability[] = [
  'client:archive',
  'project:archive',
  'worklog:viewAll',
  'payment:view',
  'payment:record',
  'thirdParty:edit',
  'payout:view',
  'payout:record',
  'expense:view',
  'expense:record',
  'content:publish',
  'fx:edit',
  'export:data',
];

/** Granting the key also switches on the value, so a recorder can always see. */
export const GRANT_DEPENDENCIES: Partial<Record<Capability, Capability>> = {
  'payment:record': 'payment:view',
  'payout:record': 'payout:view',
  'expense:record': 'expense:view',
};

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

export function isGrantable(capability: Capability): boolean {
  return GRANTABLE.includes(capability);
}

/**
 * Validates a requested grant list and returns it normalised: deduplicated,
 * dependencies added, stable order. Only capabilities in GRANTABLE are accepted
 * (role defaults are not grants). Throws a message naming the first one that cannot be granted.
 */
export function normaliseGrants(role: AdminRole, requested: readonly string[]): Capability[] {
  const out = new Set<Capability>();
  for (const raw of requested) {
    if (!isCapability(raw)) throw new Error(`Unknown capability "${raw}"`);
    if (!isGrantable(raw)) throw new Error(`"${raw}" cannot be granted`);
    out.add(raw);
    const needed = GRANT_DEPENDENCIES[raw];
    if (needed) out.add(needed);
  }
  const defaults = new Set<Capability>(ROLE_DEFAULTS[role]);
  return CAPABILITIES.filter((c) => out.has(c) && !defaults.has(c));
}

/** Role defaults plus grants, deduplicated. Superadmins ignore grants. */
export function effectiveCapabilities(role: AdminRole, grants: readonly string[] = []): Set<Capability> {
  const set = new Set<Capability>(ROLE_DEFAULTS[role]);
  if (role !== 'superadmin') {
    for (const g of grants) if (isCapability(g) && isGrantable(g)) set.add(g);
  }
  return set;
}

export function hasCapability(capabilities: ReadonlySet<Capability>, capability: Capability): boolean {
  return capabilities.has(capability);
}
