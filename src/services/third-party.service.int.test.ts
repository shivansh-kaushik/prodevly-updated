import { describe, expect, it } from 'vitest';
import { AuditLog, ThirdParty, ThirdPartyPayout, WorkOrder } from '@/models';
import {
  archiveThirdParty,
  createThirdParty,
  getThirdParty,
  getThirdPartyOption,
  restoreThirdParty,
  searchThirdParties,
  updateThirdParty,
} from '@/services/third-party.service';
import { setupTestDb } from '@/test/db';
import { makeClient, makeProject } from '@/test/domain-factories';
import { makeAdmin, sessionFor } from '@/test/factories';
import { makeOrder, makeParty, makePayout, makeWorld, rejects, viewerHolding } from '@/test/third-party-factories';
import { setSettings } from '@/test/settings-factories';

setupTestDb();

const NOTE = 'HDFC 5010-0099-1234 IFSC HDFC0001234 UPI studio@okhdfc';
const id = (d: { _id: unknown }) => String(d._id);

describe('capabilities', () => {
  it('lets only thirdParty:edit write, and writes nothing for anyone else', async () => {
    const w = await makeWorld();
    for (const attempt of [
      () => createThirdParty(w.plain, { name: 'Nope Studio', type: 'freelancer' }),
      () => updateThirdParty(w.plain, id(w.party), { name: 'Renamed' }),
      () => archiveThirdParty(w.plain, id(w.party)),
      () => restoreThirdParty(w.plain, id(w.party)),
    ]) {
      expect((await rejects(attempt())).code).toBe('FORBIDDEN');
    }
    expect(await ThirdParty.countDocuments({})).toBe(1);
    expect((await ThirdParty.findById(w.party._id).lean())?.name).toBe(w.party.name);
    expect(await AuditLog.countDocuments({})).toBe(0);
  });

  it('lets only thirdParty:view read, even the option lookup', async () => {
    const w = await makeWorld();
    const blind = viewerHolding(w.sa, 'dashboard:view');
    expect((await rejects(searchThirdParties(blind))).code).toBe('FORBIDDEN');
    expect((await rejects(getThirdParty(blind, id(w.party)))).code).toBe('FORBIDDEN');
    expect((await rejects(getThirdPartyOption(blind, id(w.party)))).code).toBe('FORBIDDEN');
    // every plain admin reads the directory (plan section 1)
    expect((await searchThirdParties(w.plain)).items).toHaveLength(1);
  });
});

describe('create and update', () => {
  it('creates with a reference, the actor and an audit entry', async () => {
    const w = await makeWorld();
    const dto = await createThirdParty(w.recorder, { name: '  Pixel Forge  ', type: 'agency', skills: ['react', 'react', 'node'], email: 'Hello@Pixel.Example', country: 'in', defaultCurrency: 'usd', gstin: '27aaaaa0000a1z5' });
    expect(dto).toMatchObject({ ref: 'TP-0002', name: 'Pixel Forge', type: 'agency', skills: ['react', 'node'], email: 'hello@pixel.example', country: 'IN', defaultCurrency: 'USD', gstin: '27AAAAA0000A1Z5', status: 'active', createdBy: w.recorder.name });
    const entry = await AuditLog.findOne({ action: 'thirdParty.create' }).lean();
    expect(entry).toMatchObject({ actor: { name: w.recorder.name }, entity: { type: 'thirdParty', ref: 'TP-0002' } });
  });

  it('only accepts a type that is switched on in Settings, and rejects bad input with field messages', async () => {
    const w = await makeWorld();
    expect((await rejects(createThirdParty(w.sa, { name: 'Odd One', type: 'wizard' }))).fields?.type).toMatch(/Settings/);
    await setSettings({ thirdPartyTypes: ['studio'] });
    expect((await createThirdParty(w.sa, { name: 'Studio One', type: 'studio' })).type).toBe('studio');
    expect((await rejects(createThirdParty(w.sa, { name: 'x', type: 'studio' }))).fields?.name).toBeDefined();
    expect((await rejects(createThirdParty(w.sa, { name: 'Valid Name', type: 'studio', email: 'nope' }))).fields?.email).toBeDefined();
    expect((await rejects(createThirdParty(w.sa, { name: 'Valid Name', type: 'studio', gstin: 'short' }))).fields?.gstin).toBeDefined();
    expect((await rejects(createThirdParty(w.sa, { name: 'Valid Name', type: 'studio', ref: 'TP-9999' } as never))).code).toBe('VALIDATION_FAILED');
    expect((await ThirdParty.find({}).lean()).map((t) => t.name)).toEqual([w.party.name, 'Studio One']);
  });

  it('updates fields, clears optional ones with null, and an unchanged save writes nothing', async () => {
    const w = await makeWorld();
    const dto = await createThirdParty(w.sa, { name: 'Pixel Forge', type: 'agency', phone: '+91 99999 11111', notes: 'Fast' });
    const changed = await updateThirdParty(w.recorder, dto.id, { name: 'Pixel Forge Studio', phone: null, skills: ['design'], status: 'inactive' });
    expect(changed).toMatchObject({ name: 'Pixel Forge Studio', phone: null, skills: ['design'], status: 'inactive' });
    expect((await ThirdParty.findById(dto.id).lean())?.nameLower).toBe('pixel forge studio');
    const entry = await AuditLog.findOne({ action: 'thirdParty.update' }).lean();
    expect(entry?.changes.map((c) => c.path).sort()).toEqual(['name', 'phone', 'skills', 'status']);

    const before = await AuditLog.countDocuments({});
    await updateThirdParty(w.recorder, dto.id, { name: 'Pixel Forge Studio', skills: ['design'] });
    expect(await AuditLog.countDocuments({})).toBe(before);
    expect((await rejects(updateThirdParty(w.recorder, dto.id, {}))).code).toBe('VALIDATION_FAILED');
    expect((await rejects(updateThirdParty(w.recorder, 'nope', { name: 'Whatever' }))).code).toBe('NOT_FOUND');
  });
});

