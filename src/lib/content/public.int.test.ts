import { describe, expect, it, vi } from 'vitest';
import { DeveloperProfile, Media, PricingPlan } from '@/models';
import { setupTestDb } from '@/test/db';
import {
  makeDeveloper, makeMedia, makePartner, makePlan, makeService, makeShowcase, makeSiteInfo, pdfBytes,
} from '@/test/content-factories';
import { newId } from '@/test/domain-factories';

const registered = vi.hoisted(() => [] as Array<{ keyParts: string[]; tags: string[]; revalidate?: number }>);
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  unstable_cache: <T,>(fn: T, keyParts: string[], options: { tags: string[]; revalidate?: number }) => {
    registered.push({ keyParts, tags: options.tags, revalidate: options.revalidate });
    return fn;
  },
}));

import {
  getPublicSiteInfo,
  getPublishedDevelopers,
  getPublishedPartners,
  getPublishedPricingPlans,
  getPublishedServices,
  getPublishedShowcase,
  getPublishedShowcaseItem,
  getVisibleSections,
  hasPublished,
} from '@/lib/content/public';

setupTestDb();

/** Every key name that appears anywhere in a value. */
const keysDeep = (value: unknown): string[] =>
  Array.isArray(value) ? value.flatMap(keysDeep) : value && typeof value === 'object' ? Object.entries(value).flatMap(([k, v]) => [k, ...keysDeep(v)]) : [];

const INTERNAL = ['_id', '__v', 'id', 'status', 'projectId', 'adminId', 'createdBy', 'updatedBy', 'publishedBy', 'clientApproved', 'permissionConfirmed', 'consentConfirmed', 'order', 'createdAt', 'updatedAt', 'coverMediaId', 'galleryMediaIds', 'logoMediaId', 'photoMediaId', 'serviceIds', 'sha256', 'fileId', 'visibility'];

describe('public reads return ONLY published records', () => {
  it('for every type: published in, draft and archived out', async () => {
    await makeShowcase({ title: 'Live project', published: true });
    await makeShowcase({ title: 'Draft project' });
    await makeShowcase({ title: 'Old project', status: 'archived' });
    await makePartner({ name: 'Live partner', published: true });
    await makePartner({ name: 'Draft partner' });
    await makePartner({ name: 'Old partner', status: 'archived' });
    await makeService({ title: 'Live service', published: true });
    await makeService({ title: 'Draft service' });
    await makePlan({ name: 'Live plan', published: true });
    await makePlan({ name: 'Draft plan' });
    await makeDeveloper({ displayName: 'Live dev', published: true });
    await makeDeveloper({ displayName: 'Draft dev' });
    await makeDeveloper({ displayName: 'Old dev', status: 'archived' });

    expect((await getPublishedShowcase()).map((x) => x.title)).toEqual(['Live project']);
    expect((await getPublishedPartners()).map((x) => x.name)).toEqual(['Live partner']);
    expect((await getPublishedServices()).map((x) => x.title)).toEqual(['Live service']);
    expect((await getPublishedPricingPlans()).map((x) => x.name)).toEqual(['Live plan']);
    expect((await getPublishedDevelopers()).map((x) => x.displayName)).toEqual(['Live dev']);
  });

  it('comes back in display order', async () => {
    await makePartner({ name: 'C', order: 3, published: true });
    await makePartner({ name: 'A', order: 1, published: true });
    await makePartner({ name: 'B', order: 2, published: true });
    expect((await getPublishedPartners()).map((p) => p.name)).toEqual(['A', 'B', 'C']);
  });

  it('is empty, not an error, when nothing exists', async () => {
    expect(await getPublishedShowcase()).toEqual([]);
    expect(await getPublishedPartners()).toEqual([]);
    expect(await getPublishedServices()).toEqual([]);
    expect(await getPublishedPricingPlans()).toEqual([]);
    expect(await getPublishedDevelopers()).toEqual([]);
  });
});

