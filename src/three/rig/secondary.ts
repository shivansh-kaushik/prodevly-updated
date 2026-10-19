import { createDamped, smoothDamp } from '@/lib/motion/damp';
import { MAX_DELTA } from '@/lib/scroll-store';

/**
 * Secondary motion: offsets added AFTER the pose is evaluated, each with its own
 * spring, never fed back into the pose (docs/plan/engineering.html section 4).
 *
 * - Pointer tilt (fine pointers): yaw <= 6 deg, pitch <= 4 deg, smoothTime 0.35 s.
 * - Environment yaw from the pointer: <= 0.2 rad, smoothTime 0.6 s.
 * - Lean from scroll velocity (touch, instead of tilt): <= 5 deg, smoothTime 0.3 s,
 *   from the per-frame delta that the scroll store already clamps to 60 px.
 * - Breathing: a slow bob of 1.2% of the subject's radius.
 * Reduced motion switches all of it off (the springs settle to zero).
 */
const DEG = Math.PI / 180;
const TILT_YAW = 6 * DEG;
const TILT_PITCH = 4 * DEG;
const LEAN = 5 * DEG;
const ENV_YAW = 0.2;
const BREATH_PERIOD = 6; // seconds
const BREATH_AMPLITUDE = 0.012; // of the radius

export interface SecondaryOutput {
  /** Rotation offsets in radians and a vertical offset in world units. */
  rotX: number;
  rotY: number;
  offsetY: number;
  envYaw: number;
}

export function createSecondary() {
  const pointer = { x: 0, y: 0 };
  const yaw = createDamped();
  const pitch = createDamped();
  const lean = createDamped();
  const env = createDamped();
  const breath = createDamped();
  const out: SecondaryOutput = { rotX: 0, rotY: 0, offsetY: 0, envYaw: 0 };

  return {
    /** Pointer in -1..1, +y up. Written from a pointermove handler (a target, not a transform). */
    setPointer(x: number, y: number) {
      pointer.x = x < -1 ? -1 : x > 1 ? 1 : x;
      pointer.y = y < -1 ? -1 : y > 1 ? 1 : y;
    },
    step(dt: number, time: number, scrollDelta: number, radius: number, fine: boolean, reduced: boolean) {
      const live = !reduced;
      smoothDamp(yaw, live && fine ? pointer.x * TILT_YAW : 0, 0.35, dt);
      smoothDamp(pitch, live && fine ? -pointer.y * TILT_PITCH : 0, 0.35, dt);
      smoothDamp(env, live && fine ? pointer.x * ENV_YAW : 0, 0.6, dt);
      smoothDamp(lean, live && !fine ? (scrollDelta / MAX_DELTA) * LEAN : 0, 0.3, dt);
      const bob = live ? Math.sin((time * Math.PI * 2) / BREATH_PERIOD) * BREATH_AMPLITUDE * radius : 0;
      smoothDamp(breath, bob, 0.2, dt);
      out.rotX = pitch.value + lean.value;
      out.rotY = yaw.value;
      out.offsetY = breath.value;
      out.envYaw = env.value;
      return out;
    },
  };
}

export type Secondary = ReturnType<typeof createSecondary>;
