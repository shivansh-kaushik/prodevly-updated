import { describe, expect, it } from 'vitest';
import { findStackingContexts } from './stacking.mjs';

const check = (jsx) => findStackingContexts(jsx).map((f) => f.what);

describe('stacking context check', () => {
  it('accepts a plain positioned section, with a field and a copy layer inside', () => {
    expect(check('const a = <section id="x" className="relative scroll-mt-14 text-chalk"><div className="absolute inset-0 z-0" /></section>;')).toEqual([]);
    expect(check('const a = <main id="main"><p className="opacity-50 transform z-20" /></main>;')).toEqual([]);
  });

  it('flags a transform, filter, opacity, isolation, contain, will-change or z-index on a section or main', () => {
    expect(check('const a = <section className="relative translate-y-2" />;')).toEqual(['class "translate-y-2"']);
    expect(check('const a = <section className="relative pd-split:scale-95 blur-sm opacity-90 isolate" />;')).toEqual(['class "pd-split:scale-95"', 'class "blur-sm"', 'class "opacity-90"', 'class "isolate"']);
    expect(check('const a = <main className="will-change-transform contain-paint z-10" />;')).toEqual(['class "will-change-transform"', 'class "contain-paint"', 'class "z-10"']);
    expect(check('const a = <section style={{ transform: "none", zIndex: 1, background: "red" }} />;')).toEqual(['style "transform"', 'style "zIndex"']);
  });

  it('follows class names through template strings and ternaries', () => {
    expect(check('const a = <section className={`relative ${dark ? "text-chalk" : "opacity-50"}`} />;')).toEqual(['class "opacity-50"']);
  });

  it('allows opacity-100 and leaves other elements alone', () => {
    expect(check('const a = <section className="opacity-100" />;')).toEqual([]);
    expect(check('const a = <div className="transform blur-md z-20" />;')).toEqual([]);
  });
});
