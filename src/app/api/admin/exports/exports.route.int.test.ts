import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/admin/exports/[section]/route';
import { AuditLog } from '@/models';
import { setupTestDb } from '@/test/db';
import { FY, makeExportWorld, parseCsv } from '@/test/export-factories';
import { cookieFor, makeAdmin, makeRequest } from '@/test/factories';

setupTestDb();

/** The route's raw answer: a CSV is not the JSON envelope `call()` parses. */
async function get(section: string, o: { cookie?: string; query?: string; ip?: string; headers?: Record<string, string> } = {}) {
  const response = await GET(makeRequest(`/api/admin/exports/${section}${o.query ? `?${o.query}` : ''}`, { cookie: o.cookie, ip: o.ip, headers: o.headers }), { params: Promise.resolve({ section }) });
  // Bytes, not response.text(): the fetch API's text decoding drops a leading byte order mark, which is the thing under test.
  const bytes = Buffer.from(await response.arrayBuffer());
  const text = bytes.toString('utf8');
  let json: { ok?: boolean; error?: { code: string; message: string } } | null = null;
  if (!(response.headers.get('content-type') ?? '').startsWith('text/csv')) {
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
  }
  return { status: response.status, headers: response.headers, bytes, text, json, file: json === null ? parseCsv(text) : null };
}

const exportCount = () => AuditLog.countDocuments({ 'entity.type': 'export' });

