import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminDownload, ApiError } from '@/lib/admin/api-client';
import { EXPORT_SECTIONS } from '@/services/exports/types';
import { EXPORT_SECTION_IDS, ExportButton, exportUrl, failureNotice, successNotice } from './export-button';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }));

describe('the sections the button knows', () => {
  it('are exactly the sections the server exports', () => {
    expect([...EXPORT_SECTION_IDS]).toEqual([...EXPORT_SECTIONS]);
  });
});

describe('exportUrl', () => {
  it('carries the page\'s filters to the section\'s route', () => {
    expect(exportUrl('clients', {})).toBe('/api/admin/exports/clients');
    expect(exportUrl('payments', { status: 'void', q: 'a&b c', period: 'custom', from: '2026-04-01', to: '2026-06-30' })).toBe(
      '/api/admin/exports/payments?status=void&q=a%26b+c&period=custom&from=2026-04-01&to=2026-06-30',
    );
  });

  it('drops the page number, empty values and undefined, and takes the first of a repeated value', () => {
    expect(exportUrl('tasks', { page: '4', status: '', q: undefined, priority: ['high', 'low'] })).toBe('/api/admin/exports/tasks?priority=high');
  });

  it('cannot be steered to another route by a hostile parameter value', () => {
    const url = exportUrl('audit', { q: '../../auth/logout?x=', action: '/../../x' });
    expect(url.startsWith('/api/admin/exports/audit?')).toBe(true);
    expect(url).not.toContain('../');
    expect(new URL(url, 'http://localhost').pathname).toBe('/api/admin/exports/audit');
  });
});

describe('what the person is told', () => {
  it('reports a plain success with the row count', () => {
    expect(successNotice({ rows: 42, total: 42, truncated: false })).toEqual({ tone: 'success', text: 'Exported 42 rows.' });
    expect(successNotice({ rows: 1, total: 1, truncated: false })).toEqual({ tone: 'success', text: 'Exported 1 row.' });
    expect(successNotice({ rows: 0, total: 0, truncated: false }).text).toBe('Exported 0 rows.');
  });

  it('warns when the file was cut short, with both counts in Indian grouping and what to do', () => {
    const notice = successNotice({ rows: 20_000, total: 125_310, truncated: true });
    expect(notice.tone).toBe('warning');
    expect(notice.text).toContain('Only the first 20,000 rows of 1,25,310 were exported');
    expect(notice.text).toContain('Narrow the filters');
  });

  it('explains each failure in plain words', () => {
    expect(failureNotice(new ApiError('STEP_UP_REQUIRED', 'x', 403)).text).toBe('Exports need your password. Confirm it and try again.');
    expect(failureNotice(new ApiError('FORBIDDEN', 'x', 403)).text).toBe('Your access does not allow exporting this.');
    expect(failureNotice(new ApiError('RATE_LIMITED', 'x', 429, undefined, 12)).text).toBe('You have exported a lot just now. Try again in 12 seconds.');
    expect(failureNotice(new ApiError('RATE_LIMITED', 'x', 429)).text).toBe('You have exported a lot just now. Try again shortly.');
    expect(failureNotice(new ApiError('NETWORK', 'We could not reach the server. Check your connection and try again.', 0)).text).toContain('could not reach the server');
    expect(failureNotice(new ApiError('SERVICE_UNAVAILABLE', 'The database is down', 503)).text).toBe('The database is down');
    expect(failureNotice(new Error('boom')).text).toBe('The export did not finish. Please try again.');
    expect(failureNotice(new ApiError('FORBIDDEN', 'x', 403)).tone).toBe('error');
  });
});

describe('the button', () => {
  it('renders nothing for a viewer who cannot export', () => {
    expect(renderToStaticMarkup(h(ExportButton, { section: 'clients', params: {}, canExport: false }))).toBe('');
  });

  it('renders a real button with a visible label, with no API or toast provider around it', () => {
    const markup = renderToStaticMarkup(h(ExportButton, { section: 'clients', params: { status: 'active' }, canExport: true }));
    expect(markup).toMatch(/^<button type="button"/);
    expect(markup).toContain('Export CSV');
    expect(markup).not.toMatch(/\sdisabled(=|\s|>)/);
    expect(markup).not.toContain('aria-busy');
  });
});

