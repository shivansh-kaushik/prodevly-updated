/**
 * Runtime quality guard (docs/plan/engineering.html sections 5 and 6).
 *
 * The tier only ever steps DOWN during a visit:
 * - below 45 fps for 3 s: drop one tier (never below 1);
 * - at tier 1, below 30 fps for 5 s: give up and fade to the posters.
 *
 * Unlike drei's PerformanceMonitor it measures rendered frames only and restarts
 * its window whenever rendering pauses (no station in view, hidden tab, a cut),
 * so coming back from a pause is never read as a slow frame. Pure and
 * allocation-free.
 */
export const WINDOW = 0.5; // seconds per sample
export const DECLINE_FPS = 45;
export const DECLINE_AFTER = 3; // seconds
export const FAIL_FPS = 30;
export const FAIL_AFTER = 5; // seconds
/** iOS Low Power Mode runs at exactly 30 Hz; measured fps wobbles just under it. */
const FAIL_TOLERANCE = 0.9;

export type PerfVerdict = 'decline' | 'fail' | null;

export interface PerfGuard {
  /** Last completed window's fps (for the debug overlay). */
  readonly fps: number;
  /** Feed every tick. `rendered` is false when the stage skipped drawing. */
  sample(dt: number, rendered: boolean, tier: number): PerfVerdict;
  /** Forget the history (after a tier change, which reallocates the canvas). */
  reset(): void;
}

export function createPerfGuard(): PerfGuard {
  let frames = 0;
  let time = 0;
  let fps = 0;
  let slow = 0; // consecutive seconds below DECLINE_FPS
  let failing = 0; // consecutive seconds below FAIL_FPS

  function restartWindow() {
    frames = 0;
    time = 0;
  }

  return {
    get fps() {
      return fps;
    },
    sample(dt, rendered, tier) {
      if (!rendered || dt <= 0) {
        restartWindow();
        return null;
      }
      frames++;
      time += dt;
      if (time < WINDOW) return null;

      fps = frames / time;
      const span = time;
      restartWindow();

      slow = fps < DECLINE_FPS ? slow + span : 0;
      failing = fps < FAIL_FPS * FAIL_TOLERANCE ? failing + span : 0;

      if (tier <= 1 && failing >= FAIL_AFTER) {
        failing = 0;
        return 'fail';
      }
      if (tier > 1 && slow >= DECLINE_AFTER) {
        slow = 0;
        failing = 0;
        return 'decline';
      }
      return null;
    },
    reset() {
      restartWindow();
      slow = 0;
      failing = 0;
    },
  };
}
