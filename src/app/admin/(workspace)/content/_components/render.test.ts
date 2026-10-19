import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AnyContentDTO, DeveloperDTO, MediaRefDTO, PartnerDTO, PricingPlanDTO, ServiceDTO, ShowcaseDTO, SiteInfoDTO } from '@/lib/content/types';

// The editors are client components that read the router and the admin API context. Rendering them on the
// server with those stubbed is a smoke test: it proves every state of every editor renders without throwing
// and says what it should (the permission tick, the status checklist, the empty states).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  usePathname: () => '/admin/content/showcase',
  useSearchParams: () => new URLSearchParams(),
}));

import { AdminProviders } from '@/components/admin/api-provider';
import { MediaListPicker, MediaPicker } from '@/components/admin/media-picker';
import { ContentList } from './content-list';
import { ContentNav } from './content-nav';
import { DeveloperForm } from './developer-form';
import { PartnerForm } from './partner-form';
import { PermissionBadge, permissionOf } from './permission-badge';
import { PricingForm } from './pricing-form';
import { ServiceForm } from './service-form';
import { ShowcaseForm } from './showcase-form';
import { SiteForm } from './site-form';
import { StatusActions } from './status-actions';

const render = (node: React.ReactElement) => renderToStaticMarkup(h(AdminProviders, null, node));
/** The buttons of a status panel, without the confirm dialog that always sits (closed) after them. */
const actions = (html: string) => html.split('<dialog')[0] ?? html;

