import { describe, expect, it, vi } from 'vitest';

// The row cap is 20,000; the route is tested against a cap of 2 so the test does not need 20,001 rows.
vi.mock('@/services/exports/limits', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), EXPORT_ROW_CAP: 2 }));

import { GET } from '@/app/api/admin/exports/[section]/route';
import { AuditLog } from '@/models';
import { setupTestDb } from '@/test/db';
import { makeExportWorld, parseCsv } from '@/test/export-factories';
import { cookieFor, makeRequest } from '@/test/factories';

setupTestDb();

const get = (section: string, cookie: string, query = '') => GET(makeRequest(`/api/admin/exports/${section}${query}`, { cookie }), { params: Promise.resolve({ section }) });

describe('GET /api/admin/exports/[section]: the row cap', () => {
  it('cuts the file at the cap and says so in X-Export-Truncated, with the counts', async () => {
    const w = await makeExportWorld();
    const response = await get('clients', await cookieFor(w.saDoc, { stepUp: true }));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-export-truncated')).toBe('true');
    expect(response.headers.get('x-export-rows')).toBe('2');
    expect(response.headers.get('x-export-total')).toBe('3');
    expect(parseCsv(Buffer.from(await response.arrayBuffer()).toString('utf8')).records).toHaveLength(2);
    expect((await AuditLog.findOne({ action: 'export.clients' }).lean())?.summary).toContain('cut at 2 of 3');
  });

  it('sends no truncation header when the result fits', async () => {
    const w = await makeExportWorld();
    const response = await get('clients', await cookieFor(w.saDoc, { stepUp: true }), '?status=active');
    expect(response.headers.get('x-export-truncated')).toBeNull();
    expect(response.headers.get('x-export-rows')).toBe('1');
    expect(response.headers.get('x-export-total')).toBe('1');
  });
});