describe('public reads re-check the permission ticks (the second lock)', () => {
  it('never shows a published record whose tick is missing, even if one got into the database some other way', async () => {
    await makeShowcase({ title: 'Approved', slug: 'approved-one', order: 1, published: true });
    await makeShowcase({ title: 'Not approved', slug: 'not-approved-one', order: 2, published: true, clientApproved: false });
    await makePartner({ name: 'Permitted', order: 1, published: true });
    await makePartner({ name: 'Not permitted', order: 2, published: true, permissionConfirmed: false });
    await makeDeveloper({ displayName: 'Consented', order: 1, published: true });
    await makeDeveloper({ displayName: 'Not consented', order: 2, published: true, consentConfirmed: false });
    expect((await getPublishedShowcase()).map((x) => x.title)).toEqual(['Approved']);
    expect((await getPublishedPartners()).map((x) => x.name)).toEqual(['Permitted']);
    expect((await getPublishedDevelopers()).map((x) => x.displayName)).toEqual(['Consented']);
    expect(await getPublishedShowcaseItem('approved-one')).not.toBeNull();
    expect(await getPublishedShowcaseItem('not-approved-one')).toBeNull(); // the single-project read holds the same lock
  });

  it('hides a whole section when its only published record lacks the tick', async () => {
    await makePartner({ published: true, permissionConfirmed: false });
    await makeShowcase({ published: true, clientApproved: false });
    await makeDeveloper({ published: true, consentConfirmed: false });
    expect(await hasPublished('partners')).toBe(false);
    expect(await getVisibleSections()).toMatchObject({ partners: false, projects: false, developers: false });
  });

  it('does not list a priced plan that has no price, but does list a quote plan', async () => {
    // The model refuses to SAVE a published unpriced plan, so go round it the way a bad import would.
    const broken = await makePlan({ name: 'Broken', priceModel: 'per_month', amountMinor: undefined, currency: undefined });
    await PricingPlan.updateOne({ _id: broken._id }, { $set: { status: 'published', publishedAt: new Date() } });
    await makePlan({ name: 'Quote', priceModel: 'quote', amountMinor: undefined, currency: undefined, published: true });
    expect((await getPublishedPricingPlans()).map((p) => p.name)).toEqual(['Quote']);
    await makePlan({ name: 'Priced', published: true });
    expect((await getPublishedPricingPlans()).map((p) => p.name).sort()).toEqual(['Priced', 'Quote']);
  });
});

