import { band } from '@/lib/motion/damp';

/**
 * Maps a scroll position to a "chapter float".
 *
 * Each 3D station (hero, services, work, ...) owns one integer. A chapter float
 * of 2.0 means "exactly at station 2"; 2.5 is half-way to station 3.
 *
 * Two properties matter:
 *
 * 1. EQUAL SHARE. Each section gets one unit of chapter, however many pixels
 *    tall it is. On a phone the copy wraps and sections get taller; a global
 *    0..1 page progress would drift away from the text, this cannot.
 * 2. STATION HOLD. Inside a segment the value parks at the near station until
 *    `HOLD_FROM` and at the far station from `HOLD_TO`, moving only in between.
 *    The subject sits still while a section's copy is on screen and travels
 *    during the scroll between sections.
 *
 * `centres[i]` is the scroll position (px) at which section i's centre meets the
 * viewport centre. Measure it in the browser (on resize, after fonts load), never
 * inside the frame loop.
 */
export const HOLD_FROM = 0.22;
export const HOLD_TO = 0.78;

export function chapterFromY(y: number, centres: readonly number[]): number {
  const n = centres.length;
  if (n < 2) return 0;
  const at = (i: number) => centres[i] ?? 0;
  if (y <= at(0)) return 0;
  if (y >= at(n - 1)) return n - 1;

  // Binary search for the segment [lo, hi] that contains y.
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at(mid) <= y) lo = mid;
    else hi = mid;
  }

  const span = at(hi) - at(lo);
  if (span <= 0) return lo;
  return lo + band((y - at(lo)) / span, HOLD_FROM, HOLD_TO);
}

/** Index of the nearest station. Used for the nav marker, never per frame. */
export function nearestChapter(chapter: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(chapter)));
}
