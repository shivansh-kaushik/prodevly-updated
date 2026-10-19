import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_DELTA, onChapterChange, onStationsChange, requestSnap, resetScroll, scroll, setCentres, setScrollY } from './scroll-store';

beforeEach(resetScroll);

describe('scroll store', () => {
  it('turns a scroll position into a chapter target', () => {
    setCentres([0, 1000, 2000]);
    setScrollY(500);
    expect(scroll.target).toBeCloseTo(0.5, 6);
    setScrollY(2000);
    expect(scroll.target).toBe(2);
  });

  it('recomputes when the centres are re-measured', () => {
    setCentres([0, 1000]);
    setScrollY(500);
    expect(scroll.target).toBeCloseTo(0.5, 6);
    setCentres([0, 2000]); // fonts loaded, copy got taller
    expect(scroll.target).toBeLessThan(0.5);
  });

  it('notifies subscribers only when the nearest station changes', () => {
    const seen: number[] = [];
    const off = onChapterChange((i) => seen.push(i));
    setCentres([0, 1000, 2000]);
    for (const y of [10, 20, 300, 400, 600, 700, 1100, 1900]) setScrollY(y);
    expect(seen).toEqual([1, 2]);
    off();
    setScrollY(0);
    expect(seen).toEqual([1, 2]);
  });

  it('can be asked to snap', () => {
    scroll.snap = false;
    requestSnap();
    expect(scroll.snap).toBe(true);
  });

  it('clamps the per-frame delta that feeds scroll-driven channels', () => {
    setScrollY(0);
    setScrollY(500);
    expect(scroll.delta).toBe(MAX_DELTA);
    setScrollY(490);
    expect(scroll.delta).toBe(-10);
  });

  it('tells subscribers when the set of stations changes, not when only centres move', () => {
    const seen: string[][] = [];
    onStationsChange((keys) => seen.push([...keys]));
    setCentres([0, 1000], ['hero', 'contact']);
    setCentres([0, 1200], ['hero', 'contact']);
    setCentres([0, 800, 1600], ['hero', 'work', 'contact']);
    expect(seen).toEqual([
      ['hero', 'contact'],
      ['hero', 'work', 'contact'],
    ]);
  });
});

describe('stage zones', () => {
  it('stores one zone per station, null when a station has none', () => {
    setCentres([0, 1000], ['hero', 'contact'], [{ x: 0, y: 0.3, w: 1, h: 0.5 }, null]);
    expect(scroll.zones).toEqual([{ x: 0, y: 0.3, w: 1, h: 0.5 }, null]);
    setCentres([0, 1000, 2000]);
    expect(scroll.zones).toEqual([null, null, null]);
  });
});