describe('the payment note never leaks', () => {
  it('is written and read only with thirdParty:payDetails', async () => {
    const w = await makeWorld();
    // thirdParty:edit alone cannot write it, create or update
    expect((await rejects(createThirdParty(w.recorder, { name: 'Sneaky Studio', type: 'freelancer', paymentNote: NOTE }))).code).toBe('FORBIDDEN');
    expect(await ThirdParty.countDocuments({ nameLower: 'sneaky studio' })).toBe(0);
    const dto = await createThirdParty(w.sa, { name: 'Pixel Forge', type: 'agency', paymentNote: NOTE });
    expect((await rejects(updateThirdParty(w.recorder, dto.id, { paymentNote: 'Changed' }))).code).toBe('FORBIDDEN');
    expect((await rejects(updateThirdParty(w.recorder, dto.id, { paymentNote: null }))).code).toBe('FORBIDDEN'); // clearing is the same privilege
    expect((await ThirdParty.findById(dto.id).select('+paymentNote').lean())?.paymentNote).toBe(NOTE);

    // the superadmin sees it on the detail, the recorder does not
    expect((await getThirdParty(w.sa, dto.id)).payDetails).toEqual({ note: NOTE });
    expect((await getThirdParty(w.recorder, dto.id)).payDetails).toBeNull();
    // the dto the superadmin gets back from create already carries it; the recorder's never does
    expect(dto.payDetails).toEqual({ note: NOTE });
  });

  it('never appears in a list, a recorder-visible DTO, the audit log or a default query', async () => {
    const w = await makeWorld();
    const dto = await createThirdParty(w.sa, { name: 'Pixel Forge', type: 'agency', paymentNote: NOTE });
    await updateThirdParty(w.sa, dto.id, { paymentNote: `${NOTE} v2` });
    await updateThirdParty(w.sa, dto.id, { notes: 'unrelated edit' });

    for (const viewer of [w.sa, w.recorder, w.plain]) {
      const list = await searchThirdParties(viewer);
      expect(JSON.stringify(list)).not.toContain('HDFC');
      expect(JSON.stringify(list)).not.toContain('paymentNote');
    }
    const asRecorder = await getThirdParty(w.recorder, dto.id);
    expect(JSON.stringify(asRecorder)).not.toContain('HDFC');
    expect(JSON.stringify(asRecorder)).not.toContain('paymentNote');

    const log = await AuditLog.find({}).lean();
    expect(JSON.stringify(log)).not.toContain('HDFC');
    expect(JSON.stringify(log)).not.toContain('studio@okhdfc');
    const edit = log.find((e) => e.action === 'thirdParty.update' && e.changes.some((c) => c.path === 'paymentNote'));
    expect(edit?.changes.find((c) => c.path === 'paymentNote')).toMatchObject({ before: '[redacted]', after: '[redacted]' });

    expect((await ThirdParty.findById(dto.id).lean())?.paymentNote).toBeUndefined();
    expect((await ThirdParty.find({}).lean()).every((t) => t.paymentNote === undefined)).toBe(true);
  });

  it('can be cleared by a superadmin with an empty string or null', async () => {
    const w = await makeWorld();
    const dto = await createThirdParty(w.sa, { name: 'Pixel Forge', type: 'agency', paymentNote: NOTE });
    expect((await updateThirdParty(w.sa, dto.id, { paymentNote: '' })).payDetails).toEqual({ note: null });
    expect((await ThirdParty.findById(dto.id).select('+paymentNote').lean())?.paymentNote).toBeUndefined();
  });
});