const image: MediaRefDTO = { id: 'a'.repeat(24), url: `/media/${'a'.repeat(24)}/logo.png`, filename: 'logo.png', mime: 'image/png', alt: 'Logo', width: 8, height: 8 };
const base = { id: 'b'.repeat(24), status: 'draft' as const, order: 0, slug: null, publishedAt: null, publishedBy: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', updatedBy: null, blockers: [] as string[] };

const showcase: ShowcaseDTO = { ...base, type: 'showcase', title: 'Flower Shop', slug: 'flower-shop', clientDisplayName: 'Acme', projectId: 'c'.repeat(24), projectLabel: 'PRJ-0001 Flower shop', summary: 'A shop', body: { brief: 'Brief', built: null, result: null }, serviceIds: ['d'.repeat(24)], services: [{ id: 'd'.repeat(24), title: 'Web apps' }], stack: ['React', 'Node'], coverMedia: image, galleryMedia: [image], liveUrl: 'https://acme.example.com', completedOn: '2026-02-01', clientApproved: false, blockers: ['Confirm the client has approved showing this project'] };
const partner: PartnerDTO = { ...base, type: 'partners', title: 'Acme', kind: 'agency', logoMedia: image, url: 'https://acme.example.com', permissionConfirmed: true };
const service: ServiceDTO = { ...base, type: 'services', title: 'Web apps', slug: 'web-apps', summary: 'We build web apps', deliverables: ['Design', 'Build'], stack: ['React'], totemKey: 'web-app' };
const plan: PricingPlanDTO = { ...base, type: 'pricing', title: 'Growth', summary: null, priceModel: 'per_month', amountMinor: 4_990_000, currency: 'INR', priceNote: 'Plus tax', features: ['One', 'Two'], highlighted: true, ctaLabel: null };
const developer: DeveloperDTO = { ...base, type: 'developers', title: 'Asha Rao', adminId: 'e'.repeat(24), adminName: 'Asha Rao', jobTitle: 'Frontend developer', photoMedia: image, bio: 'Builds interfaces.', skills: ['TypeScript'], links: { github: 'https://github.com/asha', linkedin: null, website: null }, consentConfirmed: false, blockers: ['Confirm this person has agreed to be shown'] };
const site: SiteInfoDTO = { legalName: null, displayName: 'ProDevly', email: 'hello@example.com', phone: null, whatsapp: null, address: null, social: { linkedin: null, github: 'https://github.com/prodevly', x: null, instagram: null, dribbble: null, behance: null }, footerNote: null, updatedAt: null };

describe('editors render in every state', () => {
  it('showcase: new, edit and read-only, with the client approval tick spelled out', () => {
    const services = [{ id: 'd'.repeat(24), title: 'Web apps' }];
    const fresh = render(h(ShowcaseForm, { serviceOptions: services, canLinkProject: true }));
    expect(fresh).toContain('Project title');
    expect(fresh).toContain('The client has approved showing this project');
    expect(fresh).toContain('Not confirmed');
    expect(fresh).toContain('Save draft');
    expect(fresh).toContain('Internal project');

    const edit = render(h(ShowcaseForm, { item: showcase, serviceOptions: services, canLinkProject: false }));
    expect(edit).toContain('value="Flower Shop"');
    expect(edit).toContain('Save changes');
    expect(edit).not.toContain('Internal project'); // hidden from someone who cannot see projects

    const locked = render(h(ShowcaseForm, { item: { ...showcase, status: 'published' }, serviceOptions: services, canLinkProject: true, readOnlyReason: 'This is live on the site.' }));
    expect(locked).toContain('This is live on the site.');
    expect(locked).toContain('<fieldset disabled');
    expect(locked).not.toContain('Save changes');
    expect(locked).toContain('Back to the list');
  });

  it('partner, service, pricing, developer and company info', () => {
    expect(render(h(PartnerForm, {}))).toContain('This partner has given permission to be shown');
    expect(render(h(PartnerForm, { item: partner }))).toContain('Confirmed');
    expect(render(h(ServiceForm, { item: service }))).toContain('3D object key');

    const newPlan = render(h(PricingForm, { currencies: ['INR', 'USD'] }));
    expect(newPlan).toContain('Fixed price, starting from');
    expect(newPlan).toContain('Price');
    const quote = render(h(PricingForm, { item: { ...plan, priceModel: 'quote', amountMinor: null, currency: null }, currencies: ['INR'] }));
    expect(quote).not.toContain('placeholder="0.00"'); // a quote plan has no amount box
    const priced = render(h(PricingForm, { item: plan, currencies: ['INR', 'USD'] }));
    expect(priced).toContain('value="49900.00"');
    expect(priced).toContain('Only one published plan can be highlighted at a time.');

    const dev = render(h(DeveloperForm, { item: developer, canLinkAccount: true }));
    expect(dev).toContain('This person has agreed to be shown');
    expect(dev).toContain('characters left');
    expect(dev).toContain('Team account');
    expect(render(h(DeveloperForm, { item: developer, canLinkAccount: false }))).not.toContain('Team account');

    const siteHtml = render(h(SiteForm, { site }));
    expect(siteHtml).toContain('Save company info');
    expect(siteHtml).toContain('value="hello@example.com"');
    expect(render(h(SiteForm, { site, readOnlyReason: 'Needs publish permission.' }))).not.toContain('Save company info');
  });

  it('a bio over the limit says how far over', () => {
    expect(render(h(DeveloperForm, { item: { ...developer, bio: 'x'.repeat(290) }, canLinkAccount: false }))).toContain('10 characters over');
  });
});

describe('the list, the status panel and the pickers', () => {
  const items: AnyContentDTO[] = [
    { ...showcase, order: 0 },
    { ...showcase, id: 'f'.repeat(24), title: 'Live project', status: 'published', clientApproved: true, blockers: [] },
  ];

  it('renders rows with reorder buttons named for their row, status words and what is missing', () => {
    const html = render(h(ContentList, { type: 'showcase', items, canPublish: true, reorderable: true }));
    expect(html).toContain('Move Flower Shop down');
    expect(html).toContain('Move Live project up');
    expect(html).toContain('Client approval missing');
    expect(html).toContain('Needs: Confirm the client has approved');
    expect(html).toContain('Live on the site');
    expect(html).toContain('Draft');
    expect(html).toContain('Published');
  });

  it('disables moves that would touch a published row for someone without publish authority, and hides order controls when filtered', () => {
    const noPublish = render(h(ContentList, { type: 'showcase', items, canPublish: false, reorderable: true }));
    expect(noPublish).toMatch(/aria-label="Move Flower Shop down"[^>]*disabled/);
    expect(noPublish).toMatch(/aria-label="Move Live project up"[^>]*disabled/);
    expect(render(h(ContentList, { type: 'showcase', items, canPublish: true, reorderable: false }))).not.toContain('Move Flower Shop down');
  });

  it('describes each type with its own detail line', () => {
    expect(render(h(ContentList, { type: 'pricing', items: [plan], canPublish: true, reorderable: false }))).toContain('Per month, ₹49,900.00');
    expect(render(h(ContentList, { type: 'services', items: [service], canPublish: true, reorderable: false }))).toContain('web-apps');
    expect(render(h(ContentList, { type: 'developers', items: [developer], canPublish: true, reorderable: false }))).toContain('Frontend developer');
    expect(render(h(ContentList, { type: 'partners', items: [partner], canPublish: true, reorderable: false }))).toContain('Permission given');
  });

  it('status panel: a draft that is not ready lists what is missing and cannot be published', () => {
    const blocked = render(h(StatusActions, { type: 'showcase', id: showcase.id, title: showcase.title, status: 'draft', blockers: showcase.blockers, canPublish: true, noun: 'project' }));
    expect(blocked).toContain('Before this can be published');
    expect(blocked).toContain('Confirm the client has approved showing this project');
    expect(actions(blocked)).toMatch(/<button[^>]*disabled[^>]*>.*Publish/s);
    expect(actions(blocked)).toContain('Archive');
  });

  it('status panel: there is exactly ONE confirm form, so a confirm button can never submit another action\'s form', () => {
    const html = render(h(StatusActions, { type: 'partners', id: 'b'.repeat(24), title: 'Acme', status: 'published', blockers: [], canPublish: true, noun: 'partner' }));
    // ConfirmDialog now derives its form id with useId, so several dialogs can coexist; there is still one form,
    // and its button points at exactly that form.
    const ids = [...html.matchAll(/<form id="([^"]+)"/g)].map((m) => m[1]).filter((id) => id !== 'step-up-form');
    expect(ids).toHaveLength(1);
    expect(html).toContain(`form="${ids[0]}"`);
  });

  it('status panel: every state offers the right actions, and no buttons without publish permission', () => {
    const panel = (status: 'draft' | 'published' | 'archived', canPublish = true, blockers: string[] = []) =>
      render(h(StatusActions, { type: 'partners', id: 'b'.repeat(24), title: 'Acme', status, blockers, canPublish, noun: 'partner' }));
    expect(panel('draft')).toContain('Ready to publish.');
    expect(actions(panel('draft'))).toContain('Publish</button>');
    expect(actions(panel('published'))).toContain('Unpublish</button>');
    expect(actions(panel('published'))).not.toContain('Publish</button>');
    expect(panel('published')).toContain('live on the site');
    expect(actions(panel('archived'))).toContain('Restore to draft</button>');
    expect(actions(panel('archived'))).not.toContain('Archive</button>');
    const readOnly = panel('draft', false);
    expect(readOnly).toContain('need publish permission');
    expect(readOnly).not.toContain('Publish</button>');
    expect(readOnly).not.toContain('confirm-form'); // nothing to confirm, no dialog
  });

  it('media pickers: empty, filled, disabled', () => {
    const empty = render(h(MediaPicker, { label: 'Cover image', value: null, onChange: () => {} }));
    expect(empty).toContain('No image chosen');
    expect(empty).toContain('Choose image');
    const filled = render(h(MediaPicker, { label: 'Cover image', value: image, onChange: () => {} }));
    expect(filled).toContain('logo.png');
    expect(filled).toContain('Change image');
    expect(filled).toContain('Remove');
    expect(render(h(MediaPicker, { label: 'Cover image', value: image, onChange: () => {}, disabled: true }))).not.toContain('Remove');
    const gallery = render(h(MediaListPicker, { label: 'Gallery', value: [image], onChange: () => {}, max: 1 }));
    expect(gallery).toContain('At most 1 images.');
    expect(render(h(MediaListPicker, { label: 'Gallery', value: [], onChange: () => {} }))).toContain('No images added.');
  });

  it('section nav marks the current section', () => {
    const html = renderToStaticMarkup(h(ContentNav, { active: 'pricing' }));
    expect(html).toContain('aria-current="page"');
    expect(html).toMatch(/aria-current="page"[^>]*>Pricing plans/);
    for (const label of ['Overview', 'Showcase', 'Partners', 'Services', 'Developers', 'Company info']) expect(html).toContain(label);
  });

  it('permission badges say it in words for the three types that have a tick, and nothing for the rest', () => {
    expect(permissionOf(showcase)).toEqual({ label: 'Client approval missing', given: false });
    expect(permissionOf(partner)).toEqual({ label: 'Permission given', given: true });
    expect(permissionOf(developer)).toEqual({ label: 'Consent missing', given: false });
    expect(permissionOf(service)).toBeNull();
    expect(permissionOf(plan)).toBeNull();
    expect(renderToStaticMarkup(h(PermissionBadge, { item: service }))).toBe('');
  });
});
