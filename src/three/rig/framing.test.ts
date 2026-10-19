import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { createEvaluatedPose } from './pose-eval';
import { applyFraming, derivedVFov, fitDistance, fitDistanceXY, MARGIN, projectBounds, V_FOV_MAX, V_FOV_MIN } from './framing';

describe('framing', () => {
  it('derives the vertical FOV from a 50 deg horizontal FOV, clamped to 28..45', () => {
    expect(derivedVFov(1)).toBeCloseTo(45, 0); // 50 deg -> clamped
    expect(derivedVFov(16 / 9)).toBeGreaterThan(V_FOV_MIN);
    expect(derivedVFov(16 / 9)).toBeLessThan(V_FOV_MAX);
    expect(derivedVFov(390 / 844)).toBe(V_FOV_MAX); // a phone pulls back instead of widening
    expect(derivedVFov(4)).toBe(V_FOV_MIN);
  });

  it('fits a sphere: a bigger safe rect brings the camera closer', () => {
    const safe = { x: 0, y: 0, w: 1, h: 1 };
    const half = { x: 0, y: 0, w: 0.5, h: 0.5 };
    expect(fitDistance(1, 35, 1.5, half)).toBeGreaterThan(fitDistance(1, 35, 1.5, safe));
    expect(fitDistance(2, 35, 1.5, safe)).toBeCloseTo(2 * fitDistance(1, 35, 1.5, safe), 6);
  });

  it('puts the subject in the centre of the safe rect, filling it to the margin', () => {
    for (const [w, h, safe] of [
      [1440, 900, { x: 0.55, y: 0.1, w: 0.4, h: 0.8 }],
      [390, 844, { x: 0.05, y: 0.25, w: 0.9, h: 0.4 }],
    ] as const) {
      const camera = new PerspectiveCamera();
      const pose = createEvaluatedPose();
      pose.cam.set(3, 2, 9);
      pose.aim.set(0, 0, 0);
      pose.pos.set(0, 0, 0);
      pose.radius = 1.5;
      pose.extentX = pose.extentY = 1.5;
      pose.vFov = derivedVFov(w / h);
      Object.assign(pose.safe, safe);
      applyFraming(camera, pose, w, h);
      camera.updateMatrixWorld();
      const b = projectBounds(camera, pose, { x: 0, y: 0, w: 0, h: 0 });
      expect(b.x + b.w / 2).toBeCloseTo(safe.x + safe.w / 2, 3);
      expect(b.y + b.h / 2).toBeCloseTo(safe.y + safe.h / 2, 3);
      // Inside the rect, and touching it (minus the margin) on the tighter axis.
      expect(b.w).toBeLessThanOrEqual(safe.w + 1e-6);
      expect(b.h).toBeLessThanOrEqual(safe.h + 1e-6);
      const fill = Math.max(b.w / safe.w, b.h / safe.h);
      expect(fill).toBeCloseTo(1 - MARGIN, 2);
    }
  });
});

describe('extent framing', () => {
  it('fits a wide subject by its width and a tall one by its height', () => {
    const safe = { x: 0, y: 0, w: 1, h: 1 };
    // Same height, wider: never closer.
    expect(fitDistanceXY(4, 1, 35, 1, safe)).toBeGreaterThan(fitDistanceXY(1, 1, 35, 1, safe));
    // A sphere is the special case of equal extents.
    expect(fitDistanceXY(2, 2, 35, 1.5, safe)).toBeCloseTo(fitDistance(2, 35, 1.5, safe), 9);
  });

  it('fills the safe rect on the tighter axis with an extent box', () => {
    const camera = new PerspectiveCamera();
    const pose = createEvaluatedPose();
    pose.cam.set(0, 0, 10);
    pose.aim.set(0, 0, 0);
    pose.extentX = 3;
    pose.extentY = 0.5;
    pose.vFov = 35;
    Object.assign(pose.safe, { x: 0.1, y: 0.2, w: 0.8, h: 0.5 });
    applyFraming(camera, pose, 1000, 1000);
    camera.updateMatrixWorld();
    const b = projectBounds(camera, pose, { x: 0, y: 0, w: 0, h: 0 });
    expect(b.w / 0.8).toBeCloseTo(1 - MARGIN, 2);
    expect(b.h).toBeLessThan(0.5);
  });
});