describe('public reads carry no internal fields', () => {
  it('shows exactly the listed fields for each type, never an id, status, permission tick, link or who edited', async () => {
    const image = await makeMedia({ alt: 'The shop' });
    const service = await makeService({ published: true });
    await makeShowcase({
      published: true, clientDisplayName: 'Acme', projectId: newId(), serviceIds: [service._id], coverMediaId: image._id, galleryMediaIds: [image._id],
      stack: ['React'], liveUrl: 'https://acme.example.com', completedOn: new Date('2026-02-01T00:00:00Z'), body: { brief: 'B', built: 'W', result: 'R' },
    });
    await makePartner({ published: true, logoMediaId: image._id, url: 'https://p.example.com' });
    await makeService({ published: true, deliverables: ['One'], stack: ['Node'], totemKey: 'web-app' });
    await makePlan({ published: true, summary: 'S', features: ['F'], priceNote: 'N', ctaLabel: 'Go', highlighted: true });
    await makeDeveloper({ published: true, adminId: newId(), photoMediaId: image._id, title: 'Dev', bio: 'Bio', skills: ['TS'], links: { github: 'https://github.com/x' } });

    const [showcase] = await getPublishedShowcase();
    expect(Object.keys(showcase as object).sort()).toEqual(['body', 'clientDisplayName', 'completedOn', 'cover', 'gallery', 'liveUrl', 'publishedAt', 'services', 'slug', 'stack', 'summary', 'title']);
    expect(Object.keys((await getPublishedPartners())[0] as object).sort()).toEqual(['key', 'kind', 'logo', 'name', 'url']);
    expect(Object.keys((await getPublishedServices())[0] as object).sort()).toEqual(['deliverables', 'slug', 'stack', 'summary', 'title', 'totemKey']);
    expect(Object.keys((await getPublishedPricingPlans())[0] as object).sort()).toEqual(['ctaLabel', 'features', 'highlighted', 'key', 'name', 'price', 'priceModel', 'priceNote', 'summary']);
    expect(Object.keys((await getPublishedDevelopers())[0] as object).sort()).toEqual(['bio', 'displayName', 'key', 'links', 'photo', 'skills', 'title']);

    const all = [await getPublishedShowcase(), await getPublishedPartners(), await getPublishedServices(), await getPublishedPricingPlans(), await getPublishedDevelopers(), await getPublicSiteInfo()];
    expect(keysDeep(all).filter((k) => INTERNAL.includes(k))).toEqual([]);
    expect(JSON.stringify(all)).not.toMatch(/internal|createdBy|sha256|fileId/);
  });

  it('survives JSON serialisation unchanged (what unstable_cache does): plain strings, numbers and nulls', async () => {
    await makeShowcase({ published: true, completedOn: new Date('2026-02-01T00:00:00Z') });
    const result = await getPublishedShowcase();
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('never includes the internal project link or account id, even when set', async () => {
    await makeShowcase({ published: true, projectId: newId() });
    await makeDeveloper({ published: true, adminId: newId() });
    expect(JSON.stringify(await getPublishedShowcase())).not.toContain('projectId');
    expect(JSON.stringify(await getPublishedDevelopers())).not.toContain('adminId');
  });
});

describe('showcase details', () => {
  it('shows only published services as tags', async () => {
    const live = await makeService({ title: 'Live service', published: true });
    const draft = await makeService({ title: 'Draft service' });
    const archived = await makeService({ title: 'Old service', status: 'archived' });
    await makeShowcase({ published: true, serviceIds: [live._id, draft._id, archived._id] });
    expect((await getPublishedShowcase())[0]?.services).toEqual([{ slug: live.slug, title: 'Live service' }]);
  });

  it('shows images only when they are public files, with the owner name as fallback description', async () => {
    const pub = await makeMedia({ alt: 'Storefront' });
    const noAlt = await makeMedia();
    const secret = await makeMedia({ visibility: 'private', purpose: 'expense', mime: 'application/pdf', bytes: pdfBytes() });
    await makeShowcase({ published: true, title: 'Flower shop', coverMediaId: secret._id, galleryMediaIds: [pub._id, noAlt._id, secret._id, newId()] });
    const [item] = await getPublishedShowcase();
    expect(item?.cover).toBeNull(); // a private file is never a cover
    expect(item?.gallery).toEqual([
      { url: `/media/${pub._id}/${pub.filename}`, alt: 'Storefront', width: 8, height: 8 },
      { url: `/media/${noAlt._id}/${noAlt.filename}`, alt: 'Flower shop', width: 8, height: 8 },
    ]);
    expect(JSON.stringify(item)).not.toContain(String(secret._id));
  });

  it('shows the completion date only when someone entered it', async () => {
    await makeShowcase({ title: 'With date', order: 1, published: true, completedOn: new Date('2026-02-01T00:00:00Z') });
    await makeShowcase({ title: 'No date', order: 2, published: true });
    const items = await getPublishedShowcase();
    expect(items.map((i) => i.completedOn)).toEqual(['2026-02-01', null]);
  });

  it('finds one published project by slug, and nothing for a draft, an archived item, an unknown or a malformed slug', async () => {
    await makeShowcase({ slug: 'live-one', published: true });
    await makeShowcase({ slug: 'draft-one' });
    await makeShowcase({ slug: 'old-one', status: 'archived' });
    expect((await getPublishedShowcaseItem('live-one'))?.slug).toBe('live-one');
    for (const slug of ['draft-one', 'old-one', 'missing', 'LIVE-ONE', '', '../x', '{"$ne":""}']) expect(await getPublishedShowcaseItem(slug)).toBeNull();
    expect(await getPublishedShowcaseItem({ $ne: '' } as unknown as string)).toBeNull();
  });
});

describe('pricing details', () => {
  it('a quote plan renders with no number at all, whatever the record holds', async () => {
    await makePlan({ name: 'Custom', priceModel: 'quote', amountMinor: 999_900, currency: 'INR', order: 1, published: true });
    await makePlan({ name: 'Starter', priceModel: 'per_month', amountMinor: 49_900, currency: 'USD', order: 2, published: true });
    const [quote, priced] = await getPublishedPricingPlans();
    expect(quote?.price).toBeNull();
    expect(priced?.price).toEqual({ amountMinor: 49_900, currency: 'USD' });
  });
});

describe('company info', () => {
  it('leaves empty fields out, and falls back only to the brand name', async () => {
    expect(await getPublicSiteInfo()).toEqual({ displayName: 'ProDevly', legalName: null, email: null, phone: null, whatsapp: null, address: null, social: {}, footerNote: null });
    await makeSiteInfo({ email: 'hello@example.com', social: { linkedin: 'https://linkedin.com/x', github: '', x: undefined } });
    const info = await getPublicSiteInfo();
    expect(info.email).toBe('hello@example.com');
    expect(info.social).toEqual({ linkedin: 'https://linkedin.com/x' });
    expect(info.phone).toBeNull();
  });
});

describe('hasPublished and getVisibleSections: a section with nothing published renders nothing', () => {
  it('hides every content section on an empty database', async () => {
    for (const type of ['showcase', 'partners', 'services', 'pricing', 'developers'] as const) expect(await hasPublished(type)).toBe(false);
    expect(await getVisibleSections()).toEqual({ partners: false, projects: false, services: false, pricing: false, developers: false });
  });

  it('a draft or an archived record does not make a section appear', async () => {
    await makePartner();
    await makeService({ status: 'archived' });
    expect(await hasPublished('partners')).toBe(false);
    expect(await hasPublished('services')).toBe(false);
    expect((await getVisibleSections()).partners).toBe(false);
  });

  it('shows exactly the sections that have a published record', async () => {
    await makeShowcase({ published: true });
    await makePlan({ published: true });
    await makePartner();
    expect(await hasPublished('showcase')).toBe(true);
    expect(await getVisibleSections()).toEqual({ partners: false, projects: true, services: false, pricing: true, developers: false });
  });

  it('follows the data: a section disappears again when its last item is unpublished', async () => {
    const dev = await makeDeveloper({ published: true });
    expect((await getVisibleSections()).developers).toBe(true);
    await DeveloperProfile.updateOne({ _id: dev._id }, { $set: { status: 'draft' } });
    expect((await getVisibleSections()).developers).toBe(false);
  });
});

describe('caching', () => {
  const entry = (name: string) => registered.find((r) => r.keyParts[1] === name);

  it('reads each content type under its own tag, so a content write refreshes exactly the right reads', () => {
    expect(entry('showcase')?.tags.sort()).toEqual(['content:services', 'content:showcase']);
    expect(entry('showcase-item')?.tags.sort()).toEqual(['content:services', 'content:showcase']);
    expect(entry('partners')?.tags).toEqual(['content:partners']);
    expect(entry('services')?.tags).toEqual(['content:services']);
    expect(entry('pricing')?.tags).toEqual(['content:pricing']);
    expect(entry('developers')?.tags).toEqual(['content:developers']);
    expect(entry('site')?.tags).toEqual(['content:site']);
    expect(entry('has-published')?.tags.sort()).toEqual(['content:developers', 'content:partners', 'content:pricing', 'content:services', 'content:showcase']);
    expect(entry('visible-sections')?.tags.sort()).toEqual(['content:developers', 'content:partners', 'content:pricing', 'content:services', 'content:showcase']);
  });

  it('also expires on a timer, as a backstop for hosts where a tag does not reach every instance', () => {
    expect(registered.length).toBeGreaterThan(0);
    for (const r of registered) expect(r.revalidate).toBe(3600);
  });

  it('does not touch the database at import time', async () => {
    expect(await Media.countDocuments()).toBe(0);
  });
});
