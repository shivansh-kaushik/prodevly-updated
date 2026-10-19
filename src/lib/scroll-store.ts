import { chapterFromY, nearestChapter } from '@/lib/scroll/chapters';
import type { Rect } from '@/lib/stage-store';

/**
 * The single place scroll state lives. A mutable module with NO React state and
 * NO three.js import, so scroll handlers never trigger a re-render and the 3D
 * code is never pulled into a chunk that only needs scroll maths.
 *
 * Rules (docs/CONTRACT.md):
 * - Scroll handlers write `target` through `setScrollY` and nothing else.
 *   No code writes a transform from a scroll event.
 * - Whatever moves on screen chases `target` through a follower (smoothDamp).
 * - Read `target` from Lenis's TARGET scroll, not its smoothed value, so the
 *   smoothing is not applied twice.
 */
export interface ScrollStore {
  /** Last scroll position written, in px. */
  y: number;
  /** Chapter float the rendered values should chase, with station holds applied. */
  target: number;
  /** True until the first frame consumes it: snap instead of gliding. */
  snap: boolean;
  /** Scroll position (px) at which each station's centre meets the viewport centre. */
  centres: number[];
  /** Station keys (`data-chapter` values) in page order, matching `centres`. */
  keys: string[];
  /**
   * Where each station's stage zone (`[data-stage-zone]`) sits in the viewport when that
   * station is at rest, in CSS pixels (top-left origin); null when it has none. The
   * framing fits the subject into the zone's CURRENT place (this, moved by how far the
   * page has scrolled from the station's centre), so the totem travels with its section
   * like the rest of the page, and stands exactly in the space the layout gave it.
   */
  zones: (Rect | null)[];
  /**
   * The scroll position the page is drawn at this frame (Lenis's animated value, or the
   * native one). Only the zone positions read it: they are layout, glued to the DOM.
   * Chapters and every follower use `target`.
   */
  view: number;
  /** Nearest station index. Changes rarely, so the UI may subscribe to it. */
  chapterIndex: number;
  /** Change of `y` at the last write, clamped to +-MAX_DELTA px. Feeds lean, never a pose. */
  delta: number;
}

/** Scroll-driven channels never see more than this per frame (docs/plan/engineering.html section 4). */
export const MAX_DELTA = 60;

export const scroll: ScrollStore = {
  y: 0,
  target: 0,
  snap: true,
  centres: [],
  keys: [],
  zones: [],
  view: 0,
  chapterIndex: 0,
  delta: 0,
};

type ChapterListener = (index: number) => void;
const listeners = new Set<ChapterListener>();

function recompute() {
  scroll.target = chapterFromY(scroll.y, scroll.centres);
  const index = nearestChapter(scroll.target, scroll.centres.length);
  if (index !== scroll.chapterIndex) {
    scroll.chapterIndex = index;
    listeners.forEach((fn) => fn(index));
  }
}

/** Write the (target) scroll position. The only thing a scroll handler may call. */
export function setScrollY(y: number) {
  const d = y - scroll.y;
  scroll.delta = d > MAX_DELTA ? MAX_DELTA : d < -MAX_DELTA ? -MAX_DELTA : d;
  scroll.y = y;
  recompute();
}

type StationsListener = (keys: readonly string[]) => void;
const stationListeners = new Set<StationsListener>();

/**
 * Replace the measured station centres (on resize, after fonts load, after mount).
 * `keys` names each station; when the set changes (a section hid or appeared),
 * subscribers rebuild whatever they derive from it, such as the camera rails.
 */
export function setCentres(centres: readonly number[], keys?: readonly string[], zones?: readonly (Rect | null)[]) {
  scroll.centres = [...centres];
  scroll.zones = zones ? [...zones] : centres.map(() => null);
  if (keys && (keys.length !== scroll.keys.length || keys.some((k, i) => k !== scroll.keys[i]))) {
    scroll.keys = [...keys];
    stationListeners.forEach((fn) => fn(scroll.keys));
  }
  recompute();
}

/** Subscribe to changes in which stations are present. Returns an unsubscribe. */
export function onStationsChange(fn: StationsListener): () => void {
  stationListeners.add(fn);
  return () => {
    stationListeners.delete(fn);
  };
}

/** Ask the next frame to snap rather than glide (first frame, restored scroll). */
export function requestSnap() {
  scroll.snap = true;
}

/** The scroll position the page is drawn at (see `view`). Written by the clock once per tick. */
export function setViewY(y: number) {
  scroll.view = y;
}

/** Subscribe to nearest-station changes (nav marker). Returns an unsubscribe. */
export function onChapterChange(fn: ChapterListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Test helper. */
export function resetScroll() {
  scroll.y = 0;
  scroll.target = 0;
  scroll.snap = true;
  scroll.centres = [];
  scroll.keys = [];
  scroll.zones = [];
  scroll.view = 0;
  scroll.chapterIndex = 0;
  scroll.delta = 0;
  listeners.clear();
  stationListeners.clear();
}
