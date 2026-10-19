import { Euler, Matrix4, Vector3 } from 'three';
import { CAP_HALF_DEPTH, CAST, capHalfWidth, type LayoutName, SPACE } from '@/three/directions/keycap/cast';

/**
 * Where every cap goes in every chapter, as data. A layout is a table of nine
 * placements, one per cap, so a chapter change is the same nine objects moving.
 * Hero, services and contact are fixed tables; work, pricing and team are built
 * from the records on the page (one sleeve per project, one plate per plan, one
 * cap per person), the same code for phone (`tall`) and desktop (`wide`).
 *
 * A raw placement is `[x, ground, z, rxDeg, ryDeg, rzDeg, scale, grounded]`.
 * `ground` is the height of the surface the cap rests on; the resting y is solved
 * from the rotated footprint, so a sleeve leaning back sits on its lowest corner.
 */
export type Raw = readonly [x: number, ground: number, z: number, rx: number, ry: number, rz: number, s: number, grounded: number];
export const P = (x: number, g: number, z: number, rx = 0, ry = 0, rz = 0, s = 1, grounded = 1): Raw => [x, g, z, rx, ry, rz, s, grounded];

export interface Slot {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  s: number;
  /** Non-uniform x scale (the team shelf stretches the bar only). */
  sx: number;
  /** Resting surface height, and whether the cap casts a contact blob. */
  ground: number;
  grounded: number;
  /** Footprint on the ground (w, d) and its offset from the origin (ox, oz), already scaled. */
  bw: number;
  bd: number;
  ox: number;
  oz: number;
  /** Waiting off frame: excluded from the framing sphere. */
  park: boolean;
}

export interface PlateSlot {
  w: number;
  d: number;
  x: number;
  z: number;
}

export interface Layout {
  slots: Slot[];
  plates: PlateSlot[];
  /** Bounding sphere of what is in view (parked caps excluded), for the pose. */
  centre: [number, number, number];
  radius: number;
  /** Corners of every cap and plate the frame must hold (parked caps, and the shelf's lip, excluded). */
  points: Array<[number, number, number]>;
}

export type LayoutSet = Record<LayoutName, Layout>;
export interface Layouts {
  tall: LayoutSet;
  wide: LayoutSet;
}

const D2R = Math.PI / 180;
const euler = new Euler(0, 0, 0, 'YXZ');
const m4 = new Matrix4();
const corner = new Vector3();

/** A cap is parked when it waits far off to the side (or deep behind the stage). */
const PARK = { wide: { x: 10.5, z: 99 }, tall: { x: 6.5, z: 7.5 } };

export function solve(table: readonly Raw[], tall: boolean, barScaleX = 1): Slot[] {
  return table.map((p, i) => {
    const spec = CAST[i]!;
    const hw0 = capHalfWidth(spec);
    const h = spec.h;
    const s = p[6];
    const sx = i === SPACE ? barScaleX : 1;
    euler.set(p[3] * D2R, 0, p[5] * D2R, 'YXZ');
    m4.makeRotationFromEuler(euler);
    let minY = Infinity;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const cx of [-1, 1])
      for (const cy of [0, 1])
        for (const cz of [-1, 1]) {
          corner.set(cx * hw0 * sx, cy * h, cz * CAP_HALF_DEPTH).applyMatrix4(m4);
          minY = Math.min(minY, corner.y);
          x0 = Math.min(x0, corner.x);
          x1 = Math.max(x1, corner.x);
          z0 = Math.min(z0, corner.z);
          z1 = Math.max(z1, corner.z);
        }
    const lim = tall ? PARK.tall : PARK.wide;
    return {
      x: p[0],
      y: p[1] - minY * s,
      z: p[2],
      rx: p[3] * D2R,
      ry: p[4] * D2R,
      rz: p[5] * D2R,
      s,
      sx,
      ground: p[1],
      grounded: p[7],
      bw: (x1 - x0) * s,
      bd: (z1 - z0) * s,
      ox: ((x0 + x1) / 2) * s,
      oz: ((z0 + z1) / 2) * s,
      park: Math.abs(p[0]) > lim.x || Math.abs(p[2]) > lim.z,
    };
  });
}

/** Off-frame waiting spot for an unused cap: deterministic, alternating sides. */
export function parked(i: number, tall: boolean): Raw {
  const side = i % 2 ? 1 : -1;
  return P(side * (tall ? 8 + (i % 3) : 12.5 + (i % 4) * 1.4), 0, ((i * 5) % 7) * 0.7 - 2, 0, ((i * 37) % 60) - 30, 0);
}