describe('every list page offers it, to the right people, for the right section', () => {
  const pages: Array<[string, string]> = [
    ['clients/page.tsx', 'clients'],
    ['projects/page.tsx', 'projects'],
    ['tasks/page.tsx', 'tasks'],
    ['work-logs/page.tsx', 'work-logs'],
    ['payments/page.tsx', 'payments'],
    ['third-parties/payouts/page.tsx', 'third-party-payouts'],
    ['third-parties/work-orders/page.tsx', 'work-orders'],
    ['expenses/page.tsx', 'expenses'],
    ['team/payouts/page.tsx', 'team-payouts'],
    ['enquiries/page.tsx', 'enquiries'],
    ['audit/page.tsx', 'audit'],
  ];

  it.each(pages)('%s exports %s with its own search params, gated on export:data', (file, section) => {
    const source = readFileSync(new URL(`../../app/admin/(workspace)/${file}`, import.meta.url), 'utf8');
    expect(source).toContain(`<ExportButton section="${section}" params={sp} canExport={canExport} />`);
    expect(source).toContain("const canExport = viewer.capabilities.has('export:data');");
  });

  it('covers every exportable section exactly once', () => {
    expect(pages.map(([, section]) => section).sort()).toEqual([...EXPORT_SECTIONS].sort());
  });
});

describe('adminDownload', () => {
  afterEach(() => vi.unstubAllGlobals());

  const csv = (headers: Record<string, string> = {}) =>
    new Response('﻿Reference,Name\r\nCL-0001,Acme\r\n', {
      status: 200,
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="prodevly-clients-2026-10-12.csv"', 'x-export-rows': '1', 'x-export-total': '1', ...headers },
    });

  it('returns the file as bytes with its name and counts, and keeps the byte order mark', async () => {
    const fetchMock = vi.fn().mockResolvedValue(csv());
    vi.stubGlobal('fetch', fetchMock);
    const result = await adminDownload('/api/admin/exports/clients');
    expect(result).toMatchObject({ filename: 'prodevly-clients-2026-10-12.csv', rows: 1, total: 1, truncated: false });
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/exports/clients', expect.objectContaining({ method: 'GET', credentials: 'same-origin', cache: 'no-store' }));
  });

  it('reads the truncation header', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(csv({ 'x-export-truncated': 'true', 'x-export-rows': '20000', 'x-export-total': '25000' })));
    expect(await adminDownload('/api/admin/exports/clients')).toMatchObject({ truncated: true, rows: 20_000, total: 25_000 });
  });

  it('falls back to a plain file name when the header is missing or hostile', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(csv({ 'content-disposition': 'attachment; filename="../../evil.sh"' })));
    expect((await adminDownload('/x')).filename).toBe('prodevly-export.csv');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(csv({ 'content-disposition': 'attachment' })));
    expect((await adminDownload('/x')).filename).toBe('prodevly-export.csv');
  });

  it('throws the server\'s error code when the answer is the JSON envelope, so the provider can ask for a step-up', async () => {
    const body = JSON.stringify({ ok: false, error: { code: 'STEP_UP_REQUIRED', message: 'Please confirm your password to continue with this action' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 403, headers: { 'content-type': 'application/json' } })));
    await expect(adminDownload('/x')).rejects.toMatchObject({ name: 'ApiError', code: 'STEP_UP_REQUIRED', status: 403 });
  });

  it('carries Retry-After on a rate limit', async () => {
    const body = JSON.stringify({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '30' } })));
    await expect(adminDownload('/x')).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 30 });
  });

  it('refuses something that is not a CSV even when the status is 200 (a sign-in page, say)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>sign in</html>', { status: 200, headers: { 'content-type': 'text/html' } })));
    await expect(adminDownload('/x')).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('turns a dropped connection into a plain message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(adminDownload('/x')).rejects.toMatchObject({ code: 'NETWORK' });
  });
});

describe('the provider\'s download', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Renders the real provider once on the server and keeps the API a screen would get from it. */
  async function providerApi() {
    const { AdminProviders, useAdminApi } = await import('./api-provider');
    let api: ReturnType<typeof useAdminApi> | undefined;
    const Probe = () => {
      api = useAdminApi();
      return null;
    };
    renderToStaticMarkup(h(AdminProviders, null, h(Probe)));
    return api!;
  }

  it('is offered next to call, and downloads through the same fetch rules', async () => {
    const api = await providerApi();
    expect(typeof api.call).toBe('function');
    expect(typeof api.download).toBe('function');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('﻿A\r\n1\r\n', { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="prodevly-audit-2026-10-12.csv"', 'x-export-rows': '1', 'x-export-total': '1' } })));
    expect(await api.download('/api/admin/exports/audit')).toMatchObject({ filename: 'prodevly-audit-2026-10-12.csv', rows: 1, truncated: false });
  });

  it('hands a refusal that is not recoverable straight to the caller', async () => {
    const api = await providerApi();
    const body = JSON.stringify({ ok: false, error: { code: 'FORBIDDEN', message: 'Your access does not allow this action' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 403, headers: { 'content-type': 'application/json' } })));
    await expect(api.download('/api/admin/exports/payments')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
