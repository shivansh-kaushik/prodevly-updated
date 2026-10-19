import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capability } from '@/config/capabilities';
import { AuditLog, SiteInfo } from '@/models';
import { getSiteInfo, updateSiteInfo } from '@/services/site-info.service';
import { makeSiteInfo } from '@/test/content-factories';
import { setupTestDb } from '@/test/db';
import { makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';

const cache = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: cache.revalidateTag, unstable_cache: <T,>(fn: T) => fn }));

setupTestDb();
beforeEach(() => cache.revalidateTag.mockClear());

const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string };
  }
  throw new Error('expected the call to be rejected');
};
const editor = async () => sessionFor(await makeAdmin());
const publisher = async () => sessionFor(await makeAdmin({ grants: ['content:publish'] }));

const FULL = {
  displayName: 'ProDevly',
  legalName: 'ProDevly Private Limited',
  email: 'hello@example.com',
  phone: '+91 98765 43210',
  whatsapp: '+91 98765 43210',
  address: '12 Main Road, Pune',
  social: { linkedin: 'https://linkedin.com/company/x', github: null, x: null, instagram: null, dribbble: null, behance: null },
  footerNote: 'Built by hand.',
};

describe('company info', () => {
  it('reads as an empty record before anything is saved: only the brand name, nothing invented', async () => {
    const info = await getSiteInfo(await editor());
    expect(info).toEqual({
      legalName: null, displayName: 'ProDevly', email: null, phone: null, whatsapp: null, address: null,
      social: { linkedin: null, github: null, x: null, instagram: null, dribbble: null, behance: null },
      footerNote: null, updatedAt: null,
    });
  });

  it('can be read by content:edit and no one without it', async () => {
    const nobody = { ...(await editor()), capabilities: new Set<Capability>(['dashboard:view']) as ReadonlySet<Capability> };
    expect((await rejects(getSiteInfo(nobody))).code).toBe('FORBIDDEN');
  });

  it('has no draft state, so saving it is publish-level: an editor is refused and nothing is written', async () => {
    expect((await rejects(updateSiteInfo(await editor(), FULL))).code).toBe('FORBIDDEN');
    expect(await SiteInfo.countDocuments()).toBe(0);
    expect(await AuditLog.countDocuments()).toBe(0);
    expect(cache.revalidateTag).not.toHaveBeenCalled();
  });

  it('is saved by someone with content:publish, creating the single record', async () => {
    const saved = await updateSiteInfo(await publisher(), FULL);
    expect(saved).toMatchObject({ legalName: 'ProDevly Private Limited', email: 'hello@example.com', social: { linkedin: 'https://linkedin.com/company/x', github: null } });
    expect(saved.updatedAt).toBeTruthy();
    expect(await SiteInfo.countDocuments()).toBe(1);
    expect((await SiteInfo.findById('site').lean())?._id).toBe('site');
  });

  it('replaces the whole record: whatever the request leaves out is cleared', async () => {
    const pub = await publisher();
    await updateSiteInfo(pub, FULL);
    const after = await updateSiteInfo(pub, { displayName: 'ProDevly', email: 'new@example.com' });
    expect(after).toMatchObject({ email: 'new@example.com', phone: null, address: null, legalName: null, footerNote: null });
    const raw = await SiteInfo.findById('site').lean();
    expect(raw).not.toHaveProperty('phone');
    expect(raw?.social?.linkedin).toBeUndefined();
  });

  it('updates a record the seed created with only the display name', async () => {
    await makeSiteInfo();
    const after = await updateSiteInfo(await publisher(), { displayName: 'ProDevly', phone: '+91 11 2222 3333' });
    expect(after.phone).toBe('+91 11 2222 3333');
    expect(await SiteInfo.countDocuments()).toBe(1);
  });

  it('audits what changed, and nothing when nothing did', async () => {
    const pub = await publisher();
    await updateSiteInfo(pub, FULL);
    await updateSiteInfo(pub, { ...FULL, phone: '+91 11 2222 3333' });
    const changes = (await AuditLog.find({ action: 'site_info.update' }).sort({ at: 1 }).lean()).map((a) => a.changes.map((c) => c.path));
    expect(changes[1]).toEqual(['phone']);
    const before = await AuditLog.countDocuments();
    await updateSiteInfo(pub, { ...FULL, phone: '+91 11 2222 3333' });
    expect(await AuditLog.countDocuments()).toBe(before);
    expect(await AuditLog.findOne({ action: 'site_info.update' }).lean()).toMatchObject({ entity: { type: 'site_info', label: 'Company info' } });
  });

  it('expires the site cache at once after a save', async () => {
    await updateSiteInfo(await (async () => sessionFor(await makeSuperadmin()))(), FULL);
    expect(cache.revalidateTag).toHaveBeenCalledWith('content:site', { expire: 0 });
  });
});
