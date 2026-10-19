import { describe, expect, it } from 'vitest';
import { linesToList, listToLines, listToTags, orNull, tagsToList } from './lists';

describe('lines and tags', () => {
  it('splits one-per-line text, trims, and drops blank lines (including Windows line endings)', () => {
    expect(linesToList(' one \r\n\r\n two\n   \nthree ')).toEqual(['one', 'two', 'three']);
  });
  it('round-trips a list through lines', () => {
    expect(linesToList(listToLines(['a', 'b']))).toEqual(['a', 'b']);
  });
  it('splits comma separated tags and drops empty entries', () => {
    expect(tagsToList('React, Node.js ,, TypeScript,')).toEqual(['React', 'Node.js', 'TypeScript']);
    expect(listToTags(['React', 'Node.js'])).toBe('React, Node.js');
  });
  it('turns an emptied box into null so the server clears the field', () => {
    expect(orNull('  ')).toBeNull();
    expect(orNull(' hi ')).toBe('hi');
  });
});
