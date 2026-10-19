import { describe, expect, it } from 'vitest';
import { extractStrings, scanSource } from './public-copy.mjs';

const flagged = (src) => scanSource(src).violations.length > 0;

describe('public copy check', () => {
  it('flags the classic fabricated claims', () => {
    expect(flagged(`const a = '500+ projects delivered';`)).toBe(true);
    expect(flagged(`const a = "99% client satisfaction";`)).toBe(true);
    expect(flagged(`const a = '4.9/5 rating';`)).toBe(true);
    expect(flagged(`const a = 'Over 120 clients worldwide';`)).toBe(true);
    expect(flagged(`const a = '10 years of experience';`)).toBe(true);
    expect(flagged(`const a = 'Trusted by the best';`)).toBe(true);
    expect(flagged('const a = `award winning team`;')).toBe(true);
    expect(flagged(`const a = 'What our happy clients say';`)).toBe(true);
  });

  it('allows honest copy, including the real service names', () => {
    expect(flagged(`const a = 'Web apps, SaaS and custom software, built end to end.';`)).toBe(false);
    expect(flagged(`const a = 'UI/UX design';`)).toBe(false);
    expect(flagged(`const a = 'Cloud & DevOps';`)).toBe(false);
    expect(flagged(`const a = 'Scope, design, build, support';`)).toBe(false);
  });

  it('does not flag everyday words that merely contain a flagged one', () => {
    expect(flagged(`const a = 'Integrated systems, generated reports, migrated data';`)).toBe(false);
    expect(flagged(`const a = 'Straightforward, forward-looking work';`)).toBe(false);
    expect(flagged(`const a = 'Rewarding projects';`)).toBe(false);
    expect(flagged(`const a = 'Operated and maintained';`)).toBe(false);
  });

  it('ignores arithmetic and numbers that are not inside strings', () => {
    expect(flagged('const r = 2 + 3; const s = 100 * 5 / 10; const p = 50 % 7;')).toBe(false);
    expect(flagged('geometry.translate(0, 1 + 0.5, 0)')).toBe(false);
  });

  it('exempts a line with a copy-ok comment and still lists it', () => {
    const r = scanSource(`const x = '2 years of experience'; // copy-ok: quoting the team's own bio`);
    expect(r.violations).toHaveLength(0);
    expect(r.exemptions).toHaveLength(1);
  });

  it('reports the right line numbers', () => {
    const r = scanSource(`const ok = 'fine';\n\nconst bad = '200+ clients';`);
    expect(r.violations[0].line).toBe(3);
  });

  it('extracts single, double and template strings', () => {
    const s = extractStrings(`a('x'); b("y"); c(\`z\`);`).map((e) => e.text);
    expect(s).toEqual(['x', 'y', 'z']);
  });

  it('does not flag shader source or CSS values (src/three is scanned too)', () => {
    expect(flagged('const frag = `void main() { float x = 1.0 + 0.5; gl_FragColor = vec4(x, 0.0, 0.0, 1.0); }`;')).toBe(false);
    expect(flagged('const v = `uniform float uTime; varying vec2 vUv; void main() { vUv = uv * 100.0 + 1.0; }`;')).toBe(false);
    expect(flagged(`const s = '50%';`)).toBe(false);
    expect(flagged(`const t = 'translate(50%, 100%)';`)).toBe(false);
    expect(flagged(`const c = 'calc(100% - 2rem)';`)).toBe(false);
    expect(flagged(`const c = 'rgba(0, 0, 0, 0.5) 0 0 10px';`)).toBe(false);
  });

  it('still flags real claims that contain words', () => {
    expect(flagged(`const a = '99% of clients come back';`)).toBe(true);
    expect(flagged(`const a = '50+ developers';`)).toBe(true);
    expect(flagged('const a = `Trusted by 200+ teams`;')).toBe(true);
  });
});
