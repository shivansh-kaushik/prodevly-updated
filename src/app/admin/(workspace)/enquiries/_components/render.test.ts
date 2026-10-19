import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FUNNEL_STAGES, OPEN_LEAD_STATUSES } from '@/lib/validation/lead';
import type { EnquiriesDashboard } from '@/services/dashboards/enquiries';
import type { LeadListItem } from '@/services/lead.service';
import { DashboardBand } from './dashboard-band';
import { EnquiryTable } from './enquiry-table';
import { PlainText } from './plain-text';

const HOSTILE = '<script>alert(1)</script><img src=x onerror=alert(2)><a href="javascript:alert(3)">click</a>';

describe('visitor text is rendered as text', () => {
  it('PlainText escapes markup instead of producing elements', () => {
    const html = renderToStaticMarkup(createElement(PlainText, { text: HOSTILE }));
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<a ');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('dir="auto"');
  });

  it('keeps line breaks with CSS, not with markup', () => {
    const html = renderToStaticMarkup(createElement(PlainText, { text: 'one\ntwo' }));
    expect(html).toContain('whitespace-pre-wrap');
    expect(html).toContain('one\ntwo');
    expect(html).not.toContain('<br');
  });

  it('the list escapes a hostile name, company, email and message excerpt', () => {
    const item: LeadListItem = {
      id: '5f3a5f3a5f3a5f3a5f3a5f3a',
      ref: 'ENQ-0001',
      name: HOSTILE,
      email: 'a@example.com',
      company: HOSTILE,
      excerpt: HOSTILE,
      services: [HOSTILE],
      status: 'new',
      assignedTo: { id: '5f3a5f3a5f3a5f3a5f3a5f3b', name: HOSTILE },
      followUpOn: '2026-10-01',
      createdAt: '2026-10-12T10:00:00.000Z',
      firstResponseAt: null,
    };
    const html = renderToStaticMarkup(createElement(EnquiryTable, { items: [item], today: '2026-10-12', sp: {}, sort: 'createdAt', dir: 'desc' }));
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    // the hostile text is present, as escaped characters
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');
    // the only links are ours: the row link and the sort headers
    expect([...html.matchAll(/href="([^"]*)"/g)].every((m) => m[1]?.startsWith('/admin/enquiries'))).toBe(true);
    // an overdue follow-up on an open enquiry says so in words
    expect(html).toContain('Overdue');
  });
});

describe('the dashboard band', () => {
  const empty: EnquiriesDashboard = {
    period: { from: '2026-04-01', to: '2027-03-31' },
    newInPeriod: 0,
    spamInPeriod: 0,
    open: { total: 0, byStatus: OPEN_LEAD_STATUSES.map((status) => ({ status, count: 0 })) },
    waitingForFirstReply: 0,
    firstReply: { medianMinutes: null, replied: 0 },
    conversion: { won: 0, lost: 0, rate: null },
    followUpsDue: 0,
    perWeek: [{ weekStart: '2026-10-12', label: '12 Oct', count: 0 }],
    funnel: FUNNEL_STAGES.map((stage) => ({ stage, label: stage, count: 0 })),
    byService: [],
    byBudget: [],
    bySourcePath: [],
    byUtmSource: [],
  };
  const render = (d: EnquiriesDashboard) => renderToStaticMarkup(createElement(DashboardBand, { dashboard: d, periodText: 'This financial year (FY27)', sp: {} }));

  it('an empty database shows zeros and "no data" wording, never a made-up ratio', () => {
    const html = render(empty);
    expect(html).not.toMatch(/NaN|Infinity|undefined/);
    expect(html).toContain('No data'); // median reply and conversion both need something to measure
    expect(html).toContain('Nothing waiting');
    expect(html).toContain('Nothing won or lost yet');
    expect(html).toContain('No replies yet');
    expect(html).toContain('No records yet'); // every chart's empty state
    expect(html).not.toContain('0%');
    expect(html).not.toContain('pd-margin-flag'); // nothing needs attention
  });

  it('shows the figures it is given, flags what needs attention, and formats the ratio only with a denominator', () => {
    const html = render({
      ...empty,
      newInPeriod: 6,
      spamInPeriod: 2,
      open: { total: 4, byStatus: [{ status: 'new', count: 2 }, { status: 'contacted', count: 1 }, { status: 'qualified', count: 0 }, { status: 'proposal_sent', count: 1 }] },
      waitingForFirstReply: 2,
      firstReply: { medianMinutes: 90, replied: 5 },
      conversion: { won: 2, lost: 1, rate: 2 / 3 },
      followUpsDue: 3,
      byService: [{ label: 'Web apps', count: 3 }],
    });
    expect(html).toContain('This financial year (FY27), 2 held as spam');
    expect(html).toContain('2 new, 1 contacted, 1 proposal sent');
    expect(html).toContain('1h 30m');
    expect(html).toContain('67%');
    expect(html).toContain('2 won, 1 lost');
    expect(html).toContain('From 5 replies');
    expect(html).toContain('pd-margin-flag');
    // the tiles that lead to a filtered list keep the period params and set the filter
    expect(html).toContain('/admin/enquiries?status=open');
    expect(html).toContain('/admin/enquiries?followUp=due');
  });
});
