import { describe, expect, it } from 'vitest';
import {
  CAPABILITIES,
  GRANTABLE,
  GRANT_DEPENDENCIES,
  ROLE_DEFAULTS,
  effectiveCapabilities,
  normaliseGrants,
} from './capabilities';

const NEVER_GRANTABLE = [
  'admin:manage', 'money:approve', 'money:void', 'team:payView', 'teamPayout:record',
  'thirdParty:payDetails', 'settings:edit', 'audit:viewAll', 'worklog:editAll', 'client:delete', 'task:delete', 'lead:delete', 'project:reopen',
] as const;

describe('capabilities', () => {
  it('gives superadmins everything and plain admins a strict subset', () => {
    expect(ROLE_DEFAULTS.superadmin).toEqual(CAPABILITIES);
    for (const c of ROLE_DEFAULTS.admin) expect(CAPABILITIES).toContain(c);
    expect(ROLE_DEFAULTS.admin.length).toBeLessThan(CAPABILITIES.length);
  });

  it('keeps money, pay and admin management out of a plain admin\'s defaults', () => {
    const admin = effectiveCapabilities('admin');
    for (const c of ['admin:manage', 'payment:view', 'payment:record', 'payout:view', 'expense:view', 'money:approve', 'team:payView', 'settings:edit', 'audit:viewAll', 'export:data'] as const) {
      expect(admin.has(c), c).toBe(false);
    }
    expect(admin.has('expense:submit')).toBe(true); // can submit their own expense
    expect(admin.has('worklog:own')).toBe(true);
  });

  it('the never-grantable list is disjoint from GRANTABLE and from what an admin has by default', () => {
    for (const c of NEVER_GRANTABLE) {
      expect(GRANTABLE).not.toContain(c);
      expect(ROLE_DEFAULTS.admin).not.toContain(c);
    }
  });

  it('refuses to grant anything not in the grantable set', () => {
    for (const c of NEVER_GRANTABLE) expect(() => normaliseGrants('admin', [c]), c).toThrow(/cannot be granted/);
    expect(() => normaliseGrants('admin', ['nope:nope'])).toThrow(/Unknown/);
  });

  it('adds dependencies, deduplicates and orders stably; capabilities an admin already has by default are not grantable', () => {
    expect(normaliseGrants('admin', ['payment:record', 'payment:record'])).toEqual(['payment:view', 'payment:record']);
    expect(() => normaliseGrants('admin', ['client:edit'])).toThrow(/cannot be granted/); // already a default: not a grant
    for (const [needs, requires] of Object.entries(GRANT_DEPENDENCIES)) {
      expect(normaliseGrants('admin', [needs])).toContain(requires);
    }
  });

  it('ignores grants for a superadmin, and ignores a corrupted non-grantable grant stored on an admin', () => {
    expect(effectiveCapabilities('superadmin', ['payment:view']).size).toBe(CAPABILITIES.length);
    // a bad value that somehow reached the database must not escalate privileges
    expect(effectiveCapabilities('admin', ['admin:manage', 'payment:view']).has('admin:manage')).toBe(false);
    expect(effectiveCapabilities('admin', ['admin:manage', 'payment:view']).has('payment:view')).toBe(true);
  });
});

describe('the capability matrix is pinned', () => {
  // A deliberate change to who can do what must show up in a diff of THIS file.
  it('plain admin defaults', () => {
    expect([...ROLE_DEFAULTS.admin].sort()).toEqual(
      [
        'client:edit', 'client:view', 'content:edit', 'dashboard:view', 'expense:submit', 'lead:edit', 'lead:view',
        'project:edit', 'project:view', 'task:edit', 'task:view', 'team:view', 'thirdParty:view', 'worklog:own',
      ].sort(),
    );
    expect(ROLE_DEFAULTS.admin).toHaveLength(14);
  });
  it('the grantable set', () => {
    expect([...GRANTABLE].sort()).toEqual(
      [
        'client:archive', 'content:publish', 'expense:record', 'expense:view', 'export:data', 'fx:edit', 'payment:record',
        'payment:view', 'payout:record', 'payout:view', 'project:archive', 'thirdParty:edit', 'worklog:viewAll',
      ].sort(),
    );
    expect(GRANTABLE).toHaveLength(13);
  });
  it('the grant dependencies', () => {
    expect(GRANT_DEPENDENCIES).toEqual({
      'payment:record': 'payment:view',
      'payout:record': 'payout:view',
      'expense:record': 'expense:view',
    });
  });
  it('the total number of capabilities', () => {
    expect(CAPABILITIES).toHaveLength(40);
  });
});
