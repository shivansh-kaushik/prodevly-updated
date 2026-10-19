import { CatmullRomCurve3, Color, Euler, MathUtils, Quaternion, Vector3 } from 'three';
import type { Bucket, Rect } from '@/lib/stage-store';
import type { Pose, PoseSet, PoseTable } from '@/three/poses/types';

/**
 * Turns the two follower values into one pose (docs/plan/engineering.html section 3).
 *
 * - The camera position and aim ride centripetal Catmull-Rom rails through the
 *   stations that are PRESENT, sampled so the rail passes exactly through each one.
 * - Subject position and scalars lerp, rotations slerp, assembly parameters lerp.
 * - Camera fields (cam, aim, vFov, safe) follow the camera follower; everything
 *   about the subject follows the subject follower.
 * - A station's measured stage zone, when the page has one, replaces its `safe`.
 *
 * `build` allocates (it runs when the bucket or the set of stations changes);
 * `evaluate` allocates nothing.
 */
export interface EvaluatedPose {
  cam: Vector3;
  aim: Vector3;
  vFov: number;
  pos: Vector3;
  quat: Quaternion;
  scale: number;
  radius: number;
  /** Half-size across and up the screen (the pose's `extent`, or its radius). */
  extentX: number;
  extentY: number;
  assembly: Record<string, number>;
  safe: Rect;
  envYaw: number;
  tint: Color;
}

interface Station {
  pose: Pose;
  quat: Quaternion;
  tint: Color;
}

const DEG = MathUtils.DEG2RAD;

export function createEvaluatedPose(): EvaluatedPose {
  return {
    cam: new Vector3(),
    aim: new Vector3(),
    vFov: 35,
    pos: new Vector3(),
    quat: new Quaternion(),
    scale: 1,
    radius: 1,
    extentX: 1,
    extentY: 1,
    assembly: {},
    safe: { x: 0, y: 0, w: 1, h: 1 },
    envYaw: 0,
    tint: new Color(),
  };
}

export function tableFor(set: PoseSet, bucket: Bucket): PoseTable {
  if (bucket !== 'mid') return set[bucket];
  const merged: Record<string, Pose> = { ...set.wide };
  for (const [key, pose] of Object.entries(set.mid ?? {})) if (pose) merged[key] = pose;
  return merged;
}

export interface PoseEvaluator {
  /** Rebuild for a bucket and the stations present, in page order. */
  build(bucket: Bucket, keys: readonly string[]): void;
  /** Number of stations the rails run through. */
  readonly count: number;
  /**
   * `zones[i]`, when given, replaces station i's `safe` rect: the page measured where
   * that station's stage zone sits at rest (see scroll-store `zones`).
   */
  evaluate(subjectChapter: number, cameraChapter: number, derivedVFov: number, out: EvaluatedPose, zones?: readonly (Rect | null)[]): EvaluatedPose;
}

export function createPoseEvaluator(set: PoseSet, onMissing?: (key: string) => void): PoseEvaluator {
  let stations: Station[] = [];
  let camRail: CatmullRomCurve3 | null = null;
  let aimRail: CatmullRomCurve3 | null = null;
  let assemblyKeys: string[] = [];

  function compile(pose: Pose): Station {
    const [x, y, z] = pose.subject.rot;
    return {
      pose,
      quat: new Quaternion().setFromEuler(new Euler(x * DEG, y * DEG, z * DEG)),
      tint: new Color(pose.env.tint),
    };
  }

  function segment(chapter: number) {
    const last = stations.length - 1;
    const c = MathUtils.clamp(chapter, 0, last);
    const i = Math.min(Math.floor(c), Math.max(0, last - 1));
    return { a: stations[i]!, b: stations[Math.min(i + 1, last)]!, t: c - i, c, ia: i, ib: Math.min(i + 1, last) };
  }

  return {
    get count() {
      return stations.length;
    },

    build(bucket, keys) {
      const table = tableFor(set, bucket);
      const fallback = Object.values(table)[0];
      if (!fallback) throw new Error('pose table is empty');
      let prev: Pose = fallback;
      stations = (keys.length > 0 ? keys : [Object.keys(table)[0]!]).map((key) => {
        const pose = table[key];
        if (!pose) onMissing?.(key);
        prev = pose ?? prev;
        return compile(prev);
      });
      const names = new Set<string>();
      for (const s of stations) for (const k of Object.keys(s.pose.assembly)) names.add(k);
      assemblyKeys = [...names];
      if (stations.length >= 2) {
        camRail = new CatmullRomCurve3(stations.map((s) => new Vector3(...s.pose.cam)), false, 'centripetal');
        aimRail = new CatmullRomCurve3(stations.map((s) => new Vector3(...s.pose.aim)), false, 'centripetal');
      } else {
        camRail = aimRail = null;
      }
    },

    evaluate(subjectChapter, cameraChapter, derivedVFov, out, zones) {
      if (stations.length === 0) return out;
      const last = stations.length - 1;

      // Camera: rails and camera-side scalars on the camera follower.
      const cs = segment(cameraChapter);
      if (camRail && aimRail) {
        const u = cs.c / last;
        camRail.getPoint(u, out.cam);
        aimRail.getPoint(u, out.aim);
      } else {
        out.cam.set(...cs.a.pose.cam);
        out.aim.set(...cs.a.pose.aim);
      }
      out.vFov = MathUtils.lerp(cs.a.pose.vFov ?? derivedVFov, cs.b.pose.vFov ?? derivedVFov, cs.t);
      const sa = zones?.[cs.ia] ?? cs.a.pose.safe;
      const sb = zones?.[cs.ib] ?? cs.b.pose.safe;
      out.safe.x = MathUtils.lerp(sa.x, sb.x, cs.t);
      out.safe.y = MathUtils.lerp(sa.y, sb.y, cs.t);
      out.safe.w = MathUtils.lerp(sa.w, sb.w, cs.t);
      out.safe.h = MathUtils.lerp(sa.h, sb.h, cs.t);

      // Subject: everything else on the subject follower.
      const { a, b, t } = segment(subjectChapter);
      const pa = a.pose.subject;
      const pb = b.pose.subject;
      out.pos.set(
        MathUtils.lerp(pa.pos[0], pb.pos[0], t),
        MathUtils.lerp(pa.pos[1], pb.pos[1], t),
        MathUtils.lerp(pa.pos[2], pb.pos[2], t),
      );
      out.quat.slerpQuaternions(a.quat, b.quat, t);
      out.scale = MathUtils.lerp(pa.scale, pb.scale, t);
      out.radius = MathUtils.lerp(a.pose.radius, b.pose.radius, t);
      out.extentX = MathUtils.lerp(a.pose.extent?.x ?? a.pose.radius, b.pose.extent?.x ?? b.pose.radius, t);
      out.extentY = MathUtils.lerp(a.pose.extent?.y ?? a.pose.radius, b.pose.extent?.y ?? b.pose.radius, t);
      for (let i = 0; i < assemblyKeys.length; i++) {
        const k = assemblyKeys[i]!;
        out.assembly[k] = MathUtils.lerp(a.pose.assembly[k] ?? 0, b.pose.assembly[k] ?? 0, t);
      }
      out.envYaw = MathUtils.lerp(a.pose.env.yaw, b.pose.env.yaw, t);
      out.tint.copy(a.tint).lerp(b.tint, t);
      return out;
    },
  };
}
