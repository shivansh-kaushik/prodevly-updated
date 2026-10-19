import { MathUtils, Vector3 } from 'three';
import type { Rect } from '@/lib/stage-store';
import { LAYOUT_NAMES, LAYOUT_OF_STATION, type LayoutName } from '@/three/directions/keycap/cast';
import type { Layout, Layouts } from '@/three/directions/keycap/layouts';
import { FIELD, HEX } from '@/three/directions/keycap/palette';
import type { Pose, PoseSet, PoseTable, Vec3 } from '@/three/poses/types';

/**
 * The keycap pose tables, one per aspect bucket. They are DATA: a camera direction,
 * the lens, a fallback safe rect and the layout weights per station.
 *
 * - Camera: azimuth and elevation (degrees) around the subject, from the approved
 *   preview, and a 30 deg vertical lens (a phone gets a long lens, no edge distortion).
 * - Framing: each station's `extent` is the half-size of the actual layout across and
 *   up the screen, measured from that station's camera direction, and `aim` is the
 *   middle of it. The engine fits that box into the station's zone, which the page
 *   measures live, so the totem fills its zone on every screen without touching copy.
 * - `assembly` holds one weight per layout. Between two stations the engine lerps the
 *   weights; the subject blends the placements and staggers each cap.
 */
interface Cam {
  az: number;
  el: number;
}

const cam = (az: number, el: number): Cam => ({ az, el });

const CAM_WIDE: Record<string, Cam> = {
  hero: cam(17, 24),
  services: cam(-24, 52),
  work: cam(-24, 18),
  pricing: cam(-14, 32),
  team: cam(-8, 17),
  contact: cam(-12, 27),
};

const CAM_TALL: Record<string, Cam> = {
  hero: cam(50, 16),
  services: cam(-24, 56),
  work: cam(-14, 32),
  pricing: cam(0, 60),
  team: cam(66, 14),
  contact: cam(-14, 30),
};

/**
 * Fallback zones, viewport fractions (top-left origin), measured at 390x844 and
 * 1440x900 with `scripts/measure-zones.ts`. The page measures each zone live
 * (`[data-stage-zone]`) and the stage frames into that; these apply only without it.
 */
const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const SAFE_WIDE: Record<string, Rect> = {
  hero: r(0.48, 0.08, 0.48, 0.88),
  services: r(0.04, 0.08, 0.53, 0.88),
  work: r(0.04, 0.23, 0.92, 0.43),
  pricing: r(0.04, 0.23, 0.92, 0.41),
  team: r(0.04, 0.26, 0.92, 0.45),
  contact: r(0.44, 0.15, 0.52, 0.74),
};
const SAFE_TALL: Record<string, Rect> = {
  hero: r(0.04, 0.3, 0.92, 0.58),
  services: r(0.04, 0.25, 0.92, 0.54),
  work: r(0.04, 0.25, 0.92, 0.39),
  pricing: r(0.04, 0.25, 0.92, 0.4),
  team: r(0.04, 0.23, 0.92, 0.47),
  contact: r(0.04, 0.27, 0.92, 0.22),
};

/**
 * Per-station trims on the measured extent (below 1 frames the subject larger and lets
 * an edge run off; above 1 leaves air). The bevelled corners make the box a little
 * generous already.
 */
const TRIM_TALL: Record<string, number> = { work: 0.92 };
const TRIM_WIDE: Record<string, number> = { hero: 0.96 };

const V_FOV = 30;
const DEG = MathUtils.DEG2RAD;
const UP = new Vector3(0, 1, 0);

function direction(c: Cam): Vec3 {
  const az = c.az * DEG;
  const el = c.el * DEG;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
}

/**
 * The layout as seen from `dir`: the middle of its screen-space box (the aim) and its
 * half-size across and up the screen. Orthographic, around the layout's centre; the
 * framing margin and its per-axis sphere fit cover perspective.
 */
function frameOf(layout: Layout, dir: Vec3) {
  const back = new Vector3(...dir).normalize();
  const right = new Vector3().crossVectors(UP, back).normalize();
  const up = new Vector3().crossVectors(back, right).normalize();
  const c = new Vector3(...layout.centre);
  const v = new Vector3();
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of layout.points) {
    v.set(p[0], p[1], p[2]).sub(c);
    const x = v.dot(right);
    const y = v.dot(up);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const aim = c.addScaledVector(right, (x0 + x1) / 2).addScaledVector(up, (y0 + y1) / 2);
  return { aim: [aim.x, aim.y, aim.z] as Vec3, x: (x1 - x0) / 2, y: (y1 - y0) / 2 };
}

/** The station's field colour: the subject bounces it onto the caps and tints its fill light with it. */
const tintOf = (station: string): string => HEX[FIELD[station] ?? 'chalk'];

function weights(name: LayoutName): Record<string, number> {
  const w: Record<string, number> = {};
  for (const n of LAYOUT_NAMES) w[n] = n === name ? 1 : 0;
  return w;
}

function table(tall: boolean, layouts: Layouts): PoseTable {
  const set = tall ? layouts.tall : layouts.wide;
  const out: Record<string, Pose> = {};
  for (const [station, name] of Object.entries(LAYOUT_OF_STATION)) {
    const dir = direction((tall ? CAM_TALL : CAM_WIDE)[station]!);
    const frame = frameOf(set[name], dir);
    const trim = (tall ? TRIM_TALL : TRIM_WIDE)[station] ?? 1;
    const [ax, ay, az] = frame.aim;
    out[station] = {
      cam: [ax + dir[0] * 10, ay + dir[1] * 10, az + dir[2] * 10],
      aim: frame.aim,
      vFov: V_FOV,
      // The pivot of the pointer tilt sits on the ground under the subject, so the shadow stays level.
      subject: { pos: [ax, 0, az], rot: [0, 0, 0], scale: 1 },
      radius: Math.max(frame.x, frame.y),
      extent: { x: frame.x * trim, y: frame.y * trim },
      assembly: weights(name),
      safe: (tall ? SAFE_TALL : SAFE_WIDE)[station]!,
      env: { yaw: 0, tint: tintOf(station) },
    };
  }
  return out;
}

export function buildPoses(layouts: Layouts): PoseSet {
  return { tall: table(true, layouts), wide: table(false, layouts) };
}
