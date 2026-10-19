import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

/**
 * Best-effort client IP, used for rate limiting and abuse forensics ONLY. It must
 * never be used for authorisation.
 *
 * `X-Forwarded-For` is client-controlled, so it is only trustworthy behind proxies
 * we control. Order of preference:
 *   1. `x-vercel-forwarded-for`, set by Vercel's edge and not spoofable there. Any
 *      other host passes it straight through from the client, so it is honoured
 *      ONLY when `process.env.VERCEL` is set (Vercel sets it on every deployment).
 *   2. The rightmost `X-Forwarded-For` entry minus TRUSTED_PROXY_HOPS (the number
 *      of extra trusted proxies that appear in the header; 0 behind one proxy).
 * Anything else is "unknown", which gets a much tighter rate-limit bucket.
 * IPv6 addresses collapse to their /64 so rotating the low bits buys nothing.
 */
export function normaliseIp(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;

  // [::1]:8080  ->  ::1        1.2.3.4:5678  ->  1.2.3.4        fe80::1%en0  ->  fe80::1
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) value = bracketed[1] ?? value;
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(value)) value = value.split(':')[0] ?? value;
  value = value.split('%')[0] ?? value;

  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value);
  if (mapped?.[1]) value = mapped[1];

  const family = isIP(value);
  if (family === 4) return value;
  if (family === 6) return collapseIpv6(value);
  return null;
}

function collapseIpv6(address: string): string {
  const [head = '', tail = ''] = address.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const missing = address.includes('::') ? Math.max(0, 8 - left.length - right.length) : 0;
  const groups = [...left, ...Array<string>(missing).fill('0'), ...right].map((g) => g.padStart(4, '0'));
  return `${groups.slice(0, 4).join(':')}::/64`;
}

export function getClientIp(headers: Headers, trustedHops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0)): string {
  const vercel = process.env.VERCEL ? headers.get('x-vercel-forwarded-for') : null;
  if (vercel) {
    const ip = normaliseIp(vercel.split(',')[0] ?? '');
    if (ip) return ip;
  }

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const entries = forwarded.split(',').map((e) => e.trim()).filter(Boolean);
    const index = entries.length - 1 - Math.max(0, trustedHops);
    const ip = index >= 0 ? normaliseIp(entries[index] ?? '') : null;
    if (ip) return ip;
  }

  // Local development has no proxy at all; keep normal limits instead of the "unknown" bucket.
  return process.env.NODE_ENV === 'production' ? 'unknown' : 'local';
}

function salt(): string {
  const value = process.env.IP_HASH_SALT;
  if (!value && process.env.NODE_ENV === 'production') {
    throw new Error('IP_HASH_SALT is required in production');
  }
  return value ?? 'dev-salt';
}

/** Salted SHA-256 of an IP. IPs are never stored in the clear. */
export function hashIp(ip: string): string {
  return createHash('sha256').update(`${salt()}:${ip}`).digest('hex').slice(0, 32);
}

/** Salted SHA-256 of any other identifier (an email, an admin id) used as a storage key. */
export function hashKey(value: string): string {
  return createHash('sha256').update(`${salt()}:key:${value}`).digest('hex').slice(0, 32);
}
