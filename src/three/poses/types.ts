import type { Rect } from '@/lib/stage-store';

/**
 * Poses are DATA, authored per aspect bucket and per station
 * (docs/CONTRACT.md section 2). Never per-frame multipliers.
 *
 * A pose is absolute, so any station may be missing (its section had no published
 * records) and its neighbours still interpolate correctly.
 */
export type Vec3 = readonly [number, number, number];

export interface Pose {
  /**
   * Camera position. Only its DIRECTION from `aim` is used: the framing solver
   * sets the distance so the subject fits the safe rect.
   */
  cam: Vec3;
  /** Where the camera looks. It projects to the centre of `safe`, so put it on the subject. */
  aim: Vec3;
  /** Vertical FOV override in degrees (clamped to 28..45). Default: derived from a 50 deg horizontal FOV. */
  vFov?: number;
  subject: {
    pos: Vec3;
    /** Euler XYZ in DEGREES, for readable tables. */
    rot: Vec3;
    scale: number;
  };
  /** Bounding-sphere radius of the subject at this station, in world units at scale 1. */
  radius: number;
  /**
   * Optional half-size of the subject across (`x`) and up (`y`) the screen, in world units
   * at scale 1, measured at `aim` from this station's camera direction. When set, framing
   * fits this box into the safe rect instead of the `radius` sphere, so a wide or tall
   * subject fills its zone on every aspect ratio.
   */
  extent?: { x: number; y: number };
  /** 0..1 parameters that drive every piece's transform (stacked -> cluster, ...). */
  assembly: Record<string, number>;
  /** Viewport fractions, top-left origin, that the subject's projected bounds must fit. */
  safe: Rect;
  env: {
    /** Environment yaw in radians. */
    yaw: number;
    /** Fill-light tint, sRGB hex. */
    tint: string;
  };
}

/** One table per bucket, keyed by station (`data-chapter` value). */
export type PoseTable = Readonly<Record<string, Pose>>;

/** The three tables a direction ships. `mid` falls back to `wide`, re-fitted by the framing solver. */
export interface PoseSet {
  tall: PoseTable;
  wide: PoseTable;
  mid?: Partial<PoseTable>;
}
