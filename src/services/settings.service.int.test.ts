import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as getRoute, PATCH as patchRoute } from '@/app/api/admin/settings/route';
import { toCode, cleanText, isValidTimeZone, SETTINGS_LIMITS, updateSettingsSchema } from '@/lib/validation/settings';
import { AuditLog, Settings, SETTINGS_ID } from '@/models';
import { getSettings, readSettings, SETTINGS_DEFAULTS, updateSettings } from '@/services/settings.service';
import { setupTestDb } from '@/test/db';
import { call, cookieFor, makeAdmin, makeSuperadmin, sessionFor } from '@/test/factories';
import { setSettings } from '@/test/settings-factories';

setupTestDb();
afterEach(() => vi.restoreAllMocks());

type Failure = { code?: string; status?: number; fields?: Record<string, string> };
const rejects = async (p: Promise<unknown>): Promise<Failure> => {
  try {
    await p;
  } catch (e) {
    return e as Failure;
  }
  throw new Error('expected the call to be rejected');
};
const stored = () => Settings.findById(SETTINGS_ID).lean();
const superadmin = async () => sessionFor(await makeSuperadmin());

describe('reading', () => {
  it('falls back to the defaults on a fresh database, as a copy nobody can corrupt', async () => {
    const settings = await getSettings();
    expect(settings).toEqual(SETTINGS_DEFAULTS);
    settings.paymentModes.push('hacked');
    settings.enabledCurrencies.length = 0;
    expect(SETTINGS_DEFAULTS.paymentModes).not.toContain('hacked');
    expect(SETTINGS_DEFAULTS.enabledCurrencies).toContain('INR');
    expect(await stored()).toBeNull(); // reading never creates the document
  });

  it('reads what is stored, and the defaults for anything an older document lacks', async () => {
    await setSettings({ orgName: 'Acme Studio', fxStaleDays: 3 });
    expect(await getSettings()).toMatchObject({ orgName: 'Acme Studio', fxStaleDays: 3, timezone: 'Asia/Kolkata', fyStartMonth: 4 });
  });

  it('readSettings is for superadmins', async () => {
    expect((await rejects(readSettings(await sessionFor(await makeAdmin())))).code).toBe('FORBIDDEN');
    expect(await readSettings(await superadmin())).toEqual(SETTINGS_DEFAULTS);
  });
});

describe('who may change settings', () => {
  it('only holders of settings:edit: a plain admin and a fx:edit grantee both get FORBIDDEN and nothing is written', async () => {
    for (const grants of [[], ['fx:edit' as const]]) {
      const viewer = await sessionFor(await makeAdmin({ grants }));
      expect((await rejects(updateSettings(viewer, { orgName: 'Hijacked' }))).code).toBe('FORBIDDEN');
    }
    expect(await stored()).toBeNull();
    expect(await AuditLog.countDocuments()).toBe(0);
  });

  it('settings:edit cannot be granted, so no grant opens the door', async () => {
    const viewer = await sessionFor(await makeAdmin({ grants: ['fx:edit', 'export:data', 'content:publish'] }));
    expect(viewer.capabilities.has('settings:edit')).toBe(false);
  });
});

