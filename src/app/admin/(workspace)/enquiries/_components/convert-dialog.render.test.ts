import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConvertButton, ConvertDialog, type ConvertLead } from './convert-dialog';

// The drawer reads the router, the API client and the toast. None of them matters for what is first drawn.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/components/admin/api-provider', () => ({ useAdminApi: () => ({ call: vi.fn() }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ show: vi.fn() }) }));

const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const lead = (o: Partial<ConvertLead> = {}): ConvertLead => ({
  id: '5f3a5f3a5f3a5f3a5f3a5f3a',
  ref: 'ENQ-0007',
  name: 'Neha Verma',
  company: 'Acme Logistics',
  email: 'neha@acme-logistics.example',
  phone: '+91 98765 43210',
  country: 'India',
  ...o,
});
const render = (l: ConvertLead, props: { canStartProject?: boolean; currencies?: string[] } = {}) =>
  renderToStaticMarkup(createElement(ConvertDialog, { open: true, onClose: () => {}, lead: l, currencies: props.currencies ?? ['INR', 'USD'], canStartProject: props.canStartProject ?? true }));

describe('the convert drawer, as first drawn', () => {
  it('starts a new client from the enquiry: company name, kind, country code, and the enquirer as main contact', () => {
    const html = render(lead());
    expect(html).toContain('value="Acme Logistics"');
    expect(html).toMatch(/<option value="company" selected/);
    expect(html).toContain('value="IN"');
    const words = text(html);
    expect(words).toMatch(/The main contact is Neha Verma, neha@acme-logistics\.example\s*, \+91 98765 43210\./);
    expect(words).toContain('From the company on the enquiry.');
    expect(html).toContain('<option value="USD">USD</option>');
  });

  it('names an individual after the person, and asks for a country code when theirs was not recognised', () => {
    const words = text(render(lead({ company: null, country: 'Narnia', phone: null })));
    expect(render(lead({ company: null }))).toContain('value="Neha Verma"');
    expect(words).toContain("No company was given, so this is the person's name.");
    expect(words).toContain('They wrote "Narnia". Use the 2-letter code');
    expect(words).toMatch(/The main contact is Neha Verma, neha@acme-logistics\.example\s*\. You can add/);
  });

  it('previews what will happen, and the button says what it does', () => {
    const words = text(render(lead()));
    expect(words).toContain('What will happen');
    expect(words).toContain('Create the client "Acme Logistics" (company), with Neha Verma as the main contact.');
    expect(words).toContain('Mark ENQ-0007 as won and link it to the client.');
    expect(words).toContain('If any part fails, nothing is saved.');
    expect(words).toContain('Create client');
    expect(words).toContain('Who is the client?');
  });

  it('offers a draft project only to someone who may edit projects, and never starts with one switched on', () => {
    const withIt = render(lead());
    expect(text(withIt)).toContain('Also start a draft project');
    expect(withIt).not.toContain('Choose a type'); // the project fields appear only once it is switched on
    expect(text(render(lead(), { canStartProject: false }))).not.toContain('draft project');
  });

  it('is a drawer with a name, a close button and a cancel', () => {
    const html = render(lead());
    expect(html).toContain('<dialog');
    expect(html).toContain('pd-drawer-panel');
    expect(text(html)).toContain('Convert to a client');
    expect(html).toContain('aria-label="Close"');
    expect(text(html)).toContain('Cancel');
  });

  it('renders visitor text as text, never as markup', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const html = render(lead({ name: hostile, company: hostile, email: 'a@example.com' }));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('the page button', () => {
  it('shows one button and mounts nothing until it is pressed', () => {
    const html = renderToStaticMarkup(createElement(ConvertButton, { lead: lead(), currencies: ['INR'], canStartProject: true }));
    expect(text(html)).toContain('Convert to client');
    expect(html).not.toContain('<dialog');
  });
});
