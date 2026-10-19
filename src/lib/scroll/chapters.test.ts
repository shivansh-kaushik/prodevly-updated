import { describe, expect, it } from 'vitest';
import { HOLD_FROM, HOLD_TO, chapterFromY, nearestChapter } from './chapters';

// Unequal section heights on purpose: a short section next to a tall one.
const CENTRES = [0, 400, 5400, 6000, 9000];

describe('chapterFromY', () => {
  it('is 0 with fewer than two stations', () => {
    expect(chapterFromY(500, [])).toBe(0);
    expect(chapterFromY(500, [100])).toBe(0);
  });

  it('clamps before the first and after the last station', () => {
    expect(chapterFromY(-200, CENTRES)).toBe(0);
    expect(chapterFromY(99999, CENTRES)).toBe(CENTRES.length - 1);
  });

  it('is exactly an integer at every station centre', () => {
    CENTRES.forEach((c, i) => expect(chapterFromY(c, CENTRES)).toBe(i));
  });

  it('parks at the near station early in a segment and at the far one late', () => {
    const a = 400;
    const b = 5400;
    const span = b - a;
    expect(chapterFromY(a + span * (HOLD_FROM - 0.01), CENTRES)).toBe(1);
    expect(chapterFromY(a + span * (HOLD_TO + 0.01), CENTRES)).toBe(2);
  });

  it('gives every section an equal share whatever its pixel height', () => {
    // segment 0 is 400px, segment 1 is 5000px: both reach x.5 at their own midpoint
    expect(chapterFromY(200, CENTRES)).toBeCloseTo(0.5, 6);
    expect(chapterFromY(2900, CENTRES)).toBeCloseTo(1.5, 6);
  });

  it('never moves backwards as the scroll position increases', () => {
    let prev = -1;
    for (let y = -100; y <= 9500; y += 7) {
      const c = chapterFromY(y, CENTRES);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });

  it('survives two stations at the same position', () => {
    expect(Number.isFinite(chapterFromY(500, [0, 500, 500, 1000]))).toBe(true);
  });
});

describe('nearestChapter', () => {
  it('rounds and clamps', () => {
    expect(nearestChapter(1.4, 5)).toBe(1);
    expect(nearestChapter(1.6, 5)).toBe(2);
    expect(nearestChapter(-3, 5)).toBe(0);
    expect(nearestChapter(9, 5)).toBe(4);
    expect(nearestChapter(2, 0)).toBe(0);
  });
});
