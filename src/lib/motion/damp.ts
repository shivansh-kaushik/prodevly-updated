/**
 * Frame-rate-independent springs and ramps. Pure arithmetic, no dependencies.
 *
 * This is the fix for the travel site's car, which was a pure function of
 * scrollY and so ran faster than the eye could follow. Scroll now only sets a
 * TARGET; whatever is on screen chases that target with `smoothDamp`, a
 * critically damped spring with a speed cap.
 *
 * It imports nothing from `three` on purpose, so DOM code can use it without
 * pulling a renderer into its chunk. The same maths runs in the design previews.
 */

const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest signed difference between two angles, in [-PI, PI). */
export function wrapAngle(radians: number): number {
  return radians - TAU * Math.floor((radians + Math.PI) / TAU);
}

/**
 * C2-continuous 0..1 ramp. `smoothstep` is only C1, and the jump in its second
 * derivative shows up as a kick on the first scroll pixel of a move.
 */
export function band(x: number, from: number, to: number): number {
  if (from === to) return x < from ? 0 : 1;
  const t = clamp((x - from) / (to - from), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export interface Damped {
  value: number;
  velocity: number;
}

export function createDamped(value = 0): Damped {
  return { value, velocity: 0 };
}

/**
 * Longest integration step. The spring is only first-order accurate once the
 * speed cap bites, so a 30 Hz screen (iOS Low Power Mode) drifted about 3% behind
 * a 120 Hz one. Every frame is split into steps no longer than this, so all
 * refresh rates integrate the same way.
 */
const MAX_STEP = 1 / 240;

/**
 * Critically damped spring (Unity's SmoothDamp). Advances `state` toward
 * `target` over `dt` seconds and returns the new value.
 *
 * - `smoothTime` is roughly the time to reach the target; 0.35 to 0.6 s feels
 *   weighty without lagging.
 * - `maxSpeed` caps the chase in units per second. From rest the peak speed is
 *   about 0.74 x maxSpeed, so a trackpad fling can never whip the subject round.
 * - It never overshoots the target, and a `dt` of 0 changes nothing.
 * - Positions agree across 30, 60, 90, 120 and 144 Hz to well under 1%.
 */
export function smoothDamp(
  state: Damped,
  target: number,
  smoothTime: number,
  dt: number,
  maxSpeed = Number.POSITIVE_INFINITY,
): number {
  if (dt <= 0) return state.value;
  const steps = Math.max(1, Math.ceil(dt / MAX_STEP - 1e-9));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) step(state, target, smoothTime, h, maxSpeed);
  return state.value;
}

function step(state: Damped, target: number, smoothTime: number, dt: number, maxSpeed: number) {
  const time = Math.max(1e-4, smoothTime);
  const omega = 2 / time;
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

  const maxChange = maxSpeed * time;
  const change = clamp(state.value - target, -maxChange, maxChange);
  const goal = state.value - change;

  const temp = (state.velocity + omega * change) * dt;
  state.velocity = (state.velocity - omega * temp) * decay;

  let output = goal + (change + temp) * decay;
  // Overshoot guard: without it the spring rings on a direction change.
  if (target - state.value > 0 === output > target) {
    output = target;
    state.velocity = 0;
  }
  state.value = output;
  return output;
}

/** The same spring, approaching the target along the shortest arc. */
export function smoothDampAngle(
  state: Damped,
  target: number,
  smoothTime: number,
  dt: number,
  maxSpeed = Number.POSITIVE_INFINITY,
): number {
  return smoothDamp(state, state.value + wrapAngle(target - state.value), smoothTime, dt, maxSpeed);
}