describe('changing settings', () => {
  it('saves only what was sent, keeps the rest, and audits before and after in one entry', async () => {
    const sa = await makeSuperadmin();
    const out = await updateSettings(await sessionFor(sa), { orgName: '  Acme   Studio ', fyStartMonth: 1, workLogEditWindowDays: 14 }, { requestId: 'req-1' });
    expect(out).toMatchObject({ orgName: 'Acme Studio', fyStartMonth: 1, workLogEditWindowDays: 14, timezone: 'Asia/Kolkata', fxStaleDays: 7 });
    expect(out.paymentModes).toEqual(SETTINGS_DEFAULTS.paymentModes);
    expect(await stored()).toMatchObject({ _id: 'global', orgName: 'Acme Studio', baseCurrency: 'INR' });

    const entries = await AuditLog.find({ action: 'settings.update' }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.actor.name).toBe(sa.name);
    expect(entries[0]?.requestId).toBe('req-1');
    expect(entries[0]?.summary).toBe('Changed organisation name, financial year start, work-log edit window');
    expect(entries[0]?.changes).toEqual([
      { path: 'orgName', before: 'ProDevly', after: 'Acme Studio' },
      { path: 'fyStartMonth', before: 4, after: 1 },
      { path: 'workLogEditWindowDays', before: 7, after: 14 },
    ]);
  });

  it('writes nothing and leaves no audit entry when the values are already what was sent', async () => {
    const viewer = await superadmin();
    await updateSettings(viewer, { fxStaleDays: 10 });
    expect(await AuditLog.countDocuments()).toBe(1);
    const again = await updateSettings(viewer, { fxStaleDays: 10, orgName: 'ProDevly', paymentModes: [...SETTINGS_DEFAULTS.paymentModes] });
    expect(again.fxStaleDays).toBe(10);
    expect(await AuditLog.countDocuments()).toBe(1);
    const before = await stored();
    await updateSettings(viewer, { fxStaleDays: 10 });
    expect((await stored())?.updatedAt).toEqual(before?.updatedAt);
  });

  it('is all or nothing: if the audit entry cannot be written the settings are not changed', async () => {
    const viewer = await superadmin();
    await setSettings({ orgName: 'Original' });
    vi.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('audit store down'));
    await expect(updateSettings(viewer, { orgName: 'Changed' })).rejects.toThrow('audit store down');
    expect((await stored())?.orgName).toBe('Original');
  });

  it('applies the rules even when called without the route', async () => {
    const viewer = await superadmin();
    const err = await rejects(updateSettings(viewer, { fyStartMonth: 13 }));
    expect(err).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(err.fields).toHaveProperty('fyStartMonth');
    expect(await stored()).toBeNull();
  });
});

describe('INR can never be turned off', () => {
  it('refuses a list without INR, on the field enabledCurrencies, and changes nothing', async () => {
    const viewer = await superadmin();
    await setSettings({ enabledCurrencies: ['INR', 'USD', 'EUR'] });
    for (const list of [['USD', 'EUR'], [], ['usd']]) {
      const err = await rejects(updateSettings(viewer, { enabledCurrencies: list }));
      expect(err.code).toBe('VALIDATION_FAILED');
      expect(err.fields?.enabledCurrencies).toMatch(/INR/);
    }
    expect((await stored())?.enabledCurrencies).toEqual(['INR', 'USD', 'EUR']);
    expect(await AuditLog.countDocuments()).toBe(0);
  });

  it('cleans the list: codes are upper-cased, duplicates collapse, order is the canonical one', async () => {
    const viewer = await superadmin();
    const out = await updateSettings(viewer, { enabledCurrencies: ['gbp', ' usd ', 'USD', 'INR', 'jpy'] });
    expect(out.enabledCurrencies).toEqual(['INR', 'USD', 'GBP', 'JPY']);
  });

  it('refuses a currency the system does not know, naming the item', async () => {
    const err = await rejects(updateSettings(await superadmin(), { enabledCurrencies: ['INR', 'XXX'] }));
    expect(err.fields).toHaveProperty(['enabledCurrencies.1']);
  });

  it('the database refuses it as well, whatever the service does', async () => {
    await setSettings();
    await expect(Settings.updateOne({ _id: SETTINGS_ID }, { $set: { enabledCurrencies: ['USD'] } }, { runValidators: true })).rejects.toThrow(/INR/);
  });

  it('turning another currency off is fine, and the audit shows it', async () => {
    const viewer = await superadmin();
    await updateSettings(viewer, { enabledCurrencies: ['INR', 'USD'] });
    const entry = await AuditLog.findOne({ action: 'settings.update' }).lean();
    expect(entry?.changes[0]).toMatchObject({ path: 'enabledCurrencies', after: ['INR', 'USD'] });
  });
});

