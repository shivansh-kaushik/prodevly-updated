/**
 * Quality tiers (docs/plan/engineering.html section 5).
 *
 * The tier is chosen BEFORE three.js is downloaded, so tier 0 never requests it.
 * Tiers change DPR, geometry detail, environment size and shadows. They never
 * change whether the page exists: tier 0 is the full page with posters.
 *
 * No three import here; this ships in the initial route chunk.
 */
export type Tier = 0 | 1 | 2 | 3;
export type LiveTier = Exclude<Tier, 0>;

export type ShadowMode = 'blob' | 'baked' | 'live';

export interface Quality {
  /** Fixed device-pixel-ratio cap. Never changes while scrolling. */
  dpr: number;
  /** Multiplier on geometry segment counts. */
  segments: number;
  /** Cube resolution of the Lightformer environment, rendered once. */
  envResolution: number;
  /** blob: a soft texture; baked: ContactShadows once per station; live: every frame. */
  shadows: ShadowMode;
  /** Ticker cap in fps; 0 means uncapped. */
  fpsCap: number;
  /** Decorative instances and the glass piece's iridescence and sheen. */
  extras: boolean;
}

export const QUALITY: Record<LiveTier, Quality> = {
  1: { dpr: 1.25, segments: 0.5, envResolution: 64, shadows: 'blob', fpsCap: 60, extras: false },
  2: { dpr: 1.5, segments: 0.75, envResolution: 128, shadows: 'baked', fpsCap: 60, extras: true },
  3: { dpr: 2, segments: 1, envResolution: 256, shadows: 'live', fpsCap: 0, extras: true },
};

export interface TierSignals {
  webgl2: boolean;
  saveData: boolean;
  /** navigator.deviceMemory in GB, when the browser exposes it. */
  deviceMemory?: number;
  /** detect-gpu benchmark tier, or null when the benchmark could not run. */
  gpuTier: number | null;
  isMobile: boolean;
  coarsePointer: boolean;
  /** WebGL contexts lost earlier in this visit. */
  contextLosses: number;
}

export interface TierDecision {
  tier: Tier;
  reason: string;
}

/** Pure decision table, unit-tested. */
export function tierFromSignals(s: TierSignals): TierDecision {
  if (!s.webgl2) return { tier: 0, reason: 'no WebGL2' };
  if (s.saveData) return { tier: 0, reason: 'Save-Data' };
  if (s.contextLosses >= 2) return { tier: 0, reason: 'context lost twice' };
  if (s.gpuTier === 0) return { tier: 0, reason: 'GPU benchmark tier 0' };

  // No benchmark (fetch failed or timed out): guess from the pointer, conservatively.
  let tier = (s.gpuTier === null ? (s.coarsePointer ? 1 : 2) : Math.min(3, Math.max(1, s.gpuTier))) as LiveTier;
  let reason = s.gpuTier === null ? 'no benchmark' : `GPU tier ${s.gpuTier}`;
  if ((s.isMobile || s.coarsePointer) && tier > 2) {
    tier = 2;
    reason += ', mobile cap';
  }
  if (s.deviceMemory !== undefined && s.deviceMemory <= 4 && tier > 1) {
    tier = 1;
    reason += `, ${s.deviceMemory} GB memory`;
  }
  return { tier, reason };
}

/** `?tier=` and `?debug=stage` work in dev and in preview builds that opt in. */
export const stageDevTools =
  process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_STAGE_DEV === '1';

export function parseTierOverride(search: string): Tier | null {
  if (!stageDevTools) return null;
  const raw = new URLSearchParams(search).get('tier');
  if (raw === null || !/^[0-3]$/.test(raw)) return null;
  return Number(raw) as Tier;
}

const BENCHMARK_TIMEOUT_MS = 2500;

interface NavigatorHints {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

/** Browser-only. Probes WebGL2, releases the probe context, runs the self-hosted benchmark. */
export async function detectTier(contextLosses = 0): Promise<TierDecision> {
  const override = parseTierOverride(window.location.search);
  if (override !== null) return { tier: override, reason: '?tier override' };

  const nav = navigator as Navigator & NavigatorHints;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  let gpuTier: number | null = null;
  let isMobile = false;

  try {
    if (gl) {
      const { getGPUTier } = await import('@pmndrs/detect-gpu');
      const result = await Promise.race([
        getGPUTier({ glContext: gl, benchmarksURL: '/gpu-benchmarks' }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), BENCHMARK_TIMEOUT_MS)),
      ]);
      if (result && result.type !== 'BENCHMARK_FETCH_FAILED') {
        gpuTier = result.tier;
        isMobile = Boolean(result.isMobile);
      }
    }
  } catch {
    gpuTier = null;
  } finally {
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }

  return tierFromSignals({
    webgl2: Boolean(gl),
    saveData: Boolean(nav.connection?.saveData),
    deviceMemory: nav.deviceMemory,
    gpuTier,
    isMobile,
    coarsePointer,
    contextLosses,
  });
}
