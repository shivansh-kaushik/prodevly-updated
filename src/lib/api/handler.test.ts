import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { DatabaseUnavailableError } from '@/lib/db/mongoose';
import { redactChanges } from '@/services/audit.service';
import { AppError, conflict } from './errors';
import { toErrorResponse } from './handler';

afterEach(() => vi.restoreAllMocks());
const body = async (r: Response) => ({ status: r.status, json: await r.json() });

describe('error mapping', () => {
  it('maps an AppError to its own status, code and headers', async () => {
    const r = await body(toErrorResponse(new AppError('RATE_LIMITED', 'Slow down', 429, { headers: { 'Retry-After': '30' } })));
    expect(r).toMatchObject({ status: 429, json: { ok: false, error: { code: 'RATE_LIMITED', message: 'Slow down' } } });
    expect(toErrorResponse(new AppError('RATE_LIMITED', 'x', 429, { headers: { 'Retry-After': '30' } })).headers.get('retry-after')).toBe('30');
    expect((await body(toErrorResponse(conflict('Taken', { email: 'in use' })))).json.error.fields).toEqual({ email: 'in use' });
  });

  it('maps a ZodError to 422 with a field map', async () => {
    const parsed = z.object({ name: z.string().min(2, 'Too short') }).safeParse({ name: 'a' });
    const r = await body(toErrorResponse(parsed.error));
    expect(r.status).toBe(422);
    expect(r.json.error).toMatchObject({ code: 'VALIDATION_FAILED', fields: { name: 'Too short' } });
  });

  it('maps a dead database to 503 without leaking the connection string', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await body(toErrorResponse(new DatabaseUnavailableError('mongodb://user:secret@host/db refused')));
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.json)).not.toContain('secret');
  });

  it('maps a duplicate key to 409 and names the field', async () => {
    const r = await body(toErrorResponse(Object.assign(new Error('E11000 dup key'), { code: 11000, keyPattern: { email: 1 } })));
    expect(r.status).toBe(409);
    expect(r.json.error.fields).toEqual({ email: 'This value is already in use' });
    expect(JSON.stringify(r.json)).not.toContain('E11000');
  });

  it('answers any other error with a generic 500 and logs the real one', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await body(toErrorResponse(new Error('connection string mongodb://u:p@h leaked')));
    expect(r.status).toBe(500);
    expect(r.json.error.code).toBe('INTERNAL');
    expect(JSON.stringify(r.json)).not.toContain('mongodb');
    expect(log).toHaveBeenCalled();
  });
});

describe('audit redaction', () => {
  it('blanks secret-looking paths and leaves the rest', () => {
    const out = redactChanges([
      { path: 'passwordHash', before: '$2b$12$abc', after: '$2b$12$def' },
      { path: 'paymentNote', before: 'UPI a@b', after: 'UPI c@d' },
      { path: 'tokenVersion', before: 1, after: 2 },
      { path: 'name', before: 'A', after: 'B' },
    ]);
    expect(out[0]).toEqual({ path: 'passwordHash', before: '[redacted]', after: '[redacted]' });
    expect(out[1]).toEqual({ path: 'paymentNote', before: '[redacted]', after: '[redacted]' });
    expect(out[2]?.before).toBe('[redacted]'); // "token" in the path
    expect(out[3]).toEqual({ path: 'name', before: 'A', after: 'B' });
  });
});
