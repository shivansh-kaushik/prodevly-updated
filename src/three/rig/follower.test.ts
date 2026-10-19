import { describe, expect, it } from 'vitest';
import { createFollowers, CUT_GAP, TUNING } from './follower';
import { createStageFade, REVEAL_IN } from './stage-fade';

function setup() {
  const fade = createStageFade();
  fade.release(REVEAL_IN);
  for (let i = 0; i < 60; i++) fade.step(1 / 60); // fully shown
  const followers = createFollowers(fade);
  followers.snap(0);
  return { fade, followers };
}

function run(followers: ReturnType<typeof createFollowers>, fade: ReturnType<typeof createStageFade>, target: number, seconds: number, hz: number, bucket: 'wide' | 'tall' = 'wide') {
  let maxSpeed = 0;
  let maxSpeedAtBaseCap = 0;
  const base = TUNING[bucket === 'tall' ? 'tall' : 'wide'].maxSpeed;
  for (let i = 0; i < Math.round(seconds * hz); i++) {
    const out = followers.step(1 / hz, target, bucket, false);
    fade.step(1 / hz);
    maxSpeed = Math.max(maxSpeed, Math.abs(out.speed));
    if (out.cap <= base + 1e-9) maxSpeedAtBaseCap = Math.max(maxSpeedAtBaseCap, Math.abs(out.speed));
  }
  return { maxSpeed, maxSpeedAtBaseCap };
}

describe('followers', () => {
  it('stay under the base cap for a one-chapter move (no catch-up)', () => {
    const { followers, fade } = setup();
    const { maxSpeed } = run(followers, fade, 1, 4, 60);
    expect(maxSpeed).toBeLessThanOrEqual(TUNING.wide.maxSpeed);
    const tall = setup();
    expect(run(tall.followers, tall.fade, 1, 4, 60, 'tall').maxSpeed).toBeLessThanOrEqual(TUNING.tall.maxSpeed);
  });

  it('catch up faster when far behind, and never exceed the cap in force', () => {
    const { followers, fade } = setup();
    const { maxSpeed } = run(followers, fade, 2.2, 6, 60);
    expect(maxSpeed).toBeGreaterThan(TUNING.wide.maxSpeed); // catch-up engaged
  });

  it('reach the target without overshooting, camera lagging the subject', () => {
    const { followers, fade } = setup();
    let lagSeen = false;
    let highest = 0;
    for (let i = 0; i < 360; i++) {
      const o = followers.step(1 / 60, 1, 'wide', false);
      fade.step(1 / 60);
      if (o.subject - o.camera > 0.01) lagSeen = true;
      highest = Math.max(highest, o.subject, o.camera);
    }
    expect(lagSeen).toBe(true);
    expect(highest).toBeLessThanOrEqual(1);
    expect(followers.step(1 / 60, 1, 'wide', false).subject).toBeCloseTo(1, 3);
  });

  it('agree at 30, 60 and 120 Hz within 1% after one second', () => {
    const at = (hz: number) => {
      const { followers, fade } = setup();
      let v = 0;
      for (let i = 0; i < hz; i++) {
        v = followers.step(1 / hz, 1, 'wide', false).subject;
        fade.step(1 / hz);
      }
      return v;
    };
    const ref = at(120);
    expect(Math.abs(at(60) - ref)).toBeLessThan(0.01);
    expect(Math.abs(at(30) - ref)).toBeLessThan(0.01);
  });

  it('clamp a hitch: a 2 s frame moves no further than a 1/20 s frame', () => {
    const a = setup();
    const b = setup();
    expect(a.followers.step(2, 1, 'wide', false).subject).toBeCloseTo(b.followers.step(1 / 20, 1, 'wide', false).subject, 9);
  });

  it(`turn a jump over ${CUT_GAP} chapters into exactly one fade-cut, then glide the last half`, () => {
    const { followers, fade } = setup();
    let jumpedTo = Number.NaN;
    let prev = 0;
    for (let i = 0; i < 180; i++) {
      const o = followers.step(1 / 60, 5, 'wide', false);
      fade.step(1 / 60);
      if (Number.isNaN(jumpedTo) && o.subject - prev > 1) jumpedTo = o.subject;
      prev = o.subject;
    }
    expect(fade.cuts).toBe(1);
    expect(jumpedTo).toBeGreaterThanOrEqual(4.5);
    expect(jumpedTo).toBeLessThan(4.6);
    expect(fade.opacity).toBe(1);
  });

  it('under reduced motion hold stations and cut between them', () => {
    const { followers, fade } = setup();
    const seen = new Set<number>();
    for (let i = 0; i < 120; i++) {
      seen.add(followers.step(1 / 60, 0.4, 'tall', true).subject);
      fade.step(1 / 60);
    }
    expect([...seen]).toEqual([0]); // nearest station is still 0
    for (let i = 0; i < 120; i++) {
      seen.add(followers.step(1 / 60, 0.7, 'tall', true).subject);
      fade.step(1 / 60);
    }
    expect([...seen].every(Number.isInteger)).toBe(true);
    expect(seen.has(1)).toBe(true);
    expect(fade.cuts).toBe(1);
  });
});
