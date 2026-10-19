/**
 * The one clock (docs/CONTRACT.md section 2).
 *
 * A single `gsap.ticker` callback, owned by `SmoothScroll`, drives Lenis and then
 * calls `runFrame`. Everything else that moves per frame (the followers, the
 * R3F `advance`) registers here instead of starting its own requestAnimationFrame,
 * so all transforms come from the same state in the same frame.
 *
 * This module imports nothing, so the 3D chunk can register without pulling GSAP
 * and the DOM side can run without pulling three.
 */
export type FrameCallback = (time: number, dt: number) => void;

interface Entry {
  fn: FrameCallback;
  order: number;
}

let entries: Entry[] = [];

/**
 * Run `fn(time, dt)` every frame, in ascending `order` (seconds and seconds).
 * `dt` is the raw frame delta; each consumer clamps it. Returns an unsubscribe.
 */
export function onFrame(fn: FrameCallback, order = 0): () => void {
  const entry = { fn, order };
  // A new array on (un)subscribe, never per frame, so a callback that unsubscribes
  // itself mid-loop cannot skip its neighbour.
  entries = [...entries, entry].sort((a, b) => a.order - b.order);
  return () => {
    entries = entries.filter((e) => e !== entry);
  };
}

/** Called once per tick by the ticker owner. Allocates nothing. */
export function runFrame(time: number, dt: number) {
  const list = entries;
  for (let i = 0; i < list.length; i++) list[i]!.fn(time, dt);
}

/** Frame-rate caps requested by the stage (tiers 1 and 2 cap at 60). 0 means none. */
type CapListener = (fps: number) => void;
let fpsCap = 0;
const capListeners = new Set<CapListener>();

export function setFpsCap(fps: number) {
  if (fps === fpsCap) return;
  fpsCap = fps;
  capListeners.forEach((fn) => fn(fps));
}

export function onFpsCap(fn: CapListener): () => void {
  capListeners.add(fn);
  fn(fpsCap);
  return () => {
    capListeners.delete(fn);
  };
}

/** Test helper. */
export function resetClock() {
  entries = [];
  fpsCap = 0;
  capListeners.clear();
}