describe('the lists', () => {
  it('turns what is typed into codes: trimmed, case-folded, punctuation to underscores, duplicates and blank rows dropped', async () => {
    const out = await updateSettings(await superadmin(), {
      paymentModes: ['Bank Transfer ', 'bank-transfer', '  UPI  ', '', '   ', 'upi', 'Wise (EUR)'],
    });
    expect(out.paymentModes).toEqual(['bank_transfer', 'upi', 'wise_eur']);
    expect(toCode('Café  Ünïcode!')).toBe('cafe_unicode');
  });

  it('keeps at least one payment mode, one expense category and one third-party type', async () => {
    const viewer = await superadmin();
    for (const key of ['paymentModes', 'expenseCategories', 'thirdPartyTypes'] as const) {
      for (const list of [[], ['', '  ']]) {
        const err = await rejects(updateSettings(viewer, { [key]: list }));
        expect(err.code).toBe('VALIDATION_FAILED');
        expect(err.fields?.[key]).toMatch(/at least one/i);
      }
    }
    expect(await stored()).toBeNull();
  });

  it('enforces the length of an item and the size of a list, naming the item', async () => {
    const viewer = await superadmin();
    const long = await rejects(updateSettings(viewer, { paymentModes: ['cash', 'x'.repeat(SETTINGS_LIMITS.paymentModes.length + 1)] }));
    expect(long.fields).toHaveProperty(['paymentModes.1']);
    const many = Array.from({ length: SETTINGS_LIMITS.paymentModes.items + 1 }, (_, i) => `mode ${i}`);
    expect((await rejects(updateSettings(viewer, { paymentModes: many }))).fields).toHaveProperty('paymentModes');
    const exactly = Array.from({ length: SETTINGS_LIMITS.paymentModes.items }, (_, i) => `mode ${i}`);
    expect((await updateSettings(viewer, { paymentModes: exactly })).paymentModes).toHaveLength(SETTINGS_LIMITS.paymentModes.items);
    expect((await rejects(updateSettings(viewer, { expenseCategories: ['???'] }))).fields).toHaveProperty(['expenseCategories.0']);
    expect((await rejects(updateSettings(viewer, { thirdPartyTypes: [42 as unknown as string] }))).code).toBe('VALIDATION_FAILED');
  });

  it('cleans enquiry budget ranges as display text: trimmed, spaces collapsed, controls removed, duplicates ignoring case, may be empty', async () => {
    const viewer = await superadmin();
    const out = await updateSettings(viewer, { budgetRanges: ['  Under   ₹1 lakh ', 'under ₹1 LAKH', '₹1 to ₹5 lakh\u0000\u202e', '', '  '] });
    expect(out.budgetRanges).toEqual(['Under ₹1 lakh', '₹1 to ₹5 lakh']);
    expect(cleanText('a\u200bb\tc')).toBe('a b c');
    expect((await updateSettings(viewer, { budgetRanges: [] })).budgetRanges).toEqual([]);
    const err = await rejects(updateSettings(viewer, { budgetRanges: ['y'.repeat(SETTINGS_LIMITS.budgetRanges.length + 1)] }));
    expect(err.fields).toHaveProperty(['budgetRanges.0']);
  });

  it('stores an item that fits the field of the record it is used in', async () => {
    // Payment.mode is 40 characters; Expense.category 60. The limits come from those fields.
    expect(SETTINGS_LIMITS.paymentModes.length).toBeLessThanOrEqual(40);
    expect(SETTINGS_LIMITS.thirdPartyTypes.length).toBeLessThanOrEqual(40);
    expect(SETTINGS_LIMITS.expenseCategories.length).toBeLessThanOrEqual(60);
  });
});

describe('the single values', () => {
  it('validates the organisation name', async () => {
    const viewer = await superadmin();
    for (const orgName of ['', ' ', 'A', 'x'.repeat(81), 5 as unknown as string]) {
      expect((await rejects(updateSettings(viewer, { orgName }))).fields).toHaveProperty('orgName');
    }
    expect((await updateSettings(viewer, { orgName: 'x'.repeat(80) })).orgName).toHaveLength(80);
  });

  it('accepts real time zones only, because every dashboard buckets by it', async () => {
    const viewer = await superadmin();
    for (const timezone of ['Mars/Base', '+05:30', '', 'Asia', 'Asia/Kolkata/../../etc', 'x'.repeat(61), "Asia/Kolkata'; drop"]) {
      expect((await rejects(updateSettings(viewer, { timezone }))).fields).toHaveProperty('timezone');
    }
    for (const timezone of ['America/New_York', 'UTC', 'Asia/Kolkata', 'Europe/London']) {
      expect(isValidTimeZone(timezone)).toBe(true);
    }
    expect((await updateSettings(viewer, { timezone: ' America/New_York ' })).timezone).toBe('America/New_York');
  });

  it('keeps the numbers in range and whole', async () => {
    const viewer = await superadmin();
    const bad: Array<[string, unknown]> = [
      ['fyStartMonth', 0], ['fyStartMonth', 13], ['fyStartMonth', 4.5], ['fyStartMonth', '4'],
      ['workLogEditWindowDays', -1], ['workLogEditWindowDays', 91], ['workLogEditWindowDays', 1.5],
      ['fxStaleDays', 0], ['fxStaleDays', 61], ['fxStaleDays', Number.NaN],
    ];
    for (const [key, value] of bad) {
      expect((await rejects(updateSettings(viewer, { [key]: value } as never))).fields, `${key}=${String(value)}`).toHaveProperty(key);
    }
    const edges = await updateSettings(viewer, { fyStartMonth: 12, workLogEditWindowDays: 0, fxStaleDays: 60 });
    expect(edges).toMatchObject({ fyStartMonth: 12, workLogEditWindowDays: 0, fxStaleDays: 60 });
    expect((await updateSettings(viewer, { fyStartMonth: 1, workLogEditWindowDays: 90, fxStaleDays: 1 }))).toMatchObject({ workLogEditWindowDays: 90, fxStaleDays: 1 });
  });

  it('refuses fields that are not editable (the base currency, the _id) and an empty request', async () => {
    const viewer = await superadmin();
    expect((await rejects(updateSettings(viewer, { baseCurrency: 'USD' } as never))).code).toBe('VALIDATION_FAILED');
    expect((await rejects(updateSettings(viewer, { _id: 'other' } as never))).code).toBe('VALIDATION_FAILED');
    expect((await rejects(updateSettings(viewer, {}))).code).toBe('VALIDATION_FAILED');
    expect(updateSettingsSchema.safeParse({}).success).toBe(false);
    expect(await stored()).toBeNull();
  });

  it('treats operator-looking input as plain text and never as a query', async () => {
    const viewer = await superadmin();
    const err = await rejects(updateSettings(viewer, { orgName: { $set: { x: 1 } } as never }));
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(await stored()).toBeNull();
  });
});

