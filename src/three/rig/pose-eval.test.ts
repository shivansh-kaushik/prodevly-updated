import { describe, expect, it } from 'vitest';
import type { Pose, PoseSet } from '@/three/poses/types';
import { createEvaluatedPose, createPoseEvaluator, tableFor } from './pose-eval';

const pose = (x: number, extra: Partial<Pose> = {}): Pose => ({
  cam: [x, 1, 10],
  aim: [x, 0, 0],
  subject: { pos: [x, 0, 0], rot: [0, x * 10, 0], scale: 1 + x },
  radius: 1 + x,
  assembly: { split: x / 4 },
  safe: { x: 0.1 * x, y: 0.2, w: 0.5, h: 0.6 },
  env: { yaw: x, tint: '#ffffff' },
  ...extra,
});

const set: PoseSet = {
  wide: { a: pose(0), b: pose(1), c: pose(2), d: pose(4) },
  tall: { a: pose(0), b: pose(1, { vFov: 40 }), c: pose(2), d: pose(4) },
  mid: { b: pose(9) },
};

describe('pose evaluator', () => {
  it('passes exactly through every present station', () => {
    const ev = createPoseEvaluator(set);
    ev.build('wide', ['a', 'b', 'c', 'd']);
    const out = createEvaluatedPose();
    [0, 1, 2, 4].forEach((x, i) => {
      ev.evaluate(i, i, 35, out);
      expect(out.cam.x).toBeCloseTo(x, 6);
      expect(out.aim.x).toBeCloseTo(x, 6);
      expect(out.pos.x).toBeCloseTo(x, 6);
      expect(out.scale).toBeCloseTo(1 + x, 6);
      expect(out.assembly.split).toBeCloseTo(x / 4, 6);
    });
  });

  it('interpolates subject fields on the subject chapter and camera fields on the camera chapter', () => {
    const ev = createPoseEvaluator(set);
    ev.build('wide', ['a', 'b', 'c', 'd']);
    const out = ev.evaluate(0.5, 0, 35, createEvaluatedPose());
    expect(out.pos.x).toBeCloseTo(0.5, 6);
    expect(out.assembly.split).toBeCloseTo(0.125, 6);
    expect(out.cam.x).toBeCloseTo(0, 6);
    expect(out.safe.x).toBeCloseTo(0, 6);
  });

  it('skips missing stations: neighbours interpolate directly', () => {
    const ev = createPoseEvaluator(set);
    ev.build('wide', ['a', 'c']); // b and d hidden
    expect(ev.count).toBe(2);
    const out = ev.evaluate(0.5, 0.5, 35, createEvaluatedPose());
    expect(out.pos.x).toBeCloseTo(1, 6);
    expect(out.cam.x).toBeCloseTo(1, 1);
  });

  it('falls back to the previous pose for a station with no pose, and reports it', () => {
    const missing: string[] = [];
    const ev = createPoseEvaluator(set, (k) => missing.push(k));
    ev.build('wide', ['a', 'zzz', 'c']);
    expect(missing).toEqual(['zzz']);
    expect(ev.evaluate(1, 1, 35, createEvaluatedPose()).pos.x).toBeCloseTo(0, 6);
  });

  it('uses the derived vertical FOV unless a pose overrides it', () => {
    const ev = createPoseEvaluator(set);
    ev.build('tall', ['a', 'b']);
    expect(ev.evaluate(0, 0, 33, createEvaluatedPose()).vFov).toBe(33);
    expect(ev.evaluate(1, 1, 33, createEvaluatedPose()).vFov).toBe(40);
  });

  it('mid uses wide with per-station overrides', () => {
    const mid = tableFor(set, 'mid');
    expect(mid.a).toBe(set.wide.a);
    expect(mid.b?.radius).toBe(10);
  });

  it('clamps chapters outside the rail', () => {
    const ev = createPoseEvaluator(set);
    ev.build('wide', ['a', 'b']);
    expect(ev.evaluate(-3, -3, 35, createEvaluatedPose()).pos.x).toBeCloseTo(0, 6);
    expect(ev.evaluate(9, 9, 35, createEvaluatedPose()).pos.x).toBeCloseTo(1, 6);
  });
});

describe('measured zones', () => {
  it('replace a station\'s safe rect, and blend on the camera chapter like it', () => {
    const ev = createPoseEvaluator(set);
    ev.build('wide', ['a', 'b', 'c', 'd']);
    const zones = [{ x: 0.5, y: 0.1, w: 0.4, h: 0.8 }, null, null, null];
    expect(ev.evaluate(0, 0, 35, createEvaluatedPose(), zones).safe).toEqual({ x: 0.5, y: 0.1, w: 0.4, h: 0.8 });
    // b has no zone: its own safe rect (x 0.1) still applies, halfway on the camera chapter.
    const mid = ev.evaluate(3, 0.5, 35, createEvaluatedPose(), zones).safe;
    expect(mid.x).toBeCloseTo((0.5 + 0.1) / 2, 6);
    expect(mid.h).toBeCloseTo((0.8 + 0.6) / 2, 6);
    expect(ev.evaluate(0, 0, 35, createEvaluatedPose()).safe.x).toBe(0);
  });
});
