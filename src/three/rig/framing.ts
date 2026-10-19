import { MathUtils, type PerspectiveCamera, Vector3 } from 'three';
import type { Rect } from '@/lib/stage-store';
import type { EvaluatedPose } from '@/three/rig/pose-eval';

/**
 * The framing solver (docs/plan/engineering.html section 5).
 *
 * 1. The vertical FOV comes from a 50 deg horizontal FOV, clamped to 28..45 deg:
 *    past ~45 deg bevelled forms near the frame edge distort. A tall phone
 *    therefore pulls the camera BACK instead of widening the lens.
 * 2. The camera distance is set so the subject (its `extent` box, or its bounding
 *    sphere) fits the pose's safe rect with a 6% margin, on both axes.
 * 3. `setViewOffset` moves the projection centre onto the safe rect's centre
 *    without turning the camera, so copy can own the rest of the screen.
 *
 * It runs every frame from the real canvas size, which is cheap and exact. What
 * keeps Safari's toolbar from re-fitting is the wrapper: fixed at 100lvh, the
 * canvas never resizes when the toolbar collapses (`stats.resizes` proves it).
 */
export const H_FOV = 50;
export const V_FOV_MIN = 28;
export const V_FOV_MAX = 45;
export const MARGIN = 0.06;

const DEG = MathUtils.DEG2RAD;

export function derivedVFov(aspect: number): number {
  const v = 2 * Math.atan(Math.tan((H_FOV / 2) * DEG) / Math.max(1e-3, aspect)) * MathUtils.RAD2DEG;
  return MathUtils.clamp(v, V_FOV_MIN, V_FOV_MAX);
}

/**
 * Distance at which a subject of half-size `hx` across and `hy` up the screen fits the
 * safe rect: on each axis its angular half-size must not exceed the rect's half-extent
 * (minus the margin). Each axis is treated like a sphere of that radius, which also
 * covers the parts of the subject nearer the camera than the aim.
 */
export function fitDistanceXY(hx: number, hy: number, vFov: number, aspect: number, safe: Rect, margin = MARGIN): number {
  const tv = Math.tan((vFov / 2) * DEG);
  const ah = Math.max(1e-3, safe.h * tv * (1 - margin));
  const aw = Math.max(1e-3, safe.w * tv * aspect * (1 - margin));
  return Math.max(hy * Math.sqrt(1 + 1 / (ah * ah)), hx * Math.sqrt(1 + 1 / (aw * aw)));
}

/** Distance at which a sphere of `radius` fits the safe rect. */
export function fitDistance(radius: number, vFov: number, aspect: number, safe: Rect, margin = MARGIN): number {
  return fitDistanceXY(radius, radius, vFov, aspect, safe, margin);
}

const dir = new Vector3();
const ndc = new Vector3();

export function applyFraming(camera: PerspectiveCamera, pose: EvaluatedPose, width: number, height: number) {
  const aspect = width / Math.max(1, height);
  const vFov = MathUtils.clamp(pose.vFov, V_FOV_MIN, V_FOV_MAX);
  const distance = fitDistanceXY(pose.extentX * pose.scale, pose.extentY * pose.scale, vFov, aspect, pose.safe);

  dir.subVectors(pose.cam, pose.aim);
  if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
  camera.position.copy(pose.aim).addScaledVector(dir.normalize(), distance);
  camera.lookAt(pose.aim);

  camera.fov = vFov;
  camera.aspect = aspect;
  const cx = pose.safe.x + pose.safe.w / 2;
  const cy = pose.safe.y + pose.safe.h / 2;
  camera.setViewOffset(width, height, (0.5 - cx) * width, (0.5 - cy) * height, width, height);
  camera.updateProjectionMatrix();
}

/** Projected bounds of what framing fits (the extent box, or the sphere) around the aim, viewport fractions, for `?debug=stage`. */
export function projectBounds(camera: PerspectiveCamera, pose: EvaluatedPose, out: Rect): Rect {
  const rx = pose.extentX * pose.scale;
  const ry = pose.extentY * pose.scale;
  const d = Math.max(Math.max(rx, ry) * 1.0001, camera.position.distanceTo(pose.aim));
  const tv = Math.tan((camera.fov / 2) * DEG);
  ndc.copy(pose.aim).project(camera);
  const hh = ry / Math.sqrt(d * d - ry * ry) / (2 * tv);
  const hw = rx / Math.sqrt(d * d - rx * rx) / (2 * tv * camera.aspect);
  out.x = (ndc.x + 1) / 2 - hw;
  out.y = (1 - ndc.y) / 2 - hh;
  out.w = hw * 2;
  out.h = hh * 2;
  return out;
}
