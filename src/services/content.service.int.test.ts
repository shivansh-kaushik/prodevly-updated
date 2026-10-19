import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capability } from '@/config/capabilities';
import { AuditLog, DeveloperProfile, PricingPlan, ShowcaseItem } from '@/models';
import {
  archiveContent,
  createContent,
  getContent,
  listContent,
  publishContent,
  reorderContent,
  restoreContent,
  unpublishContent,
  updateContent,
} from '@/services/content.service';
import { setupTestDb } from '@/test/db';
import { makeClient, makeProject } from '@/test/domain-factories';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { makeMedia, makePartner, makePlan, makeService, makeShowcase } from '@/test/content-factories';

const cache = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: cache.revalidateTag, unstable_cache: <T,>(fn: T) => fn }));

setupTestDb();
beforeEach(() => cache.revalidateTag.mockClear());

const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; fields?: Record<string, string>; message?: string; status?: number };
  }
  throw new Error('expected the call to be rejected');
};

const editor = async () => sessionFor(await makeAdmin()); // content:edit only (the admin default)
const publisher = async () => sessionFor(await makeAdmin({ grants: ['content:publish'] }));
const superadmin = async () => sessionFor(await makeSuperadmin());
/** A viewer with NO content capability. No real role lacks content:edit, so the session is built by hand. */
const nobody = async () => ({ ...(await sessionFor(await makeAdmin())), capabilities: new Set<Capability>(['dashboard:view']) as ReadonlySet<Capability> });

const tagsRevalidated = () => cache.revalidateTag.mock.calls.map((c) => c[0] as string);

describe('capability matrix', () => {
  it('refuses everything to a viewer without content:edit, and writes nothing', async () => {
    const viewer = await nobody();
    const item = await makeShowcase();
    expect((await rejects(listContent(viewer, 'showcase'))).code).toBe('FORBIDDEN');
    expect((await rejects(getContent(viewer, 'showcase', String(item._id)))).code).toBe('FORBIDDEN');
    expect((await rejects(createContent(viewer, 'showcase', { title: 'Shop', summary: 'A shop' }))).code).toBe('FORBIDDEN');
    expect((await rejects(updateContent(viewer, 'showcase', String(item._id), { title: 'Renamed' }))).code).toBe('FORBIDDEN');
    expect((await rejects(reorderContent(viewer, 'showcase', [String(item._id)]))).code).toBe('FORBIDDEN');
    expect(await ShowcaseItem.countDocuments()).toBe(1);
    expect(await AuditLog.countDocuments()).toBe(0);
  });

  it('lets a plain admin (content:edit) draft and edit drafts, but not publish, unpublish, archive or restore', async () => {
    const ed = await editor();
    const draft = await createContent(ed, 'partners', { name: 'Acme', kind: 'agency', permissionConfirmed: true });
    expect(draft.status).toBe('draft');
    expect((await updateContent(ed, 'partners', draft.id, { name: 'Acme Ltd' })).title).toBe('Acme Ltd');

    for (const act of [publishContent, unpublishContent, archiveContent, restoreContent]) {
      expect((await rejects(act(ed, 'partners', draft.id))).code).toBe('FORBIDDEN');
    }
    expect((await getContent(ed, 'partners', draft.id)).status).toBe('draft');
    expect(await AuditLog.countDocuments({ action: /publish|archive|restore/ })).toBe(0);
    expect(cache.revalidateTag).not.toHaveBeenCalled();
  });

  it('lets someone with content:publish do all four', async () => {
    const pub = await publisher();
    const draft = await createContent(pub, 'partners', { name: 'Acme', kind: 'agency', permissionConfirmed: true });
    expect((await publishContent(pub, 'partners', draft.id)).status).toBe('published');
    expect((await unpublishContent(pub, 'partners', draft.id)).status).toBe('draft');
    expect((await archiveContent(pub, 'partners', draft.id)).status).toBe('archived');
    expect((await restoreContent(pub, 'partners', draft.id)).status).toBe('draft');
  });

  it('treats editing a record that is ALREADY PUBLISHED as publish-level: a plain editor is refused', async () => {
    const live = await makePartner({ published: true });
    const ed = await editor();
    expect((await rejects(updateContent(ed, 'partners', String(live._id), { name: 'Changed' }))).code).toBe('FORBIDDEN');
    expect((await getContent(ed, 'partners', String(live._id))).title).toBe(live.name);
    const pub = await publisher();
    expect((await updateContent(pub, 'partners', String(live._id), { name: 'Changed' })).title).toBe('Changed');
  });

  it('answers 404-shaped NOT_FOUND for a malformed or unknown id, never a cast error', async () => {
    const ed = await editor();
    expect((await rejects(getContent(ed, 'showcase', 'not-an-id'))).code).toBe('NOT_FOUND');
    expect((await rejects(getContent(ed, 'showcase', String(new Types.ObjectId())))).code).toBe('NOT_FOUND');
    expect((await rejects(updateContent(ed, 'showcase', String(new Types.ObjectId()), { title: 'Nope' }))).code).toBe('NOT_FOUND');
  });
});

