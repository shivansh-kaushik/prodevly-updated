import { describe, expect, it } from 'vitest';
import { ADMIN_NAV, visibleNav } from './admin-nav';
import { effectiveCapabilities } from './capabilities';

const keys = (caps: ReturnType<typeof effectiveCapabilities>) => visibleNav(caps).flatMap((g) => g.items.map((i) => i.key));

describe('admin navigation', () => {
  it('shows a superadmin everything', () => {
    const all = ADMIN_NAV.flatMap((g) => g.items.map((i) => i.key));
    expect(keys(effectiveCapabilities('superadmin'))).toEqual(all);
  });
  it('hides money, admin management and settings from a plain admin', () => {
    const k = keys(effectiveCapabilities('admin'));
    for (const hidden of ['payments', 'admins', 'settings', 'work-logs']) expect(k).not.toContain(hidden);
    for (const shown of ['overview', 'my', 'clients', 'projects', 'tasks', 'expenses', 'team', 'content', 'enquiries', 'audit']) expect(k).toContain(shown);
  });
  it('a grant reveals the matching item, and nothing else', () => {
    const k = keys(effectiveCapabilities('admin', ['payment:view']));
    expect(k).toContain('payments');
    expect(k).not.toContain('admins');
    expect(keys(effectiveCapabilities('admin', ['payout:view']))).toContain('third-parties');
  });
  it('drops empty groups', () => {
    const groups = visibleNav(new Set());
    expect(groups.map((g) => g.label)).toEqual(['Work', 'System']);
  });
  it('every href is under /admin and keys are unique', () => {
    const items = ADMIN_NAV.flatMap((g) => g.items);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
    for (const i of items) expect(i.href.startsWith('/admin')).toBe(true);
  });
});
