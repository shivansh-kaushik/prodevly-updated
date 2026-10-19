import { describe, expect, it } from 'vitest';
import { checkPasswordPolicy } from './password-policy';
import { safeNextPath } from './safe-next-path';

const ctx = { email: 'aman.gupta@example.com', name: 'Aman Gupta' };

describe('password policy', () => {
  it('accepts a long, unpredictable password, including everyday words like "secret" or "master"', () => {
    expect(checkPasswordPolicy('copper-lantern-orbit-91', ctx)).toBeNull();
    expect(checkPasswordPolicy('brand-new-secret-77', ctx)).toBeNull();
    expect(checkPasswordPolicy('the-master-plan-is-blue', ctx)).toBeNull();
    expect(checkPasswordPolicy('Tr1cky!Horse#Staple', ctx)).toBeNull();
  });
  it('enforces the length floor', () => {
    expect(checkPasswordPolicy('short-one', ctx)).toMatch(/at least 12/);
    expect(checkPasswordPolicy('x'.repeat(11), ctx)).toMatch(/at least 12/);
  });
  it('enforces the 72-byte bcrypt ceiling in bytes, not characters', () => {
    expect(checkPasswordPolicy('a1b2c3d4e5f6'.repeat(6), ctx)).toBeNull(); // 72 bytes
    expect(checkPasswordPolicy('a1b2c3d4e5f6'.repeat(6) + 'x', ctx)).toMatch(/at most 72/);
    expect(checkPasswordPolicy('é'.repeat(40), ctx)).toMatch(/at most 72/); // 80 bytes
  });
  it('rejects repetition', () => {
    expect(checkPasswordPolicy('aaaaaaaaaaaaaaaa', ctx)).toMatch(/repetitive/);
    expect(checkPasswordPolicy('abababababababab', ctx)).toMatch(/repetitive/);
  });
  it('rejects the person\'s own details', () => {
    expect(checkPasswordPolicy('ilove-aman.gupta-2026', ctx)).toMatch(/email/);
    expect(checkPasswordPolicy('the-gupta-family-home', { name: 'Aman Gupta' })).toMatch(/name/);
    expect(checkPasswordPolicy('AMAN-is-the-best-1!', { name: 'Aman Gupta' })).toMatch(/name/);
  });
  it('rejects common passwords however they are decorated', () => {
    for (const p of ['Password123456!', 'qwerty-uiop-asdf', 'P@ssw0rd-P@ssw0rd', 'ProDevly#2026#Admin', 'letmein_letmein1']) {
      expect(checkPasswordPolicy(p, {})).toMatch(/common/);
    }
  });
});

describe('safeNextPath', () => {
  it('keeps paths inside the admin area', () => {
    expect(safeNextPath('/admin')).toBe('/admin');
    expect(safeNextPath('/admin/clients?tab=money')).toBe('/admin/clients?tab=money');
  });
  it('blocks open redirects and look-alikes', () => {
    for (const bad of [
      'https://evil.com',
      '//evil.com',
      '/\\evil.com',
      '/admin/../../evil',
      '/adminevil',
      'javascript:alert(1)',
      '/login',
      '/admin\n/x',
      '',
      null,
      undefined,
    ]) {
      expect(safeNextPath(bad as string | null | undefined)).toBe('/admin');
    }
  });
});
