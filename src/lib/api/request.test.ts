import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getClientIp, hashIp, normaliseIp } from './client-ip';
import { assertSameOrigin, readJson } from './request';

const req = (init: { method?: string; headers?: Record<string, string>; body?: string }) =>
  new NextRequest('http://localhost:3050/api/x', { method: init.method ?? 'POST', headers: init.headers, body: init.body });

describe('client IP', () => {
  const h = (o: Record<string, string>) => new Headers(o);

  afterEach(() => vi.unstubAllEnvs());

  it('prefers the Vercel header on Vercel, where it cannot be spoofed', () => {
    vi.stubEnv('VERCEL', '1');
    expect(getClientIp(h({ 'x-vercel-forwarded-for': '203.0.113.9, 10.0.0.1', 'x-forwarded-for': '6.6.6.6' }))).toBe('203.0.113.9');
  });
  it('IGNORES the Vercel header anywhere else, where any client can send it', () => {
    vi.stubEnv('VERCEL', '');
    expect(getClientIp(h({ 'x-vercel-forwarded-for': '1.2.3.4', 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }), 0)).toBe('203.0.113.9');
    // with no proxy header at all, a spoofed Vercel header must not pick the bucket either
    expect(getClientIp(h({ 'x-vercel-forwarded-for': '1.2.3.4' }), 0)).not.toBe('1.2.3.4');
  });
  it('takes the rightmost X-Forwarded-For entry minus the trusted hops, never the spoofable leftmost one', () => {
    expect(getClientIp(h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }), 0)).toBe('203.0.113.9');
    expect(getClientIp(h({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }), 1)).toBe('203.0.113.9');
    expect(getClientIp(h({ 'x-forwarded-for': '203.0.113.9' }), 5)).not.toBe('203.0.113.9'); // more hops than entries: untrusted
  });
  it('normalises ports, brackets, zones and IPv4-mapped addresses', () => {
    expect(normaliseIp('203.0.113.9:5555')).toBe('203.0.113.9');
    expect(normaliseIp('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(normaliseIp('[2001:db8::1]:443')).toBe('2001:0db8:0000:0000::/64');
    expect(normaliseIp('fe80::1%en0')).toBe('fe80:0000:0000:0000::/64');
    expect(normaliseIp('not an ip')).toBeNull();
    expect(normaliseIp('')).toBeNull();
  });
  it('collapses an IPv6 address to its /64 so rotating the low bits buys nothing', () => {
    expect(normaliseIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(normaliseIp('2001:db8:1:2:1111:2222:3333:4444'));
    expect(normaliseIp('2001:db8:1:2::1')).not.toBe(normaliseIp('2001:db8:1:3::1'));
  });
  it('hashes IPs with a salt and never returns the address', () => {
    const hash = hashIp('203.0.113.9');
    expect(hash).toMatch(/^[a-f0-9]{32}$/);
    expect(hash).not.toContain('203');
    expect(hashIp('203.0.113.9')).toBe(hash);
    expect(hashIp('203.0.113.10')).not.toBe(hash);
  });
});

describe('assertSameOrigin', () => {
  it('lets reads through and same-origin writes', () => {
    expect(() => assertSameOrigin(req({ method: 'GET' }))).not.toThrow();
    expect(() => assertSameOrigin(req({ headers: { 'sec-fetch-site': 'same-origin' } }))).not.toThrow();
    expect(() => assertSameOrigin(req({ headers: { origin: 'http://localhost:3050' } }))).not.toThrow();
  });
  it('rejects cross-site, foreign origins and requests that identify themselves not at all', () => {
    expect(() => assertSameOrigin(req({ headers: { 'sec-fetch-site': 'cross-site' } }))).toThrow(/Cross-site/);
    expect(() => assertSameOrigin(req({ headers: { 'sec-fetch-site': 'same-site' } }))).toThrow();
    expect(() => assertSameOrigin(req({ headers: { origin: 'https://evil.example' } }))).toThrow();
    expect(() => assertSameOrigin(req({ headers: { origin: 'null' } }))).toThrow();
    expect(() => assertSameOrigin(req({}))).toThrow(/verify/);
  });
});

describe('readJson', () => {
  const json = { 'content-type': 'application/json' };
  it('parses JSON', async () => {
    expect(await readJson(req({ headers: json, body: '{"a":1}' }))).toEqual({ a: 1 });
  });
  it('rejects the wrong content type, an empty body and malformed JSON', async () => {
    await expect(readJson(req({ headers: { 'content-type': 'text/plain' }, body: 'a' }))).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(readJson(req({ headers: json, body: '   ' }))).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(readJson(req({ headers: json, body: '{oops' }))).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
  it('enforces the size cap on the real bytes, not on a header the client controls', async () => {
    await expect(readJson(req({ headers: json, body: JSON.stringify({ x: 'y'.repeat(2000) }) }), 1000)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    await expect(readJson(req({ headers: { ...json, 'content-length': '5' }, body: JSON.stringify({ x: 'y'.repeat(2000) }) }), 1000)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });
});
