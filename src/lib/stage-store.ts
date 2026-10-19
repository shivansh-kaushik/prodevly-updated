import type { Tier } from '@/lib/gpu-tier';

/**
 * Shared state between the DOM side (StageMount, the debug overlay) and the 3D
 * chunk. Like the scroll store it is a plain mutable module: the frame loop writes
 * `stats` without allocating and without React; only the rare changes (tier,
 * status, in-view) go through `setStage` and notify subscribers.
 *
 * No three import, so the initial route chunk can read it.
 */
export type Bucket = 'tall' | 'mid' | 'wide';

/** Aspect buckets are chosen by aspect ratio, never by user agent. */
export function bucketFor(width: number, height: number): Bucket {
  const aspect = width / Math.max(1, height);
  return aspect < 0.8 ? 'tall' : aspect < 1.35 ? 'mid' : 'wide';
}

/**
 * detecting: choosing a tier. off: tier 0, posters only. loading: the 3D chunk is
 * on its way. ready: the canvas has drawn and faded in. lost: the WebGL context was
 * lost and the poster shows. failed: too slow even at tier 1, posters for the visit.
 */
export type StageStatus = 'detecting' | 'off' | 'loading' | 'ready' | 'lost' | 'failed';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StageStats {
  fps: number;
  calls: number;
  triangles: number;
  programs: number;
  geometries: number;
  textures: number;
  /** Rendered chapter of the subject and camera followers, and the target. */
  subject: number;
  camera: number;
  target: number;
  /** Follower speed and the cap applied in the same step, chapters per second. */
  speed: number;
  cap: number;
  opacity: number;
  /** Fade-cuts since load; rendered GPU frames since load; canvas resizes since load. */
  cuts: number;
  frames: number;
  resizes: number;
  /** Safe rect and projected subject bounds, in viewport fractions (top-left origin). */
  safe: Rect;
  bounds: Rect;
}

export interface StageState {
  tier: Tier | null;
  reason: string;
  status: StageStatus;
  /** WebGL contexts lost in this visit. A second loss means tier 0 for the visit. */
  losses: number;
  /** Any `[data-chapter]` section intersects the viewport. */
  inView: boolean;
  reducedMotion: boolean;
  stats: StageStats;
  /** Set by the live stage in dev builds, for scripted checks. */
  hooks: { loseContext?: () => void; restoreContext?: () => void; programs?: () => string[] };
}

const rect = (): Rect => ({ x: 0, y: 0, w: 0, h: 0 });

function initialStats(): StageStats {
  return {
    fps: 0,
    calls: 0,
    triangles: 0,
    programs: 0,
    geometries: 0,
    textures: 0,
    subject: 0,
    camera: 0,
    target: 0,
    speed: 0,
    cap: 0,
    opacity: 0,
    cuts: 0,
    frames: 0,
    resizes: 0,
    safe: rect(),
    bounds: rect(),
  };
}

export const stage: StageState = {
  tier: null,
  reason: '',
  status: 'detecting',
  losses: 0,
  inView: true,
  reducedMotion: false,
  stats: initialStats(),
  hooks: {},
};

type Patch = Partial<Pick<StageState, 'tier' | 'reason' | 'status' | 'losses' | 'inView' | 'reducedMotion'>>;
type Listener = (state: StageState) => void;
const listeners = new Set<Listener>();

/** Rare changes only (tier, status, in-view). Never call from the frame loop per frame. */
export function setStage(patch: Patch) {
  let changed = false;
  for (const key of Object.keys(patch) as (keyof Patch)[]) {
    if (stage[key] !== patch[key]) {
      (stage as unknown as Record<string, unknown>)[key] = patch[key];
      changed = true;
    }
  }
  if (changed) listeners.forEach((fn) => fn(stage));
}

export function subscribeStage(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Test helper. */
export function resetStage() {
  stage.tier = null;
  stage.reason = '';
  stage.status = 'detecting';
  stage.losses = 0;
  stage.inView = true;
  stage.reducedMotion = false;
  stage.stats = initialStats();
  stage.hooks = {};
  listeners.clear();
}
