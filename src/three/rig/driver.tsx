import { useThree } from '@react-three/fiber';
import { type RefObject, useEffect, useRef } from 'react';
import type { Group, HemisphereLight, PerspectiveCamera } from 'three';
import { onFrame } from '@/lib/clock';
import { stageDevTools, type LiveTier } from '@/lib/gpu-tier';
import { onStationsChange, scroll } from '@/lib/scroll-store';
import { bucketFor, stage, type Bucket, type Rect } from '@/lib/stage-store';
import type { Direction } from '@/three/direction';
import { createFollowers } from '@/three/rig/follower';
import { applyFraming, derivedVFov, projectBounds } from '@/three/rig/framing';
import { createPerfGuard } from '@/three/rig/perf-guard';
import { createPoseEvaluator } from '@/three/rig/pose-eval';
import { rig } from '@/three/rig/rig-state';
import { createSecondary } from '@/three/rig/secondary';
import { createStageFade, REVEAL_IN } from '@/three/rig/stage-fade';
import { followZones } from '@/three/rig/zone-follow';

/**
 * The frame driver: the stage's only per-frame code outside the direction's own
 * useFrame callbacks. Registered on the one clock (`src/lib/clock.ts`) once the
 * scene's programs have compiled, it runs, in this order, every tick:
 *
 *   followers -> fade -> [if a station is in view and the tab is visible]
 *   pose -> secondary -> framing -> advance (useFrame + render) -> stats
 *
 * It allocates nothing per frame. React never re-renders at frame rate.
 */
export interface DriverEvents {
  onReady(): void;
  onDecline(): void;
  onFail(): void;
  /** The follower came to rest at a station: re-bake anything baked. */
  onSettled(): void;
}

const MAX_DT = 1 / 20;
/** Opacity strings, so a fade never builds a string per frame. */
const OPACITY = Array.from({ length: 101 }, (_, i) => String(i / 100));

