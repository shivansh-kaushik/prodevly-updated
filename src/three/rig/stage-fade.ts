/**
 * The canvas opacity and the fade-cut (docs/plan/engineering.html section 4).
 *
 * A cut is: fade out (150 ms), jump the followers while the canvas is invisible,
 * fade back in (200 ms). The same machine fades the canvas in on its first frame
 * (400 ms) and does the reduced-motion station cuts (150 ms each way).
 *
 * Pure and allocation-free; the stage writes `opacity` to the wrapper's style.
 */
type Phase = 'shown' | 'out' | 'dark' | 'in';

export interface StageFade {
  readonly opacity: number;
  /** Fade-cuts requested since creation. */
  readonly cuts: number;
  /** Start fading out for a cut. Ignored while a cut is already under way. */
  request(outSeconds?: number): void;
  /** The canvas is fully dark and a cut is waiting for the followers to jump. */
  cutReady(): boolean;
  /** Fade back in; also used for the first-frame reveal. */
  release(inSeconds?: number): void;
  /** Advance by `dt` seconds and return the opacity. */
  step(dt: number): number;
  /** Go dark immediately with no cut pending (context loss, remount). */
  hide(): void;
}

export const CUT_OUT = 0.15;
export const CUT_IN = 0.2;
export const REVEAL_IN = 0.4;

export function createStageFade(): StageFade {
  let phase: Phase = 'dark';
  let opacity = 0;
  let rate = 0;
  let pendingCut = false;
  let cuts = 0;

  return {
    get opacity() {
      return opacity;
    },
    get cuts() {
      return cuts;
    },
    request(outSeconds = CUT_OUT) {
      if (pendingCut) return;
      pendingCut = true;
      cuts++;
      if (phase === 'dark') return; // already invisible: the jump can happen at once
      phase = 'out';
      rate = 1 / Math.max(1e-3, outSeconds);
    },
    cutReady() {
      return pendingCut && phase === 'dark';
    },
    release(inSeconds = CUT_IN) {
      if (phase !== 'dark') return;
      pendingCut = false;
      phase = 'in';
      rate = 1 / Math.max(1e-3, inSeconds);
    },
    step(dt) {
      if (phase === 'out') {
        opacity -= dt * rate;
        if (opacity <= 0) {
          opacity = 0;
          phase = 'dark';
        }
      } else if (phase === 'in') {
        opacity += dt * rate;
        if (opacity >= 1) {
          opacity = 1;
          phase = 'shown';
        }
      }
      return opacity;
    },
    hide() {
      phase = 'dark';
      opacity = 0;
      pendingCut = false;
    },
  };
}