describe('create', () => {
  it('stores a draft with a generated lowercase slug, the next order, who made it, and an audit entry', async () => {
    const ed = await editor();
    const a = await createContent(ed, 'showcase', { title: 'My Online Shop', summary: 'A shop for a florist' });
    const b = await createContent(ed, 'showcase', { title: 'Second Project', summary: 'Another' });
    expect(a).toMatchObject({ status: 'draft', slug: 'my-online-shop', order: 0, publishedAt: null, clientApproved: false });
    expect(b.order).toBe(1);

    const doc = await ShowcaseItem.findById(a.id).lean();
    expect(doc?.createdBy?.name).toBe(ed.name);
    expect(String(doc?.createdBy?.id)).toBe(ed.id);
    const entry = await AuditLog.findOne({ action: 'showcase.create', 'entity.label': 'My Online Shop' }).lean();
    expect(entry).toMatchObject({ entity: { type: 'showcase_item', label: 'My Online Shop' }, actor: { name: ed.name } });
  });

  it('makes slugs unique and lowercase: the same title again gets -2, then -3', async () => {
    const ed = await editor();
    const slugs = [];
    for (const title of ['Our Site', 'our site!', 'OUR SITE']) slugs.push((await createContent(ed, 'showcase', { title, summary: 'x yz' })).slug);
    expect(slugs).toEqual(['our-site', 'our-site-2', 'our-site-3']);
  });

  it('gives two people creating the same title at the same moment two different slugs', async () => {
    const [a, b] = await Promise.all([
      createContent(await editor(), 'services', { title: 'Web Apps', summary: 'We build web apps' }),
      createContent(await editor(), 'services', { title: 'Web Apps', summary: 'We build web apps' }),
    ]);
    expect(new Set([a.slug, b.slug]).size).toBe(2);
    expect([a.slug, b.slug].sort()).toEqual(['web-apps', 'web-apps-2']);
  });

  it('lets a slug follow the title while the item has never been published, then freezes it', async () => {
    const pub = await publisher();
    const draft = await createContent(pub, 'showcase', { title: 'Working Title', summary: 'A summary', clientApproved: true });
    expect((await updateContent(pub, 'showcase', draft.id, { title: 'Better Title' })).slug).toBe('better-title');
    const renamed = await AuditLog.findOne({ action: 'showcase.update' }).lean();
    expect(renamed?.changes.map((c) => c.path).sort()).toEqual(['slug', 'title']); // the generated slug is audited too
    await publishContent(pub, 'showcase', draft.id);
    expect((await updateContent(pub, 'showcase', draft.id, { title: 'Totally Different' })).slug).toBe('better-title');
    await unpublishContent(pub, 'showcase', draft.id);
    expect((await updateContent(pub, 'showcase', draft.id, { title: 'Yet Another' })).slug).toBe('better-title'); // still frozen: it was published once
  });

  it('keeps its own slug when renamed to a title that slugifies the same', async () => {
    const ed = await editor();
    const a = await createContent(ed, 'showcase', { title: 'Alpha', summary: 'x yz' });
    expect((await updateContent(ed, 'showcase', a.id, { title: 'ALPHA!' })).slug).toBe('alpha');
  });

  it('refuses a link to something that does not exist, and a private file as a website image, naming the field', async () => {
    const ed = await editor();
    const missing = String(new Types.ObjectId());
    expect((await rejects(createContent(ed, 'showcase', { title: 'Shop', summary: 'x yz', serviceIds: [missing] }))).fields).toHaveProperty('serviceIds');
    expect((await rejects(createContent(ed, 'showcase', { title: 'Shop', summary: 'x yz', coverMediaId: missing }))).fields).toHaveProperty('coverMediaId');
    expect((await rejects(createContent(ed, 'showcase', { title: 'Shop', summary: 'x yz', projectId: missing }))).fields).toHaveProperty('projectId');
    const receipt = await makeMedia({ visibility: 'private', purpose: 'expense' });
    expect((await rejects(createContent(ed, 'partners', { name: 'Acme', kind: 'agency', logoMediaId: String(receipt._id) }))).fields?.logoMediaId).toMatch(/website library/);
    expect((await rejects(createContent(ed, 'developers', { displayName: 'Dev', photoMediaId: String(receipt._id) }))).fields).toHaveProperty('photoMediaId');
    expect(await ShowcaseItem.countDocuments()).toBe(0);
  });

  it('accepts real links: a service, a public image, a project (for someone who can see projects)', async () => {
    const ed = await editor();
    const service = await makeService();
    const image = await makeMedia();
    const project = await makeProject(await makeClient());
    const item = await createContent(ed, 'showcase', {
      title: 'Shop', summary: 'x yz', serviceIds: [String(service._id)], coverMediaId: String(image._id), galleryMediaIds: [String(image._id)], projectId: String(project._id),
    });
    expect(item.services).toEqual([{ id: String(service._id), title: service.title }]);
    expect(item.coverMedia?.url).toBe(`/media/${image._id}/${image.filename}`);
    expect(item.projectLabel).toContain(project.name);
  });

  it('needs project:view to link an internal project, and does not show a project name to someone without it', async () => {
    const project = await makeProject(await makeClient());
    const limited = { ...(await editor()), capabilities: new Set<Capability>(['content:edit']) as ReadonlySet<Capability> };
    expect((await rejects(createContent(limited, 'showcase', { title: 'Shop', summary: 'x yz', projectId: String(project._id) }))).code).toBe('FORBIDDEN');

    const linked = await makeShowcase({ projectId: project._id });
    const seen = await getContent(limited, 'showcase', String(linked._id));
    expect(seen.projectId).toBe(String(project._id));
    expect(seen.projectLabel).toBeNull();
  });

  it('drops a stray amount from a quote plan, allows a draft price to be missing, and refuses a currency that is not enabled', async () => {
    const ed = await editor();
    const quote = await createContent(ed, 'pricing', { name: 'Custom', priceModel: 'quote', amountMinor: 500_000, currency: 'INR' });
    expect(quote).toMatchObject({ amountMinor: null, currency: null, priceModel: 'quote' });
    const unpriced = await createContent(ed, 'pricing', { name: 'Starter', priceModel: 'fixed_from' });
    expect(unpriced.blockers.length).toBeGreaterThan(0);
    expect((await rejects(createContent(ed, 'pricing', { name: 'Odd', priceModel: 'per_month', amountMinor: 100, currency: 'CHF' }))).fields).toHaveProperty('currency');
  });

  it('allows one profile per team member, and the member must exist', async () => {
    const sa = await superadmin();
    const person = await makeAdmin();
    await createContent(sa, 'developers', { displayName: 'Dev One', adminId: String(person._id) });
    expect((await rejects(createContent(sa, 'developers', { displayName: 'Dev Two', adminId: String(person._id) }))).fields).toHaveProperty('adminId');
    expect((await rejects(createContent(sa, 'developers', { displayName: 'Dev Three', adminId: String(new Types.ObjectId()) }))).fields).toHaveProperty('adminId');
    expect(await DeveloperProfile.countDocuments()).toBe(1);
  });

  it('is atomic: a failed create leaves no record and no audit entry', async () => {
    const ed = await editor();
    await rejects(createContent(ed, 'showcase', { title: 'Shop', summary: 'x yz', serviceIds: [String(new Types.ObjectId())] }));
    expect(await ShowcaseItem.countDocuments()).toBe(0);
    expect(await AuditLog.countDocuments()).toBe(0);
  });
});