export function Driver({
  direction,
  subject,
  secondary: secondaryRef,
  ground,
  fill,
  tier,
  fine,
  events,
}: {
  direction: Direction;
  /** Posed group (position, rotation, scale), its inner secondary-motion group, the shadow group and the fill light. */
  subject: RefObject<Group | null>;
  secondary: RefObject<Group | null>;
  ground: RefObject<Group | null>;
  fill: RefObject<HemisphereLight | null>;
  tier: LiveTier;
  fine: boolean;
  events: DriverEvents;
}) {
  const get = useThree((s) => s.get);
  const size = useThree((s) => s.size);
  const live = useRef({ tier, events });

  useEffect(() => {
    live.current = { tier, events };
  }, [tier, events]);

  useEffect(() => {
    stage.stats.resizes++;
  }, [size.width, size.height]);

  useEffect(() => {
    const { gl, scene, camera: cam, advance } = get();
    const camera = cam as PerspectiveCamera;
    const fade = createStageFade();
    const followers = createFollowers(fade);
    const evaluator = createPoseEvaluator(direction.poses, (key) => {
      if (stageDevTools) console.warn(`[stage] no pose for station "${key}" in ${direction.id}`);
    });
    const secondary = createSecondary();
    const guard = createPerfGuard();
    const stats = stage.stats;
    const canvas = gl.domElement;

    let bucket: Bucket | null = null;
    let stageTime = 0;
    let revealed = false;
    let moving = false;
    let opacityIndex = -1;
    let stopFrame: (() => void) | null = null;
    let cancelled = false;

    const rebuild = (b: Bucket) => {
      bucket = b;
      evaluator.build(b, scroll.keys);
      rig.keys = scroll.keys;
    };
    const offStations = onStationsChange(() => bucket && rebuild(bucket));

    const onPointer = (e: PointerEvent) =>
      secondary.setPointer((e.clientX / window.innerWidth) * 2 - 1, 1 - (e.clientY / window.innerHeight) * 2);
    if (fine) window.addEventListener('pointermove', onPointer, { passive: true });

    // Each station's zone where it is NOW: its at-rest place moved by how far the page has
    // scrolled from that station's centre. Canvas fractions. Reused; resized only when the
    // number of stations changes.
    const nowZones: (Rect | null)[] = [];
    const liveRects: Rect[] = [];
    function liveZones(width: number, height: number) {
      const zones = scroll.zones;
      while (liveRects.length < zones.length) liveRects.push({ x: 0, y: 0, w: 0, h: 0 });
      nowZones.length = zones.length;
      for (let i = 0; i < zones.length; i++) {
        const z = zones[i];
        if (!z) {
          nowZones[i] = null;
          continue;
        }
        const r = liveRects[i]!;
        r.x = z.x / width;
        r.y = (z.y - (scroll.view - (scroll.centres[i] ?? 0))) / height;
        r.w = z.w / width;
        r.h = z.h / height;
        nowZones[i] = r;
      }
      return nowZones;
    }

    function pose(dt: number, subjectChapter: number, cameraChapter: number) {
      const { width, height } = get().size;
      const b = bucketFor(width, height);
      if (b !== bucket) rebuild(b);
      const p = evaluator.evaluate(subjectChapter, cameraChapter, derivedVFov(width / Math.max(1, height)), rig.pose, liveZones(width, height));
      // Frame where the zones are now, following the one on screen (zone-follow.ts).
      followZones(nowZones, cameraChapter, direction.travel ?? 1, p.safe);
      const s = subject.current;
      const g = ground.current;
      const sec = secondaryRef.current;
      if (s) {
        s.position.copy(p.pos);
        s.quaternion.copy(p.quat);
        s.scale.setScalar(p.scale);
      }
      if (g) {
        g.position.copy(p.pos);
        g.scale.setScalar(p.scale);
      }
      const o = secondary.step(dt, stageTime, scroll.delta, p.radius, fine, stage.reducedMotion);
      if (sec) {
        sec.rotation.set(o.rotX, o.rotY, 0);
        sec.position.y = o.offsetY;
      }
      scene.environmentRotation.y = p.envYaw + o.envYaw;
      fill.current?.color.copy(p.tint);
      applyFraming(camera, p, width, height);
      rig.chapter = subjectChapter;
      rig.time = stageTime;
      rig.reducedMotion = stage.reducedMotion;
    }

    /** First frame or a restored scroll position: no glide (reduced motion: the nearest station). */
    function snap() {
      const at = stage.reducedMotion ? Math.round(scroll.target) : scroll.target;
      followers.snap(at);
      rig.chapter = at;
      scroll.snap = false;
    }

    function frame(_time: number, rawDt: number) {
      const dt = Math.min(Math.max(rawDt, 0), MAX_DT);
      if (scroll.snap) snap();
      const f = followers.step(dt, scroll.target, bucket ?? 'wide', stage.reducedMotion);

      const opacity = fade.step(dt);
      const oi = Math.round(opacity * 100);
      if (oi !== opacityIndex) {
        opacityIndex = oi;
        canvas.style.opacity = OPACITY[oi]!;
      }

      stats.subject = f.subject;
      stats.camera = f.camera;
      stats.target = scroll.target;
      stats.speed = f.speed;
      stats.cap = f.cap;
      stats.opacity = opacity;
      stats.cuts = fade.cuts;

      const render = stage.inView && !document.hidden;
      const verdict = guard.sample(Math.min(rawDt, 1), render, live.current.tier);
      if (verdict === 'decline') {
        guard.reset();
        live.current.events.onDecline();
      } else if (verdict === 'fail') live.current.events.onFail();
      if (!render) return;

      stageTime += dt;
      pose(dt, f.subject, f.camera);
      advance(stageTime);

      const info = gl.info;
      stats.frames++;
      stats.fps = guard.fps;
      stats.calls = info.render.calls;
      stats.triangles = info.render.triangles;
      stats.programs = info.programs?.length ?? 0;
      stats.geometries = info.memory.geometries;
      stats.textures = info.memory.textures;
      stats.safe.x = rig.pose.safe.x;
      stats.safe.y = rig.pose.safe.y;
      stats.safe.w = rig.pose.safe.w;
      stats.safe.h = rig.pose.safe.h;
      projectBounds(camera, rig.pose, stats.bounds);

      if (!revealed) {
        revealed = true;
        fade.release(REVEAL_IN);
        live.current.events.onReady();
      }
      // Settle: re-bake baked shadows once the subject has come to rest at a station.
      const resting = Math.abs(f.speed) < 0.02 && Math.abs(scroll.target - f.subject) < 0.01;
      if (moving && resting) live.current.events.onSettled();
      moving = moving ? !resting : Math.abs(f.speed) > 0.1;
    }

    // Pose the first frame, compile every program, then start ticking (compile before reveal).
    snap();
    pose(0, rig.chapter, rig.chapter);
    void gl
      .compileAsync(scene, camera)
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) stopFrame = onFrame(frame, 10);
      });

    return () => {
      cancelled = true;
      stopFrame?.();
      offStations();
      if (fine) window.removeEventListener('pointermove', onPointer);
    };
  }, [get, direction, subject, secondaryRef, ground, fill, fine]);

  return null;
}
