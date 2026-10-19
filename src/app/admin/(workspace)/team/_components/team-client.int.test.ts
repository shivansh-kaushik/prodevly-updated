import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PayProfileDTO } from '@/services/pay-profile.service';
import type { TeamRoleDTO } from '@/services/team-role.service';
import type { OwnProfileDTO } from '@/services/team.service';
import { OwnProfileForm } from '../../account/own-profile-form';
import { RolesManager } from '../roles/_components/roles-manager';
import { PayProfilePanel } from './pay-profile-panel';

// The client components read the router, the API provider and the toast context. None of them matters for what
// is rendered, so they are replaced; what these tests check is WHAT EACH AUDIENCE IS SHOWN.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/components/admin/api-provider', () => ({ useAdminApi: () => ({ call: vi.fn() }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ show: vi.fn() }) }));

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

const role = (o: Partial<TeamRoleDTO> & Pick<TeamRoleDTO, 'id' | 'name'>): TeamRoleDTO => ({
  description: null,
  order: 0,
  archived: false,
  archivedAt: null,
  memberCount: 0,
  activeMemberCount: 0,
  ...o,
});

describe('RolesManager', () => {
  it('offers delete only for a role nobody holds, restore for archived ones, and says who holds what', () => {
    const out = renderToStaticMarkup(
      createElement(RolesManager, {
        roles: [
          role({ id: 'a', name: 'Frontend developer', memberCount: 2, activeMemberCount: 2 }),
          role({ id: 'b', name: 'QA', order: 1 }),
          role({ id: 'c', name: 'Designer', archived: true, archivedAt: '2026-05-01T00:00:00.000Z' }),
        ],
      }),
    );
    expect(out).toContain('Add a job role');
    expect(out).toContain('2 people hold it');
    expect(out).toContain('No one holds it');
    expect(out).toContain('Restore');
    // Frontend developer is held, so it can be archived but not deleted: only QA and Designer offer Delete.
    expect(count(out, '>Delete<')).toBe(2);
    expect(count(out, '>Archive<')).toBe(2); // the two live roles
    expect(out).toContain('Move Frontend developer down');
    expect(out).toMatch(/Move Frontend developer up/);
  });

  it('shows an empty state, not a blank panel, when there are no job roles', () => {
    const out = renderToStaticMarkup(createElement(RolesManager, { roles: [] }));
    expect(out).toContain('No job roles yet');
    expect(out).not.toContain('Archived');
  });
});

const terms = { adminId: 'p1', adminName: 'Asha Rao', exists: true, basis: 'monthly', rateMinor: 4_500_000, currency: 'INR', effectiveFrom: '2026-04-01', updatedAt: '2026-04-01T00:00:00.000Z' } as const satisfies PayProfileDTO;

describe('PayProfilePanel', () => {
  it('shows a person their own basis and rate and nothing else: no form, no note, no history', () => {
    const out = renderToStaticMarkup(createElement(PayProfilePanel, { profile: terms, canEdit: false, currencies: ['INR', 'USD'], today: '2026-10-12' }));
    expect(out).toContain('per month');
    expect(out).toContain('45,000.00');
    expect(out).not.toContain('Save pay profile');
    expect(out).not.toContain('Payout note');
    expect(out).not.toContain('Earlier terms');
  });

  it('gives a superadmin the form, the payout note and the history', () => {
    const profile: PayProfileDTO = {
      ...terms,
      rateMinor: 5_000_000,
      effectiveFrom: '2026-09-01',
      payoutNote: 'UPI: asha@bank',
      history: [{ basis: 'monthly', rateMinor: 4_500_000, currency: 'INR', effectiveFrom: '2026-04-01', effectiveTo: '2026-08-31', changedBy: 'Lakshya Sharma' }],
    };
    const out = renderToStaticMarkup(createElement(PayProfilePanel, { profile, canEdit: true, currencies: ['INR', 'USD'], today: '2026-10-12' }));
    expect(out).toContain('Save pay profile');
    expect(out).toContain('Payout note');
    expect(out).toContain('UPI: asha@bank');
    expect(out).toContain('Earlier terms');
    expect(out).toContain('Lakshya Sharma');
    expect(out).toContain('max="2026-10-12"'); // a change cannot start in the future
  });

  it('reads "no pay basis" for a person without a profile instead of inventing a rate', () => {
    const profile: PayProfileDTO = { adminId: 'p2', adminName: 'New Joiner', exists: false, basis: 'none', rateMinor: 0, currency: 'INR', effectiveFrom: null, updatedAt: null };
    const out = renderToStaticMarkup(createElement(PayProfilePanel, { profile, canEdit: false, currencies: ['INR'], today: '2026-10-12' }));
    expect(out).toContain('No pay basis recorded');
    expect(out).not.toMatch(/NaN|Infinity|undefined/);
  });
});

describe('OwnProfileForm', () => {
  const profile: OwnProfileDTO = { phone: '98765 43210', designation: 'Engineer', skills: ['React', 'CSS'], jobRole: 'Frontend developer', employmentType: 'full_time', weeklyCapacityHours: 40 };

  it('edits phone, title and skills, and shows job role, employment and capacity read-only', () => {
    const out = renderToStaticMarkup(createElement(OwnProfileForm, { profile }));
    expect(out).toContain('98765 43210');
    expect(out).toContain('React, CSS');
    expect(out).toContain('Frontend developer');
    expect(out).toContain('Full time');
    expect(out).toContain('40 hours');
    expect(out).toContain('A superadmin sets these');
    // Exactly three inputs a person can type into; the read-only values are not controls.
    expect(count(out, '<input')).toBe(3);
    // Nothing to save yet, so the button is disabled.
    expect(out).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?Save profile/);
  });

  it('copes with an empty profile', () => {
    const out = renderToStaticMarkup(createElement(OwnProfileForm, { profile: { phone: null, designation: null, skills: [], jobRole: null, employmentType: null, weeklyCapacityHours: null } }));
    expect(out).toContain('Save profile');
    expect(out).not.toMatch(/NaN|Infinity|undefined|null/);
  });
});