describe('publish gates, enforced in the service', () => {
  it('a showcase item cannot be published until the client has approved it', async () => {
    const pub = await publisher();
    const item = await createContent(pub, 'showcase', { title: 'Shop', summary: 'x yz' });
    expect(item.blockers).toEqual([expect.stringMatching(/client has approved/i)]);
    const err = await rejects(publishContent(pub, 'showcase', item.id));
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields).toHaveProperty('clientApproved');
    expect(err.message).toMatch(/cannot be published/);
    expect((await getContent(pub, 'showcase', item.id)).status).toBe('draft');
    expect(await AuditLog.countDocuments({ action: 'showcase.publish' })).toBe(0);
    expect(cache.revalidateTag).not.toHaveBeenCalled();

    await updateContent(pub, 'showcase', item.id, { clientApproved: true });
    const live = await publishContent(pub, 'showcase', item.id);
    expect(live).toMatchObject({ status: 'published', blockers: [] });
    expect(live.publishedAt).toBeTruthy();
    expect(live.publishedBy).toBe(pub.name);
  });

  it('a partner cannot be published without permission', async () => {
    const pub = await publisher();
    const p = await createContent(pub, 'partners', { name: 'Acme', kind: 'client' });
    expect((await rejects(publishContent(pub, 'partners', p.id))).fields).toHaveProperty('permissionConfirmed');
    await updateContent(pub, 'partners', p.id, { permissionConfirmed: true });
    expect((await publishContent(pub, 'partners', p.id)).status).toBe('published');
  });

  it('a developer profile cannot be published without consent', async () => {
    const pub = await publisher();
    const d = await createContent(pub, 'developers', { displayName: 'Dev', bio: 'Builds things.' });
    expect((await rejects(publishContent(pub, 'developers', d.id))).fields).toHaveProperty('consentConfirmed');
    await updateContent(pub, 'developers', d.id, { consentConfirmed: true });
    expect((await publishContent(pub, 'developers', d.id)).status).toBe('published');
  });

  it('a developer bio of exactly 280 characters is fine; the model refuses 281', async () => {
    const pub = await publisher();
    const ok = await createContent(pub, 'developers', { displayName: 'Dev', bio: 'x'.repeat(280), consentConfirmed: true });
    expect((await publishContent(pub, 'developers', ok.id)).bio).toHaveLength(280);
    const err = await rejects(createContent(pub, 'developers', { displayName: 'Dev 2', bio: 'x'.repeat(281) }));
    expect(err).toMatchObject({ name: 'ValidationError' });
  });

  it('a priced plan needs an amount and currency; a quote plan needs neither', async () => {
    const pub = await publisher();
    const unpriced = await createContent(pub, 'pricing', { name: 'Starter', priceModel: 'per_month' });
    const err = await rejects(publishContent(pub, 'pricing', unpriced.id));
    expect(err.fields).toHaveProperty('amountMinor');
    expect(err.fields).toHaveProperty('currency');
    await updateContent(pub, 'pricing', unpriced.id, { amountMinor: 49_900, currency: 'INR' });
    expect((await publishContent(pub, 'pricing', unpriced.id)).status).toBe('published');

    const quote = await createContent(pub, 'pricing', { name: 'Custom', priceModel: 'quote' });
    expect((await publishContent(pub, 'pricing', quote.id)).status).toBe('published');
  });

  it('a service has no tick and publishes straight away', async () => {
    const pub = await publisher();
    const s = await createContent(pub, 'services', { title: 'Web apps', summary: 'We build web apps' });
    expect((await publishContent(pub, 'services', s.id)).status).toBe('published');
  });

  it('holds a PUBLISHED record to the same gate: a live item cannot be edited into one that could not be published', async () => {
    const pub = await publisher();
    const live = await makeShowcase({ published: true });
    const err = await rejects(updateContent(pub, 'showcase', String(live._id), { clientApproved: false }));
    expect(err.code).toBe('VALIDATION_FAILED');
    expect((await ShowcaseItem.findById(live._id).lean())?.clientApproved).toBe(true);

    const plan = await makePlan({ published: true });
    expect((await rejects(updateContent(pub, 'pricing', String(plan._id), { priceModel: 'per_hour', amountMinor: null }))).fields).toHaveProperty('amountMinor');
    // switching a live plan to a quote is fine, and clears its number
    expect(await updateContent(pub, 'pricing', String(plan._id), { priceModel: 'quote' })).toMatchObject({ amountMinor: null, currency: null });
  });

  it('refuses to publish something archived or already published', async () => {
    const pub = await publisher();
    const live = await makePartner({ published: true });
    expect((await rejects(publishContent(pub, 'partners', String(live._id)))).code).toBe('CONFLICT');
    const archived = await makePartner({ status: 'archived' });
    expect((await rejects(publishContent(pub, 'partners', String(archived._id)))).message).toMatch(/Restore/);
  });
});

