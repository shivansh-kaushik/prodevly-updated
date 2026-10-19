import { createDamped, smoothDamp } from '@/lib/motion/damp';
import type { Bucket } from '@/lib/stage-store';
import { CUT_IN, CUT_OUT, type StageFade } from '@/three/rig/stage-fade';

/**
 * The followers: the ONLY smoothing between scroll and the main pose
 * (docs/CONTRACT.md section 2, docs/plan/engineering.html section 4).
 *
 * Two critically damped springs chase the same target chapter in parallel. The
 * camera's is 0.15 s slower, so the subject drifts a little inside the frame while
 * travelling. Neither reads the other's output. Poses are pure functions of these
 * two numbers; secondary motion is added after, as offsets.
 */
export const TUNING: Record<'wide' | 'tall', { smoothTime: number; maxSpeed: number }> = {
  wide: { smoothTime: 0.45, maxSpeed: 1.6 }, // maxSpeed in chapters per second
  tall: { smoothTime: 0.55, maxSpeed: 1.3 },
};
export const CAMERA_LAG = 0.15;
/** A jump larger than this (End key, nav click, scrollbar drag) becomes a fade-cut. */
export const CUT_GAP = 2.5;
export const MAX_DT = 1 / 20;

export interface FollowerOutput {
  subject: number;
  camera: number;
  /** Subject speed, chapters per second. */
  speed: number;
  /** The speed cap applied this step (base cap times the catch-up factor). */
  cap: number;
}

export interface Followers {
  /** Put both followers on `target` at rest (first frame, restored scroll). */
  snap(target: number): void;
  step(rawDt: number, target: number, bucket: Bucket, reducedMotion: boolean): FollowerOutput;
}

export function createFollowers(fade: StageFade): Followers {
  const subject = createDamped();
  const camera = createDamped();
  const out: FollowerOutput = { subject: 0, camera: 0, speed: 0, cap: 0 };

  function jump(value: number) {
    subject.value = camera.value = value;
    subject.velocity = camera.velocity = 0;
  }

  function publish(prev: number, dt: number) {
    out.subject = subject.value;
    out.camera = camera.value;
    out.speed = dt > 0 ? (subject.value - prev) / dt : 0;
    return out;
  }

  return {
    snap(target) {
      jump(target);
      out.subject = out.camera = target;
      out.speed = 0;
    },

    step(rawDt, target, bucket, reducedMotion) {
      const dt = Math.min(Math.max(rawDt, 0), MAX_DT); // a hitch or tab switch cannot cause a jump
      const prev = subject.value;

      if (reducedMotion) {
        // Hold the nearest station; a station change is a cut, never a glide.
        const station = Math.round(target);
        if (station !== subject.value) {
          fade.request(CUT_OUT);
          if (fade.cutReady()) {
            jump(station);
            fade.release(CUT_OUT);
          }
        }
        out.cap = 0;
        return publish(prev, dt);
      }

      const gap = Math.abs(target - subject.value);
      if (gap > CUT_GAP) fade.request(CUT_OUT);
      if (fade.cutReady()) {
        // Jump while invisible to half a chapter short, then glide the last half.
        jump(target - Math.sign(target - subject.value) * 0.5);
        fade.release(CUT_IN);
      }

      const { smoothTime, maxSpeed } = TUNING[bucket === 'tall' ? 'tall' : 'wide'];
      const cap = maxSpeed * (1 + 2 * Math.max(0, Math.abs(target - subject.value) - 1));
      out.cap = cap;
      smoothDamp(subject, target, smoothTime, dt, cap);
      smoothDamp(camera, target, smoothTime + CAMERA_LAG, dt, cap);
      return publish(prev, dt);
    },
  };
}
