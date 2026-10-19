import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AuditEntryDTO } from '@/services/audit-log.service';
import { groupAuditByDay } from '@/services/audit-log.service';
import type { AuditDashboard } from '@/services/dashboards/audit';
import { AuditDashboardBand } from './audit-dashboard';
import { AuditList } from './audit-list';

const entry = (o: Partial<AuditEntryDTO> & { id: string; at: string }): AuditEntryDTO => ({
  actorId: null,
  actorName: 'Alice Rao',
  actorRole: 'admin',
  action: 'client.create',
  summary: null,
  entity: { type: 'client', id: null, ref: 'CL-0001', label: 'Acme Traders' },
  changes: [],
  context: { clientId: null, projectId: null, taskId: null },
  requestId: null,
  ...o,
});

const empty = (scope: 'all' | 'own'): AuditDashboard => ({
  scope,
  actions: 0,
  sensitive: { total: 0, adminManagement: 0, voids: 0, failedSignIns: 0 },
  actionsByDay: Array.from({ length: 30 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, '0')}`, actions: 0 })),
  byPerson: [],
  byEntityType: [],
});

const period = { label: 'This financial year', fyLabel: 'FY27' };
const render = (d: AuditDashboard, sp: Record<string, string> = {}) => renderToStaticMarkup(createElement(AuditDashboardBand, { dashboard: d, period, sp }));

describe('AuditList', () => {
  it('groups entries under day headings and keeps before/after one click away', () => {
    const entries = [
      entry({ id: '1', at: '2026-10-12T08:00:00Z', changes: [{ path: 'status', before: 'active', after: 'archived' }] }),
      entry({ id: '2', at: '2026-10-11T08:00:00Z', actorName: 'Bob Das', action: 'payment.void', entity: { type: 'payment', id: null, ref: null, label: 'Receipt' } }),
    ];
    const html = renderToStaticMarkup(createElement(AuditList, { groups: groupAuditByDay(entries, 'Asia/Kolkata'), timeZone: 'Asia/Kolkata' }));
    expect(html).toMatch(/Monday,? 12 October 2026/);
    expect(html).toMatch(/Sunday,? 11 October 2026/);
    expect(html).toContain('Alice Rao');
    expect(html).toContain('Bob Das');
    expect(html).toContain('voided payment');
    expect(html).toContain('<details');
    expect(html).toContain('1 change');
    // each day heading names its own group
    expect(html.match(/aria-labelledby="audit-day-/g)).toHaveLength(2);
  });

  it('shows the request id to everyone, and the shortened IP hash only when the entry carries one', () => {
    const hash = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const entries = [
      entry({ id: '1', at: '2026-10-12T08:00:00Z', summary: 'Wrong password', requestId: 'req-7c1e', ipHash: hash, action: 'auth.login_failed' }),
      entry({ id: '2', at: '2026-10-12T07:00:00Z', requestId: 'req-9a9a' }),
      entry({ id: '3', at: '2026-10-12T06:00:00Z' }),
    ];
    const html = renderToStaticMarkup(createElement(AuditList, { groups: groupAuditByDay(entries, 'UTC'), timeZone: 'UTC' }));
    expect(html).toContain('Wrong password \u00B7 Request req-7c1e \u00B7 IP hash a1b2c3d4e5f6');
    expect(html).not.toContain(hash); // never the full hash
    expect(html).toContain('Request req-9a9a');
    expect(html).not.toMatch(/Request req-9a9a[^<]*IP hash/); // no hash key on this entry, so none is shown
  });

  it('puts the clock time, in the organisation zone, on every row (the relative time alone hides it on a phone)', () => {
    const entries = [entry({ id: '1', at: '2026-10-12T08:00:00Z', summary: 'Entered twice' }), entry({ id: '2', at: '2026-10-12T07:00:00Z' })];
    const render = (zone: string) => renderToStaticMarkup(createElement(AuditList, { groups: groupAuditByDay(entries, zone), timeZone: zone }));
    // 08:00 UTC is 1:30 pm in India; the clock leads the muted line and the summary follows it.
    expect(render('Asia/Kolkata')).toMatch(/1:30\s[ap]m \u00B7 Entered twice/i);
    expect(render('Asia/Kolkata')).toMatch(/12:30\s[ap]m/i);
    expect(render('UTC')).toMatch(/8:00\s[ap]m \u00B7 Entered twice/i);
    // a zone name that is not a zone must not take the page down
    expect(render('Not/AZone')).toMatch(/1:30\s[ap]m/i);
  });

  it('escapes what people typed into summaries and record names', () => {
    const html = renderToStaticMarkup(
      createElement(AuditList, {
        groups: groupAuditByDay([entry({ id: '1', at: '2026-10-12T08:00:00Z', summary: '<img src=x onerror=alert(1)>', entity: { type: 'client', id: null, ref: null, label: '<b>Acme</b>' } })], 'UTC'),
        timeZone: 'UTC',
      }),
    );
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>Acme');
    expect(html).toContain('&lt;img');
  });
});

describe('AuditDashboardBand', () => {
  it('shows a superadmin the five figures and three charts', () => {
    const html = render({ ...empty('all'), actions: 40, sensitive: { total: 8, adminManagement: 3, voids: 2, failedSignIns: 3 } });
    for (const label of ['Actions', 'Sensitive actions', 'Account management', 'Voids', 'Failed sign-ins']) expect(html).toContain(label);
    for (const title of ['Actions per day', 'Actions by person', 'Actions by record type']) expect(html).toContain(title);
    expect(html).toContain('20% of all actions'); // 8 of 40
  });

  it('shows everyone else two figures and two charts, about themselves', () => {
    const html = render({ ...empty('own'), actions: 4 });
    expect(html).toContain('Your actions');
    expect(html).toContain('Sensitive actions');
    for (const hidden of ['Account management', 'Voids', 'Failed sign-ins', 'Actions by person']) expect(html).not.toContain(hidden);
    expect(html).toContain('Actions per day');
    expect(html).toContain('Actions by record type');
  });

  it('renders zeros and an empty state, never a ratio, when nothing was recorded', () => {
    const html = render(empty('all'));
    expect(html).toContain('No records yet');
    expect(html).not.toContain('% of all actions');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
  });

  it('links a figure to its filtered list only when there is something to list, keeping the period only', () => {
    const none = render(empty('all'), { period: 'this_month', q: 'acme' });
    expect(none).not.toContain('href="/admin/audit');

    const html = render({ ...empty('all'), actions: 5, sensitive: { total: 2, adminManagement: 0, voids: 0, failedSignIns: 2 } }, { period: 'this_month', q: 'acme', page: '3' });
    expect(html).toContain('href="/admin/audit?period=this_month&amp;sensitive=1"');
    expect(html).toContain('href="/admin/audit?period=this_month&amp;action=auth.login_failed"');
    expect(html).not.toContain('acme');
  });
});