describe('archive and restore', () => {
  it('archives, hides from the default list, and restores', async () => {
    const w = await makeWorld();
    const archived = await archiveThirdParty(w.recorder, id(w.party));
    expect(archived.archived).toBe(true);
    expect((await searchThirdParties(w.plain)).items).toHaveLength(0);
    expect((await searchThirdParties(w.plain, { archived: 'include' })).items).toHaveLength(1);
    expect((await searchThirdParties(w.plain, { archived: 'only' })).items).toHaveLength(1);
    expect((await rejects(archiveThirdParty(w.recorder, id(w.party)))).code).toBe('CONFLICT');
    expect((await rejects(updateThirdParty(w.recorder, id(w.party), { name: 'Renamed' }))).code).toBe('CONFLICT');

    expect((await restoreThirdParty(w.recorder, id(w.party))).archived).toBe(false);
    expect((await rejects(restoreThirdParty(w.recorder, id(w.party)))).code).toBe('CONFLICT');
    expect((await AuditLog.find({ 'entity.type': 'thirdParty' }).lean()).map((e) => e.action)).toEqual(expect.arrayContaining(['thirdParty.archive', 'thirdParty.restore']));
  });

  it('refuses to archive while open work orders or due payouts refer to it', async () => {
    const w = await makeWorld();
    const order = await makeOrder(w.party, w.project);
    expect((await rejects(archiveThirdParty(w.sa, id(w.party)))).message).toMatch(/open work order/);
    await makeOrder(w.party, w.project, { status: 'delivered' });
    expect((await rejects(archiveThirdParty(w.sa, id(w.party)))).message).toMatch(/2 open work orders/);
    // closed or cancelled ones no longer block; a due payout does
    await WorkOrder.updateMany({}, { $set: { status: 'closed' } });
    await makePayout(w.party, w.project, { order });
    expect((await rejects(archiveThirdParty(w.sa, id(w.party)))).message).toMatch(/still due/);
    await ThirdPartyPayout.updateMany({}, { $set: { status: 'paid', paidOn: new Date() } });
    expect((await archiveThirdParty(w.sa, id(w.party))).archived).toBe(true);
  });
});

describe('search', () => {
  it('matches text literally, filters by type and status, sorts and pages', async () => {
    const w = await makeWorld();
    await makeParty({ name: 'Alpha (Pty) Ltd', type: 'agency' });
    await makeParty({ name: 'Beta.Works', type: 'vendor' });
    await makeParty({ name: 'Gamma', type: 'agency', status: 'inactive' });
    expect((await searchThirdParties(w.plain)).meta.total).toBe(4);
    expect((await searchThirdParties(w.plain, { q: '.*' })).items).toHaveLength(0); // a regex is not interpreted
    expect((await searchThirdParties(w.plain, { q: '(pty)' })).items.map((i) => i.name)).toEqual(['Alpha (Pty) Ltd']);
    expect((await searchThirdParties(w.plain, { q: 'beta.works' })).items).toHaveLength(1);
    expect((await searchThirdParties(w.plain, { type: 'agency' })).items.map((i) => i.name)).toEqual(['Alpha (Pty) Ltd', 'Gamma']);
    expect((await searchThirdParties(w.plain, { status: 'inactive' })).items.map((i) => i.name)).toEqual(['Gamma']);
    const page = await searchThirdParties(w.plain, { sort: 'name', dir: 'desc', pageSize: 2, page: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.meta).toMatchObject({ page: 2, pages: 2, total: 4 });
    expect((await searchThirdParties(w.plain, { page: 99, pageSize: 2 })).meta.page).toBe(2); // clamped, never empty
  });

  it('shows the money summary only to payout:view, and counts paid and due but never void', async () => {
    const w = await makeWorld();
    const project = await makeProject(await makeClient());
    await makePayout(w.party, project, { status: 'paid', amountMinor: 200_000 });
    await makePayout(w.party, project, { status: 'paid', amountMinor: 50_000 });
    await makePayout(w.party, project, { status: 'due', amountMinor: 70_000 });
    await makePayout(w.party, project, { status: 'void', amountMinor: 900_000 });
    await makeOrder(w.party, project);
    await makeOrder(w.party, project, { status: 'cancelled' });
    const seen = (await searchThirdParties(w.sa)).items[0];
    expect(seen?.money).toEqual({ paidInr: 250_000, paidCount: 2, dueInr: 70_000, dueCount: 1, openWorkOrders: 1 });
    expect((await getThirdParty(w.sa, id(w.party))).money).toEqual(seen?.money);
    expect((await searchThirdParties(w.plain)).items[0]?.money).toBeNull();
    expect((await getThirdParty(w.plain, id(w.party))).money).toBeNull();
    const reader = await sessionFor(await makeAdmin({ grants: ['payout:view'] }));
    expect((await searchThirdParties(reader)).items[0]?.money?.paidInr).toBe(250_000);
  });
});
