import { describe, expect, it } from 'vitest';
import { QUALITY, tierFromSignals, type TierSignals } from './gpu-tier';

const base: TierSignals = { webgl2: true, saveData: false, gpuTier: 3, isMobile: false, coarsePointer: false, contextLosses: 0 };

describe('tierFromSignals', () => {
  it('gives tier 0 without WebGL2, with Save-Data, after two context losses, or on a tier 0 GPU', () => {
    expect(tierFromSignals({ ...base, webgl2: false }).tier).toBe(0);
    expect(tierFromSignals({ ...base, saveData: true }).tier).toBe(0);
    expect(tierFromSignals({ ...base, contextLosses: 2 }).tier).toBe(0);
    expect(tierFromSignals({ ...base, gpuTier: 0 }).tier).toBe(0);
  });

  it('caps phones and tablets at tier 2 and small-memory devices at tier 1', () => {
    expect(tierFromSignals(base).tier).toBe(3);
    expect(tierFromSignals({ ...base, isMobile: true }).tier).toBe(2);
    expect(tierFromSignals({ ...base, coarsePointer: true }).tier).toBe(2);
    expect(tierFromSignals({ ...base, deviceMemory: 4 }).tier).toBe(1);
    expect(tierFromSignals({ ...base, deviceMemory: 8 }).tier).toBe(3);
  });

  it('guesses conservatively when the benchmark could not run', () => {
    expect(tierFromSignals({ ...base, gpuTier: null }).tier).toBe(2);
    expect(tierFromSignals({ ...base, gpuTier: null, coarsePointer: true }).tier).toBe(1);
  });

  it('keeps the quality table ordered: more tier, more DPR and detail', () => {
    expect(QUALITY[1].dpr).toBeLessThan(QUALITY[2].dpr);
    expect(QUALITY[2].dpr).toBeLessThan(QUALITY[3].dpr);
    expect(QUALITY[1].segments).toBeLessThan(QUALITY[3].segments);
    expect(QUALITY[3].fpsCap).toBe(0);
  });
});