describe('only one published plan may be highlighted', () => {
  it('refuses a second highlighted plan, names the first, and succeeds once the first is un-highlighted', async () => {
    const pub = await publisher();
    const a = await makePlan({ name: 'Growth', highlighted: true, published: true });
    const b = await makePlan({ name: 'Scale', highlighted: true });

    const err = await rejects(publishContent(pub, 'pricing', String(b._id)));
    expect(err.fields?.highlighted).toMatch(/Growth/);
    expect((await PricingPlan.findById(b._id).lean())?.status).toBe('draft');

    await updateContent(pub, 'pricing', String(a._id), { highlighted: false });
    expect((await publishContent(pub, 'pricing', String(b._id))).highlighted).toBe(true);
    expect(await PricingPlan.countDocuments({ status: 'published', highlighted: true })).toBe(1);
  });

  it('allows several highlighted DRAFTS, and refuses highlighting a published plan while another is highlighted', async () => {
    const pub = await publisher();
    await makePlan({ highlighted: true, published: true });
    await makePlan({ highlighted: true }); // a draft: fine
    const other = await makePlan({ published: true });
    expect((await rejects(updateContent(pub, 'pricing', String(other._id), { highlighted: true }))).fields).toHaveProperty('highlighted');
  });

  it('frees the highlight when the highlighted plan is unpublished or archived', async () => {
    const pub = await publisher();
    const a = await makePlan({ highlighted: true, published: true });
    const b = await makePlan({ highlighted: true });
    await unpublishContent(pub, 'pricing', String(a._id));
    expect((await publishContent(pub, 'pricing', String(b._id))).status).toBe('published');
    await archiveContent(pub, 'pricing', String(b._id));
    expect((await publishContent(pub, 'pricing', String(a._id))).status).toBe('published'); // b's highlight went with it
  });

  it('holds even when two editors publish two highlighted plans at the same moment', async () => {
    const a = await makePlan({ highlighted: true });
    const b = await makePlan({ highlighted: true });
    const results = await Promise.allSettled([
      publishContent(await publisher(), 'pricing', String(a._id)),
      publishContent(await publisher(), 'pricing', String(b._id)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await PricingPlan.countDocuments({ status: 'published', highlighted: true })).toBe(1);
  });

  it('is backed by a unique partial index, so even a direct write cannot break it', async () => {
    await makePlan({ highlighted: true, published: true });
    await expect(makePlan({ highlighted: true, published: true })).rejects.toMatchObject({ code: 11000 });
  });
});

describe('status moves', () => {
  it('goes draft, published, draft (unpublish keeps the last publish date), archived, draft', async () => {
    const pub = await publisher();
    const item = await createContent(pub, 'services', { title: 'Web apps', summary: 'We build web apps' });
    const live = await publishContent(pub, 'services', item.id);
    const down = await unpublishContent(pub, 'services', item.id);
    expect(down.status).toBe('draft');
    expect(down.publishedAt).toBe(live.publishedAt);
    expect((await archiveContent(pub, 'services', item.id)).status).toBe('archived');
    expect((await restoreContent(pub, 'services', item.id)).status).toBe('draft');
    expect((await AuditLog.find({ 'entity.type': 'service' }).sort({ at: 1 }).lean()).map((a) => a.action)).toEqual([
      'service.create', 'service.publish', 'service.unpublish', 'service.archive', 'service.restore',
    ]);
  });

  it('records each move in the audit log with the before and after status, in the same transaction', async () => {
    const pub = await publisher();
    const item = await makePartner();
    await publishContent(pub, 'partners', String(item._id));
    const entry = await AuditLog.findOne({ action: 'partner.publish' }).lean();
    expect(entry?.changes).toEqual([{ path: 'status', before: 'draft', after: 'published' }]);
    expect(entry?.entity).toMatchObject({ type: 'partner', label: item.name });
    expect(entry?.actor.name).toBe(pub.name);
  });

  it('archived records are read-only until restored', async () => {
    const pub = await publisher();
    const archived = await makePartner({ status: 'archived' });
    const err = await rejects(updateContent(pub, 'partners', String(archived._id), { name: 'Nope' }));
    expect(err.code).toBe('CONFLICT');
    expect(err.message).toMatch(/Restore/);
  });

  it('refuses a move the record cannot make (unpublishing a draft, restoring a draft)', async () => {
    const pub = await publisher();
    const draft = await makePartner();
    expect((await rejects(unpublishContent(pub, 'partners', String(draft._id)))).code).toBe('CONFLICT');
    expect((await rejects(restoreContent(pub, 'partners', String(draft._id)))).code).toBe('CONFLICT');
    const gone = await makePartner({ status: 'archived' });
    expect((await rejects(archiveContent(pub, 'partners', String(gone._id)))).code).toBe('CONFLICT');
  });

  it('never deletes: archive keeps the record', async () => {
    const pub = await publisher();
    const item = await makeShowcase({ published: true });
    await archiveContent(pub, 'showcase', String(item._id));
    expect(await ShowcaseItem.countDocuments({ _id: item._id })).toBe(1);
  });
});

describe('cache invalidation', () => {
  it('revalidates the type tag after a publish, and also showcase when a service changes', async () => {
    const pub = await publisher();
    await publishContent(pub, 'partners', String((await makePartner())._id));
    expect(tagsRevalidated()).toEqual(['content:partners']);
    expect(cache.revalidateTag).toHaveBeenLastCalledWith('content:partners', 'max');

    cache.revalidateTag.mockClear();
    await publishContent(pub, 'services', String((await makeService())._id));
    expect(tagsRevalidated().sort()).toEqual(['content:services', 'content:showcase']);
  });

  it('expires at once, not stale-while-revalidate, when something is taken DOWN', async () => {
    const pub = await publisher();
    const live = await makePartner({ published: true });
    await unpublishContent(pub, 'partners', String(live._id));
    expect(cache.revalidateTag).toHaveBeenCalledWith('content:partners', { expire: 0 });

    cache.revalidateTag.mockClear();
    const live2 = await makePartner({ published: true });
    await archiveContent(pub, 'partners', String(live2._id));
    expect(cache.revalidateTag).toHaveBeenCalledWith('content:partners', { expire: 0 });
  });

  it('does not revalidate for changes the public cannot see (a draft edit, archiving a draft) and not for a refused write', async () => {
    const pub = await publisher();
    const draft = await makePartner();
    await updateContent(pub, 'partners', String(draft._id), { name: 'Draft rename' });
    await archiveContent(pub, 'partners', String(draft._id));
    await rejects(publishContent(await editor(), 'partners', String(draft._id)));
    expect(cache.revalidateTag).not.toHaveBeenCalled();
  });

  it('revalidates when a PUBLISHED record is edited', async () => {
    const pub = await publisher();
    const live = await makePartner({ published: true });
    await updateContent(pub, 'partners', String(live._id), { name: 'Renamed' });
    expect(tagsRevalidated()).toEqual(['content:partners']);
  });

  it('does not fail a write that has already committed if invalidation throws', async () => {
    cache.revalidateTag.mockImplementationOnce(() => {
      throw new Error('no request scope');
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pub = await publisher();
    const item = await makePartner();
    expect((await publishContent(pub, 'partners', String(item._id))).status).toBe('published');
    spy.mockRestore();
  });
});

describe('update', () => {
  it('audits only what changed, with before and after, and clips long text', async () => {
    const ed = await editor();
    const item = await createContent(ed, 'showcase', { title: 'Shop', summary: 'x yz' });
    await updateContent(ed, 'showcase', item.id, { summary: 'A new summary', body: { brief: 'b'.repeat(900) } });
    const entry = await AuditLog.findOne({ action: 'showcase.update' }).lean();
    const paths = entry?.changes.map((c) => c.path).sort();
    expect(paths).toEqual(['body', 'summary']);
    const summary = entry?.changes.find((c) => c.path === 'summary');
    expect(summary).toMatchObject({ before: 'x yz', after: 'A new summary' });
    const body = entry?.changes.find((c) => c.path === 'body');
    expect(JSON.stringify(body?.after).length).toBeLessThan(900);
  });

  it('writes nothing, and no audit entry, when nothing changed', async () => {
    const ed = await editor();
    const item = await createContent(ed, 'services', { title: 'Web apps', summary: 'We build web apps' });
    const before = await AuditLog.countDocuments();
    const again = await updateContent(ed, 'services', item.id, { title: 'Web apps', summary: 'We build web apps' });
    expect(again.updatedAt).toBe(item.updatedAt);
    expect(await AuditLog.countDocuments()).toBe(before);
  });

  it('clears an optional field with null and leaves fields that were not sent', async () => {
    const ed = await editor();
    const image = await makeMedia();
    const item = await createContent(ed, 'showcase', { title: 'Shop', summary: 'x yz', coverMediaId: String(image._id), liveUrl: 'https://shop.example.com', stack: ['React'] });
    const after = await updateContent(ed, 'showcase', item.id, { coverMediaId: null, liveUrl: null });
    expect(after).toMatchObject({ coverMedia: null, liveUrl: null, stack: ['React'], title: 'Shop' });
  });

  it('updates nested fields one at a time (developer links)', async () => {
    const ed = await editor();
    const dev = await createContent(ed, 'developers', { displayName: 'Dev', links: { github: 'https://github.com/dev', linkedin: 'https://linkedin.com/in/dev' } });
    const after = await updateContent(ed, 'developers', dev.id, { links: { github: null } });
    expect(after.links).toEqual({ github: null, linkedin: 'https://linkedin.com/in/dev', website: null });
  });

  it('is atomic: a refused update changes nothing and audits nothing', async () => {
    const ed = await editor();
    const item = await createContent(ed, 'showcase', { title: 'Shop', summary: 'x yz' });
    const before = await AuditLog.countDocuments();
    await rejects(updateContent(ed, 'showcase', item.id, { title: 'Changed', serviceIds: [String(new Types.ObjectId())] }));
    expect((await getContent(ed, 'showcase', item.id)).title).toBe('Shop');
    expect(await AuditLog.countDocuments()).toBe(before);
  });
});

describe('reorder', () => {
  it('sets the display order and keeps archived items in their place around it', async () => {
    const ed = await editor();
    const [a, b, c] = [await makePartner({ order: 10 }), await makePartner({ order: 20 }), await makePartner({ order: 30 })];
    const archived = await makePartner({ order: 25, status: 'archived' });
    const ids = [c, a, b].map((x) => String(x._id));
    expect(await reorderContent(ed, 'partners', ids)).toEqual({ moved: 3 });
    const list = await listContent(ed, 'partners', { statuses: ['draft', 'published'] });
    expect(list.map((x) => x.id)).toEqual(ids);
    expect(list.map((x) => x.order)).toEqual([10, 20, 30]); // the same slots, traded
    expect((await getContent(await superadmin(), 'partners', String(archived._id))).order).toBe(25);
    const entry = await AuditLog.findOne({ action: 'partner.reorder' }).lean();
    expect(entry?.changes[0]).toMatchObject({ path: 'order', after: ids });
  });

  it('renumbers items that tie on order instead of silently doing nothing', async () => {
    const ed = await editor();
    const [a, b] = [await makePartner({ order: 0 }), await makePartner({ order: 0 })];
    await reorderContent(ed, 'partners', [String(b._id), String(a._id)]);
    expect((await listContent(ed, 'partners')).map((x) => x.id)).toEqual([String(b._id), String(a._id)]);
  });

  it('is a no-op (no write, no audit) when the order is unchanged', async () => {
    const ed = await editor();
    const [a, b] = [await makePartner(), await makePartner()];
    expect(await reorderContent(ed, 'partners', [String(a._id), String(b._id)])).toEqual({ moved: 0 });
    expect(await AuditLog.countDocuments({ action: 'partner.reorder' })).toBe(0);
  });

  it('lets an editor reorder drafts but needs publish authority to move PUBLISHED items', async () => {
    const [live, draft] = [await makePartner({ published: true }), await makePartner()];
    const ed = await editor();
    const swapped = [String(draft._id), String(live._id)];
    expect((await rejects(reorderContent(ed, 'partners', swapped))).code).toBe('FORBIDDEN');
    expect((await listContent(ed, 'partners')).map((x) => x.id)).toEqual([String(live._id), String(draft._id)]);
    expect(cache.revalidateTag).not.toHaveBeenCalled();

    expect(await reorderContent(await publisher(), 'partners', swapped)).toEqual({ moved: 2 });
    expect(tagsRevalidated()).toEqual(['content:partners']);

    const [d1, d2] = [await makePartner(), await makePartner()];
    expect((await reorderContent(ed, 'partners', [String(d2._id), String(d1._id)])).moved).toBe(2);
  });

  it('rejects an unknown id and a repeated id, changing nothing', async () => {
    const ed = await editor();
    const a = await makePartner();
    expect((await rejects(reorderContent(ed, 'partners', [String(a._id), String(new Types.ObjectId())]))).code).toBe('NOT_FOUND');
    expect((await rejects(reorderContent(ed, 'partners', [String(a._id), String(a._id)]))).code).toBe('VALIDATION_FAILED');
    expect((await rejects(reorderContent(ed, 'partners', ['nope']))).code).toBe('NOT_FOUND');
  });

  it('only reorders within its own type: a showcase id is not a partner', async () => {
    const ed = await editor();
    const item = await makeShowcase();
    expect((await rejects(reorderContent(ed, 'partners', [String(item._id)]))).code).toBe('NOT_FOUND');
  });
});

describe('list', () => {
  it('returns records in display order, filtered by status, with blockers only on what is not live', async () => {
    const ed = await editor();
    await makePartner({ order: 2, name: 'Second' });
    await makePartner({ order: 1, name: 'First', permissionConfirmed: false });
    await makePartner({ order: 3, name: 'Live', published: true });
    await makePartner({ order: 4, name: 'Gone', status: 'archived', permissionConfirmed: false });
    const all = await listContent(ed, 'partners');
    expect(all.map((x) => x.title)).toEqual(['First', 'Second', 'Live', 'Gone']);
    expect(all.find((x) => x.title === 'First')?.blockers).toHaveLength(1);
    expect(all.find((x) => x.title === 'Live')?.blockers).toEqual([]);
    expect(all.find((x) => x.title === 'Gone')?.blockers).toEqual([]); // an archived record is not "waiting" for anything
    expect((await listContent(ed, 'partners', { statuses: ['published'] })).map((x) => x.title)).toEqual(['Live']);
    expect((await listContent(ed, 'partners', { statuses: ['draft', 'published'] })).map((x) => x.title)).toEqual(['First', 'Second', 'Live']);
  });

  it('searches text literally: regex characters are not interpreted', async () => {
    const ed = await editor();
    await makePartner({ name: 'Acme (UK) Ltd' });
    await makePartner({ name: 'Acme US' });
    expect((await listContent(ed, 'partners', { q: '(UK)' })).map((x) => x.title)).toEqual(['Acme (UK) Ltd']);
    expect(await listContent(ed, 'partners', { q: '.*' })).toEqual([]);
    expect((await listContent(ed, 'partners', { q: '(' })).map((x) => x.title)).toEqual(['Acme (UK) Ltd']); // a literal bracket, not a regex group
    expect((await listContent(ed, 'partners', { q: 'acme' })).length).toBe(2);
  });

  it('never returns Mongoose documents or internal ids: DTOs are plain JSON', async () => {
    const ed = await editor();
    await makeShowcase();
    const [item] = await listContent(ed, 'showcase');
    expect(() => JSON.stringify(item)).not.toThrow();
    expect(typeof item?.id).toBe('string');
    expect(JSON.parse(JSON.stringify(item))).toEqual(item);
    expect(item).not.toHaveProperty('_id');
    expect(item).not.toHaveProperty('__v');
  });
});
