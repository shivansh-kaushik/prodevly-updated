import { describe, expect, it } from 'vitest';
import { band, clamp, createDamped, smoothDamp, smoothDampAngle, wrapAngle } from './damp';

/** Run the spring for `seconds` at `hz`, returning the trace of value and per-step speed. */
function simulate(opts: {
  target: number;
  seconds: number;
  hz: number;
  smoothTime?: number;
  maxSpeed?: number;
  from?: number;
}) {
  const state = createDamped(opts.from ?? 0);
  const dt = 1 / opts.hz;
  const steps = Math.round(opts.seconds * opts.hz);
  let maxValue = state.value;
  let maxSpeedSeen = 0;
  for (let i = 0; i < steps; i++) {
    const before = state.value;
    smoothDamp(state, opts.target, opts.smoothTime ?? 0.45, dt, opts.maxSpeed);
    maxSpeedSeen = Math.max(maxSpeedSeen, Math.abs(state.value - before) / dt);
    maxValue = Math.max(maxValue, state.value);
  }
  return { state, maxValue, maxSpeedSeen };
}

describe('smoothDamp', () => {
  it('reaches the target and never overshoots it', () => {
    const { state, maxValue } = simulate({ target: 1, seconds: 6, hz: 60 });
    expect(maxValue).toBeLessThanOrEqual(1);
    expect(state.value).toBeCloseTo(1, 4);
  });

  it('never overshoots when the target reverses mid-flight', () => {
    const state = createDamped(0);
    for (let i = 0; i < 20; i++) smoothDamp(state, 10, 0.45, 1 / 60);
    const turnedAt = state.value;
    let lowest = turnedAt;
    for (let i = 0; i < 400; i++) {
      smoothDamp(state, 0, 0.45, 1 / 60);
      lowest = Math.min(lowest, state.value);
    }
    expect(lowest).toBeGreaterThanOrEqual(0);
  });

  it('holds the speed cap, so a huge jump in scroll cannot whip the subject', () => {
    const maxSpeed = 1.6;
    const { maxSpeedSeen } = simulate({ target: 100, seconds: 3, hz: 60, maxSpeed });
    expect(maxSpeedSeen).toBeLessThanOrEqual(maxSpeed);
    // and it is actually moving at a meaningful fraction of the cap
    expect(maxSpeedSeen).toBeGreaterThan(maxSpeed * 0.5);
  });

  it('holds the speed cap at 30, 60 and 120 Hz', () => {
    for (const hz of [30, 60, 120]) {
      const { maxSpeedSeen } = simulate({ target: 50, seconds: 2, hz, maxSpeed: 2 });
      expect(maxSpeedSeen).toBeLessThanOrEqual(2);
    }
  });

  const RATES = [30, 60, 90, 120, 144];

  it('gives the same position at every refresh rate after one second (within 0.5%)', () => {
    const at = (hz: number) => simulate({ target: 10, seconds: 1, hz }).state.value;
    const reference = at(240);
    for (const hz of RATES) expect(Math.abs(at(hz) - reference) / 10).toBeLessThan(0.005);
  });

  it('keeps the same cap-limited position at every refresh rate (within 0.5%)', () => {
    // Regression: before sub-stepping, 30 Hz travelled about 3% less than 120 Hz once the cap bit.
    const at = (hz: number) => simulate({ target: 100, seconds: 1, hz, maxSpeed: 3 }).state.value;
    const reference = at(240);
    for (const hz of RATES) expect(Math.abs(at(hz) - reference) / reference).toBeLessThan(0.005);
  });

  it('survives a hitch frame (dt of 50 ms) without a jump past the cap', () => {
    const state = createDamped(0);
    smoothDamp(state, 100, 0.45, 0.05, 2);
    expect(state.value).toBeLessThanOrEqual(2 * 0.05);
  });

  it('does nothing for a dt of zero and produces no NaN', () => {
    const state = createDamped(3);
    expect(smoothDamp(state, 9, 0.45, 0)).toBe(3);
    expect(state.velocity).toBe(0);
    expect(Number.isNaN(smoothDamp(state, 9, 0.45, 1 / 60))).toBe(false);
  });

  it('tolerates a zero smoothTime', () => {
    const state = createDamped(0);
    const v = smoothDamp(state, 1, 0, 1 / 60);
    expect(Number.isFinite(v)).toBe(true);
  });
});

describe('smoothDampAngle', () => {
  it('takes the short way round the circle', () => {
    const state = createDamped((350 * Math.PI) / 180);
    const target = (10 * Math.PI) / 180;
    const next = smoothDampAngle(state, target, 0.45, 1 / 60);
    // moving up through 360 deg, not backwards through 180
    expect(next).toBeGreaterThan((350 * Math.PI) / 180);
  });
});

describe('helpers', () => {
  it('band is 0 below, 1 above, 0.5 in the middle and monotonic', () => {
    expect(band(-1, 0, 1)).toBe(0);
    expect(band(2, 0, 1)).toBe(1);
    expect(band(0.5, 0, 1)).toBeCloseTo(0.5, 10);
    let prev = 0;
    for (let i = 0; i <= 100; i++) {
      const v = band(i / 100, 0.2, 0.8);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('band with equal edges is a step', () => {
    expect(band(0.4, 0.5, 0.5)).toBe(0);
    expect(band(0.6, 0.5, 0.5)).toBe(1);
  });

  it('clamps and wraps', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(-Math.PI, 10);
    expect(wrapAngle(0.5)).toBeCloseTo(0.5, 10);
  });
});
