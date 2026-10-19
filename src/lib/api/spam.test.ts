import { describe, expect, it } from 'vitest';
import { assessSpam, countLinks, describeSpam, SPAM_THRESHOLD, uppercaseShare } from './spam';

const real = 'We run a small logistics company and need a customer portal with order tracking. Can we talk this week?';
const check = (message: string, extra: { name?: string; company?: string } = {}) => assessSpam({ name: 'Neha Verma', message, ...extra });
const codes = (message: string, extra: { name?: string; company?: string } = {}) => check(message, extra).signals.map((s) => s.code);

describe('countLinks', () => {
  it('counts scheme URLs once, bare domains, and ignores email addresses', () => {
    expect(countLinks('see https://example.com/a and www.test.org')).toBe(2);
    expect(countLinks('my site is acme.io')).toBe(1);
    expect(countLinks('write to me at neha@example.com')).toBe(0);
    expect(countLinks('nothing here, just words. Really.')).toBe(0);
  });
});

describe('uppercaseShare', () => {
  it('counts only letters that have a case', () => {
    expect(uppercaseShare('ABCD efgh').share).toBeCloseTo(0.5);
    // Devanagari has no case, so it is never "shouting"
    expect(uppercaseShare('नमस्ते मुझे एक वेबसाइट चाहिए')).toEqual({ share: 0, letters: 0 });
  });
});

describe('spam heuristics', () => {
  it('lets an ordinary enquiry through with no signals', () => {
    const v = check(real);
    expect(v).toEqual({ spam: false, score: 0, signals: [] });
  });

  it('allows one link, a short all-caps message, and an email address', () => {
    expect(check(`${real} Our current site is https://acme.example.com`).spam).toBe(false);
    expect(check('NEED A WEBSITE ASAP').spam).toBe(false);
    expect(check(`${real} Reach me at neha@example.com`).spam).toBe(false);
  });

  it('three or more links is spam, two is only a soft signal', () => {
    const three = check('check https://a.example.com and https://b.example.com and https://c.example.com now');
    expect(three.spam).toBe(true);
    expect(three.signals[0]).toMatchObject({ code: 'links', points: 3 });
    const two = check(`${real} https://a.example.com https://b.example.com`);
    expect(two.spam).toBe(false);
    expect(two.signals).toEqual([expect.objectContaining({ code: 'links', points: 1 })]);
  });

  it('a link in the name field is spam on its own', () => {
    const v = check(real, { name: 'Best deals www.cheap-stuff.com' });
    expect(v.spam).toBe(true);
    expect(codes(real, { name: 'Best deals www.cheap-stuff.com' })).toContain('link_in_name');
  });

  it('repeated characters are a soft signal; shouting is a soft signal; two soft signals together are spam', () => {
    expect(check('Helloooooooooooo I need a website please').spam).toBe(false);
    expect(codes('Helloooooooooooo I need a website please')).toEqual(['repeated_characters']);

    const shout = 'I NEED A WEBSITE FOR MY COMPANY AND I NEED IT TO BE BUILT AS QUICKLY AS POSSIBLE';
    expect(codes(shout)).toEqual(['shouting']);
    expect(check(shout).spam).toBe(false);

    const both = check(`${shout}!!!!!!!!!!!!`);
    expect(both.score).toBe(4);
    expect(both.spam).toBe(true);
  });

  it('a junk phrase is spam on its own, whatever the case', () => {
    for (const phrase of ['Buy VIAGRA now', 'best online casino bonus', 'we offer cheap backlinks for your site', 'rank #1 on Google guaranteed', 'instant loans available']) {
      const v = check(phrase);
      expect(v.spam, phrase).toBe(true);
      expect(v.signals.map((s) => s.code)).toContain('junk_phrase');
    }
  });

  it('does not flag ordinary words that merely look like junk', () => {
    expect(check('We need SEO help and a faster website. Do you also do hosting?').spam).toBe(false);
    expect(check('Our casino-themed board game company needs an online shop.').spam).toBe(false);
  });

  it('markup spam bots post is spam on its own', () => {
    expect(check('<a href="http://x.example">cheap</a>').spam).toBe(true);
    expect(codes('great [url=http://x.example]site[/url]')).toContain('html_markup');
    expect(check('<script>alert(1)</script> hello there friend').spam).toBe(true);
  });

  it('a pasted code snippet from a developer is not markup spam', () => {
    expect(check(`${real} The page breaks on <div class="hero"> when it loads.`).spam).toBe(false);
  });

  it('describes why, for the audit trail', () => {
    const v = check('https://a.example.com https://b.example.com https://c.example.com aaaaaaaaaaaaaaa');
    expect(v.spam).toBe(true);
    expect(describeSpam(v)).toBe('3 links in the message; the same character repeated ten or more times');
    expect(v.score).toBeGreaterThanOrEqual(SPAM_THRESHOLD);
  });
});
