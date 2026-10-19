import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkFormToken, FORM_TOKEN_MAX_AGE_MS, FORM_TOKEN_MIN_AGE_MS, signFormToken } from './form-token';

const T0 = Date.UTC(2026, 9, 12, 10, 0, 0);

afterEach(() => vi.unstubAllEnvs());

describe('form token: sign and verify', () => {
  it('round-trips: a token checked a few seconds after issue is ok', () => {
    const token = signFormToken(T0);
    expect(token).toMatch(/^v1\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(checkFormToken(token, T0 + 10_000)).toBe('ok');
  });

  it('accepts a Date as well as milliseconds', () => {
    expect(checkFormToken(signFormToken(new Date(T0)), new Date(T0 + 5_000))).toBe('ok');
  });

  it('is deterministic for one instant and different for another', () => {
    expect(signFormToken(T0)).toBe(signFormToken(T0));
    expect(signFormToken(T0)).not.toBe(signFormToken(T0 + 1));
  });
});

describe('form token: age boundaries', () => {
  const token = signFormToken(T0);
  it('under 3 seconds is too fast, exactly 3 seconds is fine', () => {
    expect(checkFormToken(token, T0)).toBe('too_fast');
    expect(checkFormToken(token, T0 + FORM_TOKEN_MIN_AGE_MS - 1)).toBe('too_fast');
    expect(checkFormToken(token, T0 + FORM_TOKEN_MIN_AGE_MS)).toBe('ok');
  });
  it('exactly 2 hours is fine, one millisecond more is expired', () => {
    expect(checkFormToken(token, T0 + FORM_TOKEN_MAX_AGE_MS)).toBe('ok');
    expect(checkFormToken(token, T0 + FORM_TOKEN_MAX_AGE_MS + 1)).toBe('expired');
  });
  it('a token issued in the future counts as too fast, never as ok', () => {
    expect(checkFormToken(signFormToken(T0 + 60_000), T0)).toBe('too_fast');
  });
});

describe('form token: tampering', () => {
  const token = signFormToken(T0);
  const [version, issued, signature] = token.split('.') as [string, string, string];

  it('rejects a changed issue time (so nobody can back-date a token to pass the age check)', () => {
    expect(checkFormToken(`${version}.${Number(issued) - 3_600_000}.${signature}`, T0 + 10_000)).toBe('invalid');
  });
  it('rejects a changed signature, a truncated one and an empty one', () => {
    const flipped = signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A');
    expect(checkFormToken(`${version}.${issued}.${flipped}`, T0 + 10_000)).toBe('invalid');
    expect(checkFormToken(`${version}.${issued}.${signature.slice(0, 20)}`, T0 + 10_000)).toBe('invalid');
    expect(checkFormToken(`${version}.${issued}.`, T0 + 10_000)).toBe('invalid');
  });
  it('rejects another version, extra parts and non-numeric issue times', () => {
    expect(checkFormToken(`v2.${issued}.${signature}`, T0 + 10_000)).toBe('invalid');
    expect(checkFormToken(`${token}.extra`, T0 + 10_000)).toBe('invalid');
    expect(checkFormToken(`${version}.12abc.${signature}`, T0 + 10_000)).toBe('invalid');
    expect(checkFormToken(`${version}.-5.${signature}`, T0 + 10_000)).toBe('invalid');
  });
  it('rejects anything that is not a string, and absurdly long input', () => {
    for (const bad of [undefined, null, 5, {}, [], '', 'garbage', 'a.b.c']) expect(checkFormToken(bad, T0)).toBe('invalid');
    expect(checkFormToken('x'.repeat(5000), T0)).toBe('invalid');
  });
  it('rejects a token signed with a different secret', () => {
    vi.stubEnv('FORM_TOKEN_SECRET', 'another-secret-another-secret-123');
    expect(checkFormToken(token, T0 + 10_000)).toBe('invalid');
    // and a token signed under that secret verifies under it
    expect(checkFormToken(signFormToken(T0), T0 + 10_000)).toBe('ok');
  });
});

describe('form token: the secret', () => {
  it('is required in production, and must be long enough', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FORM_TOKEN_SECRET', '');
    expect(() => signFormToken(T0)).toThrow(/FORM_TOKEN_SECRET/);
    vi.stubEnv('FORM_TOKEN_SECRET', 'short');
    expect(() => signFormToken(T0)).toThrow(/FORM_TOKEN_SECRET/);
    vi.stubEnv('FORM_TOKEN_SECRET', 'a-long-enough-production-secret');
    expect(checkFormToken(signFormToken(T0), T0 + 10_000)).toBe('ok');
  });
});
