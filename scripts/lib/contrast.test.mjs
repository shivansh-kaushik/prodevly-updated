import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkContrast, contrast, tokensOf } from './contrast.mjs';

describe('contrast', () => {
  it('matches the WCAG reference values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('reads the colour tokens from a theme block', () => {
    expect(tokensOf('@theme { --color-chalk: #eef1f0; --color-cobalt-side: #162a8e; --font-x: y; }')).toEqual({ chalk: '#eef1f0', 'cobalt-side': '#162a8e' });
  });

  it('passes every pair in the shipped palette', () => {
    const css = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8');
    const failed = checkContrast(css).filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed)).toEqual([]);
  });

  it('reports a missing token instead of passing', () => {
    expect(checkContrast('', [['chalk', 'cobalt', 4.5, 'x']])[0].ok).toBe(false);
  });
});
