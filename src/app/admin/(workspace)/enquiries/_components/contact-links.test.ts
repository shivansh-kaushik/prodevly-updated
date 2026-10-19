import { describe, expect, it } from 'vitest';
import { mailtoHref, telHref } from './contact-links';

describe('mailtoHref', () => {
  it('links an ordinary address, keeping a plus tag', () => {
    expect(mailtoHref('neha@example.com')).toBe('mailto:neha@example.com');
    expect(mailtoHref('  neha@example.com ')).toBe('mailto:neha@example.com');
    expect(mailtoHref('neha+work@mail.example.co.in')).toBe('mailto:neha%2Bwork@mail.example.co.in');
  });

  it('never links anything that could add headers or change the scheme', () => {
    for (const bad of [
      'a@b.com?cc=victim@x.com',
      'a@b.com&bcc=victim@x.com',
      'a@b.com?subject=hi&body=click',
      'javascript:alert(1)//@x.com',
      'a b@example.com',
      'a@example.com\r\nBcc: x@y.com',
      '"quoted"@example.com',
      'a@b@example.com',
      'a@example',
      '<script>@example.com',
      'a@exa%6dple.com',
      'a@example.com#frag',
      '',
      null,
      undefined,
    ]) {
      expect(mailtoHref(bad), String(bad)).toBeNull();
    }
    expect(mailtoHref(`${'a'.repeat(170)}@example.com`)).toBeNull();
  });

  it('only ever produces a mailto: link', () => {
    for (const ok of ['neha@example.com', 'x.y_z@sub.example.org']) expect(mailtoHref(ok)).toMatch(/^mailto:[^\s?&#]+$/);
  });
});

describe('telHref', () => {
  it('reduces a number to digits and a leading plus', () => {
    expect(telHref('+91 98765-43210')).toBe('tel:+919876543210');
    expect(telHref('(020) 7946 0958')).toBe('tel:02079460958');
    expect(telHref('98765 43210')).toBe('tel:9876543210');
  });

  it('does not link text, scripts, too few or too many digits', () => {
    for (const bad of ['call me', 'javascript:alert(1)', '123', '+1 (55) 12', '1'.repeat(16), '+91 98765 43210;ext=1', '98765\n43210', '', null, undefined]) {
      expect(telHref(bad), String(bad)).toBeNull();
    }
  });
});