describe('the HTTP routes', () => {
  it('is superadmin-only on both methods: 403 for a plain admin, 401 signed out', async () => {
    const plain = await cookieFor(await makeAdmin({ grants: ['fx:edit'] }));
    expect((await call(getRoute, '/api/admin/settings', { cookie: plain })).status).toBe(403);
    expect((await call(patchRoute, '/api/admin/settings', { method: 'PATCH', body: { orgName: 'Hijacked' }, cookie: plain })).status).toBe(403);
    expect((await call(getRoute, '/api/admin/settings')).status).toBe(401);
    expect((await call(patchRoute, '/api/admin/settings', { method: 'PATCH', body: { orgName: 'Hijacked' } })).status).toBe(401);
    expect(await stored()).toBeNull();
  });

  it('reads and patches for a superadmin, with field errors keyed for the form', async () => {
    const cookie = await cookieFor(await makeSuperadmin());
    const read = await call(getRoute, '/api/admin/settings', { cookie });
    expect(read.status).toBe(200);
    expect(read.body.data.settings).toEqual(SETTINGS_DEFAULTS);

    const patched = await call(patchRoute, '/api/admin/settings', {
      method: 'PATCH', cookie, body: { orgName: 'Acme', paymentModes: ['Cash', 'UPI'], enabledCurrencies: ['INR', 'USD'] },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.settings).toMatchObject({ orgName: 'Acme', paymentModes: ['cash', 'upi'], enabledCurrencies: ['INR', 'USD'] });

    const bad = await call(patchRoute, '/api/admin/settings', {
      method: 'PATCH', cookie, body: { enabledCurrencies: ['USD'], paymentModes: [], timezone: 'Mars/Base' },
    });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['enabledCurrencies', 'paymentModes', 'timezone']);
    expect((await Settings.findById(SETTINGS_ID).lean())?.orgName).toBe('Acme');
  });

  it('refuses cross-site writes and non-JSON bodies, changing nothing', async () => {
    const cookie = await cookieFor(await makeSuperadmin());
    const cross = await call(patchRoute, '/api/admin/settings', { method: 'PATCH', body: { orgName: 'Evil' }, cookie, headers: { 'sec-fetch-site': 'cross-site' } });
    expect(cross.status).toBe(403);
    const text = await call(patchRoute, '/api/admin/settings', { method: 'PATCH', rawBody: 'orgName=Evil', cookie, headers: { 'content-type': 'text/plain' } });
    expect(text.status).toBe(400);
    expect(await stored()).toBeNull();
  });

  it('keeps a pending password change in the way of everything', async () => {
    const sa = await makeSuperadmin({ mustChangePassword: true });
    const res = await call(patchRoute, '/api/admin/settings', { method: 'PATCH', body: { orgName: 'Acme' }, cookie: await cookieFor(sa) });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });
});
