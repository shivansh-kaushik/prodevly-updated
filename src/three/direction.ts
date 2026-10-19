import type { ComponentType } from 'react';
import type { Quality } from '@/lib/gpu-tier';
import type { EvaluatedPose } from '@/three/rig/pose-eval';
import type { PoseSet } from '@/three/poses/types';

/**
 * What a home-page design direction hands the stage engine.
 *
 * Between directions only the totem geometry, the materials, the pose tables
 * and the lighting change (docs/plan/engineering.html, opening paragraph). The
 * stage, the followers, framing, tiers, fades and the frame loop stay the same,
 * so a design branch adds a Direction and never touches `src/three/rig`.
 */
export interface Direction {
  id: string;
  poses: PoseSet;
  /**
   * The totem. Rendered inside the posed subject group (position, rotation and
   * scale are already applied). It reads `rig.pose.assembly` in its own useFrame
   * to place its pieces; it must allocate nothing per frame and dispose what it
   * creates.
   */
  Subject: ComponentType<SubjectProps>;
  /** drei Lightformers (and only those) for the studio environment, baked once. */
  Lightformers: ComponentType;
  /**
   * Grounding under the subject, in the subject's local units (scaled with it). `null`
   * when the direction grounds itself (its own contact blobs and a shadow map), in
   * which case the engine draws no shadow of its own.
   */
  shadow: Shadow | null;
  /**
   * The direction casts real shadows from a light (the renderer's shadow map, PCF) at tier 3
   * only: tiers 1 and 2 (phones) skip the extra depth pass.
   */
  shadowMap?: boolean;
  /** Fill light intensity; its colour follows the pose's `env.tint`. */
  fill: number;
  /**
   * How small the subject gets halfway between two stations, as a fraction of its zone
   * (default 1: no change). Between stations the screen holds the end of one section and
   * the start of the next, so a smaller subject passes along the seam between them
   * instead of sliding under their copy.
   */
  travel?: number;
}

export interface Shadow {
  y: number;
  size: number;
  opacity: number;
  color: string;
  blur: number;
}

export interface SubjectProps {
  quality: Quality;
  rig: Rig;
}

/**
 * Mutable per-frame state shared inside the 3D chunk. The driver writes it before
 * `advance()`, useFrame callbacks read it. No React state.
 */
export interface Rig {
  pose: EvaluatedPose;
  /** Rendered chapter of the subject follower, and the station keys in page order. */
  chapter: number;
  keys: readonly string[];
  /** Seconds since the stage started; frozen while paused. */
  time: number;
  reducedMotion: boolean;
}
