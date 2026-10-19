import { describe, expect, it } from 'vitest';
import { pickFreeSlug, slugify } from './slug';

describe('slugify', () => {
  it('lowercases and joins words with hyphens', () => {
    expect(slugify('Our New Website')).toBe('our-new-website');
  });
  it('strips accents, punctuation and edge hyphens', () => {
    expect(slugify('  Café & Bar: The "Best" One!  ')).toBe('cafe-and-bar-the-best-one');
  });
  it('falls back when nothing usable is left', () => {
    expect(slugify('!!!')).toBe('item');
    expect(slugify('名前')).toBe('item');
  });
  it('keeps slugs short and never ends on a hyphen', () => {
    const slug = slugify('word '.repeat(40));
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('pickFreeSlug', () => {
  it('uses the base when it is free', () => {
    expect(pickFreeSlug('shop', new Set())).toBe('shop');
  });
  it('numbers from -2 and skips taken numbers', () => {
    expect(pickFreeSlug('shop', new Set(['shop']))).toBe('shop-2');
    expect(pickFreeSlug('shop', new Set(['shop', 'shop-2', 'shop-3']))).toBe('shop-4');
  });
  it('keeps a long base within the cap once a number is added', () => {
    const base = 'a'.repeat(60);
    const slug = pickFreeSlug(base, new Set([base]));
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-2')).toBe(true);
  });
});
