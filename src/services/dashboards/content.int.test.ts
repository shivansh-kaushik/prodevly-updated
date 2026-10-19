import { describe, expect, it } from 'vitest';
import type { Capability } from '@/config/capabilities';
import { queryVisibleSections } from '@/lib/content/queries';
import { Partner, SiteInfo } from '@/models';
import { getContentDashboard } from '@/services/dashboards/content';
import { makeDeveloper, makeMedia, makePartner, makePlan, makeService, makeShowcase, makeSiteInfo } from '@/test/content-factories';
import { setupTestDb } from '@/test/db';
import { makeAdmin, sessionFor } from '@/test/factories';

setupTestDb();

const viewer = async () => sessionFor(await makeAdmin());

describe('website content dashboard', () => {
  it('is for people who can edit content', async () => {
    const nobody = { ...(await viewer()), capabilities: new Set<Capability>(['dashboard:view']) as ReadonlySet<Capability> };
    await expect(getContentDashboard(nobody)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('is all zeros on an empty database: every home section hidden, nothing to attend to, nothing published', async () => {
    const d = await getContentDashboard(await viewer());
    expect(d.totals).toEqual({ published: 0, draft: 0, archived: 0, items: 0 });
    expect(d.types).toHaveLength(5);
    for (const t of d.types) expect(t).toMatchObject({ published: 0, showing: 0, draft: 0, archived: 0, total: 0, lastPublished: null });
    expect(d.hiddenSections.map((s) => s.key)).toEqual(['partners', 'projects', 'services', 'pricing', 'developers']);
    expect(d.sections.every((s) => !s.visible && s.published === 0)).toBe(true);
    expect(d.attention).toEqual([]);
    expect(d.attentionTotal).toBe(0);
    expect(d.siteInfo).toEqual({ updatedAt: null, hasContactDetails: false });
  });

  it('counts published, draft and archived per type from the records', async () => {
    await makeShowcase({ published: true });
    await makeShowcase({ published: true });
    await makeShowcase();
    await makeShowcase({ status: 'archived' });
    await makePartner({ published: true });
    await makePartner();
    await makePartner();
    await makeService({ status: 'archived' });
    await makePlan({ published: true });
    await makeDeveloper();

    const d = await getContentDashboard(await viewer());
    const by = Object.fromEntries(d.types.map((t) => [t.type, t]));
    expect(by.showcase).toMatchObject({ published: 2, draft: 1, archived: 1, total: 4, label: 'Showcase' });
    expect(by.partners).toMatchObject({ published: 1, draft: 2, archived: 0, total: 3 });
    expect(by.services).toMatchObject({ published: 0, draft: 0, archived: 1, total: 1 });
    expect(by.pricing).toMatchObject({ published: 1, total: 1 });
    expect(by.developers).toMatchObject({ published: 0, draft: 1, total: 1 });
    expect(d.totals).toEqual({ published: 4, draft: 4, archived: 2, items: 10 });
  });

  it('hides exactly the home sections with nothing published, and says why', async () => {
    await makeShowcase({ published: true });
    await makePartner(); // a draft does not count
    await makeService({ status: 'archived' }); // neither does an archived item
    const d = await getContentDashboard(await viewer());
    expect(d.sections.filter((s) => s.visible).map((s) => s.key)).toEqual(['projects']);
    expect(d.hiddenSections.map((s) => s.key)).toEqual(['partners', 'services', 'pricing', 'developers']);
    expect(d.hiddenSections[0]).toMatchObject({ key: 'partners', type: 'partners', reason: 'No published partners' });
  });

  it('counts a section as shown only when the PUBLIC site would show it, the same test the home page uses', async () => {
    // A row published and then stripped of its permission tick outside the service: the page hides it, so the dashboard must too.
    await makePartner({ published: true, permissionConfirmed: false });
    await makeService({ published: true });
    const d = await getContentDashboard(await viewer());
    expect(d.sections.find((s) => s.key === 'partners')).toMatchObject({ visible: false, published: 1, showing: 0 });
    expect(d.sections.find((s) => s.key === 'services')).toMatchObject({ visible: true, published: 1, showing: 1 });
    expect(d.hiddenSections.find((s) => s.key === 'partners')?.reason).toBe('1 published, but none can be shown: a permission tick or price is missing');
    expect(d.hiddenSections.find((s) => s.key === 'pricing')?.reason).toBe('No published pricing plans');

    const publicView = await queryVisibleSections();
    for (const s of d.sections) expect(publicView[s.key]).toBe(s.visible);
  });

  it('names the last published item per type, by publish date', async () => {
    const older = await makePartner({ name: 'Older' });
    const newer = await makePartner({ name: 'Newer' });
    await Partner.updateOne({ _id: older._id }, { $set: { status: 'published', publishedAt: new Date('2026-03-01T10:00:00Z') } });
    await Partner.updateOne({ _id: newer._id }, { $set: { status: 'published', publishedAt: new Date('2026-04-01T10:00:00Z') } });
    await makePartner({ name: 'Draft that was published once', publishedAt: new Date('2026-09-01T10:00:00Z') }); // a draft: ignored

    const d = await getContentDashboard(await viewer());
    expect(d.types.find((t) => t.type === 'partners')?.lastPublished).toEqual({ id: String(newer._id), title: 'Newer', publishedAt: '2026-04-01T10:00:00.000Z' });
    expect(d.types.find((t) => t.type === 'services')?.lastPublished).toBeNull();
  });

  it('lists drafts missing a permission tick, a price or an image, and nothing else', async () => {
    const image = await makeMedia();
    await makeShowcase({ title: 'No tick, no cover', clientApproved: false });
    await makeShowcase({ title: 'Ready', clientApproved: true, coverMediaId: image._id });
    await makeShowcase({ title: 'Live without cover', clientApproved: true, published: true }); // published: not a draft
    await makeShowcase({ title: 'Archived', clientApproved: false, status: 'archived' });
    await makePartner({ name: 'No permission, no logo', permissionConfirmed: false });
    await makePartner({ name: 'Only a logo missing', permissionConfirmed: true });
    await makeDeveloper({ displayName: 'No consent, no photo', consentConfirmed: false });
    await makePlan({ name: 'Unpriced', priceModel: 'per_month', amountMinor: undefined, currency: undefined });
    await makePlan({ name: 'Quote', priceModel: 'quote', amountMinor: undefined, currency: undefined });
    await makeService({ title: 'A service' });

    const d = await getContentDashboard(await viewer());
    const byTitle = Object.fromEntries(d.attention.map((a) => [a.title, a.problems]));
    expect(Object.keys(byTitle).sort()).toEqual(['No consent, no photo', 'No permission, no logo', 'No tick, no cover', 'Only a logo missing', 'Unpriced']);
    expect(byTitle['No tick, no cover']).toEqual([expect.stringMatching(/client has approved/i), 'No cover image']);
    expect(byTitle['No permission, no logo']).toEqual([expect.stringMatching(/permission/i), 'No logo']);
    expect(byTitle['Only a logo missing']).toEqual(['No logo']);
    expect(byTitle['No consent, no photo']).toEqual([expect.stringMatching(/agreed/i), 'No photo']);
    expect(byTitle['Unpriced']).toEqual([expect.stringMatching(/price/i), expect.stringMatching(/currency/i)]);
    expect(d.attentionTotal).toBe(5);
  });

  it('shows the first few and reports how many in all', async () => {
    for (let i = 0; i < 14; i++) await makePartner({ permissionConfirmed: false });
    const d = await getContentDashboard(await viewer());
    expect(d.attention).toHaveLength(12);
    expect(d.attentionTotal).toBe(14);
  });

  it('reports whether company contact details exist', async () => {
    await makeSiteInfo();
    expect((await getContentDashboard(await viewer())).siteInfo.hasContactDetails).toBe(false);
    await SiteInfo.updateOne({ _id: 'site' }, { $set: { phone: '+91 98765 43210' } });
    const d = await getContentDashboard(await viewer());
    expect(d.siteInfo.hasContactDetails).toBe(true);
    expect(d.siteInfo.updatedAt).toBeTruthy();
  });

  it('is plain JSON: no documents, no ObjectIds', async () => {
    await makePartner({ published: true });
    const d = await getContentDashboard(await viewer());
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  });
});
