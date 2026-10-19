import type { Rig } from '@/three/direction';
import { createEvaluatedPose } from '@/three/rig/pose-eval';

/**
 * The per-frame rig state, a plain mutable module like the scroll and stage
 * stores: the driver writes it before `advance()`, the direction's useFrame
 * callbacks read it (they receive it as the `rig` prop). There is only one
 * canvas on the site (docs/CONTRACT.md section 4), so there is only one rig.
 */
export const rig: Rig = {
  pose: createEvaluatedPose(),
  chapter: 0,
  keys: [],
  time: 0,
  reducedMotion: false,
};