describe('GET /api/admin/exports/[section]: who may call it', () => {
  it('answers 401 without a session and writes nothing', async () => {
    await makeExportWorld();
    const r = await get('clients');
    expect(r.status).toBe(401);
    expect(r.json?.error?.code).toBe('UNAUTHORIZED');
    expect(await exportCount()).toBe(0);
  });

  it('answers 403 FORBIDDEN to an admin without export:data, even with an open step-up', async () => {
    await makeExportWorld();
    const admin = await makeAdmin();
    const r = await get('clients', { cookie: await cookieFor(admin, { stepUp: true }) });
    expect(r.status).toBe(403);
    expect(r.json?.error?.code).toBe('FORBIDDEN');
    expect(r.text).not.toContain('Acme');
    expect(await exportCount()).toBe(0);
  });

  it('answers 403 STEP_UP_REQUIRED to a superadmin whose step-up is not open, and exports nothing', async () => {
    const w = await makeExportWorld();
    const r = await get('clients', { cookie: await cookieFor(w.saDoc) });
    expect(r.status).toBe(403);
    expect(r.json?.error?.code).toBe('STEP_UP_REQUIRED');
    expect(r.text).not.toContain('Acme');
    expect(r.headers.get('content-disposition')).toBeNull();
    expect(await exportCount()).toBe(0);
  });

  it('answers 403 PASSWORD_CHANGE_REQUIRED while a new password is pending', async () => {
    await makeExportWorld();
    const fresh = await makeAdmin({ mustChangePassword: true, grants: ['export:data'] });
    const r = await get('clients', { cookie: await cookieFor(fresh, { stepUp: true }) });
    expect(r.status).toBe(403);
    expect(r.json?.error?.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('answers 403 FORBIDDEN for export:data without the section\'s view capability, and opens once granted', async () => {
    await makeExportWorld();
    const admin = await makeAdmin({ grants: ['export:data'] });
    const cookie = await cookieFor(admin, { stepUp: true });
    const refused = await get('payments', { cookie });
    expect(refused.status).toBe(403);
    expect(refused.json?.error?.code).toBe('FORBIDDEN');
    expect(await exportCount()).toBe(0);
    // A plain admin can read clients, and the grant lets them export them.
    expect((await get('clients', { cookie })).status).toBe(200);

    const granted = await makeAdmin({ grants: ['export:data', 'payment:view'] });
    expect((await get('payments', { cookie: await cookieFor(granted, { stepUp: true }), query: new URLSearchParams(FY).toString() })).status).toBe(200);
  });

  it('refuses a request that another site started, and writes nothing', async () => {
    const w = await makeExportWorld();
    const cookie = await cookieFor(w.saDoc, { stepUp: true });
    for (const site of ['cross-site', 'same-site']) {
      const r = await get('clients', { cookie, headers: { 'sec-fetch-site': site } });
      expect(r.status, site).toBe(403);
      expect(r.json?.error?.code, site).toBe('FORBIDDEN');
      expect(r.text).not.toContain('Acme');
    }
    expect(await exportCount()).toBe(0);
    // The button's own request, and a person typing the address, are fine.
    expect((await get('clients', { cookie, headers: { 'sec-fetch-site': 'same-origin' } })).status).toBe(200);
    expect((await get('clients', { cookie, headers: { 'sec-fetch-site': 'none' } })).status).toBe(200);
  });

  it('answers 404 for an unknown section', async () => {
    const w = await makeExportWorld();
    const r = await get('everything', { cookie: await cookieFor(w.saDoc, { stepUp: true }) });
    expect(r.status).toBe(404);
    expect(r.json?.error?.code).toBe('NOT_FOUND');
    expect(await exportCount()).toBe(0);
  });
});

describe('GET /api/admin/exports/[section]: the download', () => {
  it('answers a CSV attachment with the right headers, a BOM and CRLF', async () => {
    const w = await makeExportWorld();
    const r = await get('clients', { cookie: await cookieFor(w.saDoc, { stepUp: true }) });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="prodevly-clients-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-export-rows')).toBe('3');
    expect(r.headers.get('x-export-total')).toBe('3');
    expect(r.headers.get('x-export-truncated')).toBeNull();
    expect([...r.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(r.text.charCodeAt(0)).toBe(0xfeff);
    expect(r.text.endsWith('\r\n')).toBe(true);
    expect(r.file?.records).toHaveLength(3);
  });

  it('applies the list page\'s query string, taking the first value of a repeated key', async () => {
    const w = await makeExportWorld();
    const cookie = await cookieFor(w.saDoc, { stepUp: true });
    expect((await get('clients', { cookie, query: 'status=active' })).file?.records.map((x) => x.Name)).toEqual(['Acme Studio']);
    expect((await get('clients', { cookie, query: 'status=active&status=paused' })).file?.records).toHaveLength(1);
    expect((await get('clients', { cookie, query: 'status=paused&status=active' })).file?.records.map((x) => x.Name)).toEqual(['Beta, "Global" Ltd']);
    expect((await get('clients', { cookie, query: 'status[$ne]=active&q[$regex]=.*' })).file?.records).toHaveLength(3);
    expect((await get('clients', { cookie, query: '__proto__=x&constructor=y&page=7' })).file?.records).toHaveLength(3);
    expect((await get('work-logs', { cookie, query: new URLSearchParams({ ...FY, billable: 'no' }).toString() })).file?.records).toHaveLength(1);
  });

  it('writes one audit entry per download, carrying the request id and the caller\'s hashed address', async () => {
    const w = await makeExportWorld();
    const cookie = await cookieFor(w.saDoc, { stepUp: true });
    await get('clients', { cookie, query: 'status=active' });
    const entries = await AuditLog.find({ 'entity.type': 'export' }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'export.clients' });
    expect(entries[0]?.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(entries[0]?.ipHash).toBeTruthy();
    expect(entries[0]?.ipHash).not.toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(entries[0]?.summary).toContain('status=active');
  });

  it('exports every section for a superadmin', async () => {
    const w = await makeExportWorld();
    const cookie = await cookieFor(w.saDoc, { stepUp: true });
    const query = new URLSearchParams(FY).toString();
    for (const section of ['clients', 'projects', 'tasks', 'work-logs', 'payments', 'third-party-payouts', 'work-orders', 'expenses', 'team-payouts', 'enquiries', 'audit']) {
      const r = await get(section, { cookie, query });
      expect(r.status, section).toBe(200);
      expect(r.headers.get('content-disposition'), section).toContain(`prodevly-${section}-`);
    }
    expect(await exportCount()).toBe(11);
  });

  it('limits how fast one person can export, and says when to retry', async () => {
    const w = await makeExportWorld();
    const cookie = await cookieFor(w.saDoc, { stepUp: true });
    for (let i = 0; i < 15; i++) expect((await get('audit', { cookie, query: 'period=this_month' })).status).toBe(200);
    const limited = await get('audit', { cookie, query: 'period=this_month' });
    expect(limited.status).toBe(429);
    expect(limited.json?.error?.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await exportCount()).toBe(15);
  }, 120_000);
});
