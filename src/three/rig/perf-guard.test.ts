import { describe, expect, it } from 'vitest';
import { createPerfGuard } from './perf-guard';

function feed(guard: ReturnType<typeof createPerfGuard>, fps: number, seconds: number, tier: number, rendered = true) {
  const verdicts: string[] = [];
  for (let i = 0; i < Math.round(fps * seconds); i++) {
    const v = guard.sample(1 / fps, rendered, tier);
    if (v) verdicts.push(v);
  }
  return verdicts;
}

describe('perf guard', () => {
  it('stays quiet at 60 fps', () => {
    expect(feed(createPerfGuard(), 60, 10, 3)).toEqual([]);
  });

  it('declines once after 3 s below 45 fps', () => {
    const g = createPerfGuard();
    expect(feed(g, 35, 2.4, 3)).toEqual([]);
    expect(feed(g, 35, 1, 3)).toEqual(['decline']);
  });

  it('never declines below tier 1; fails after 5 s under 30 fps there', () => {
    const g = createPerfGuard();
    expect(feed(g, 20, 4.4, 1)).toEqual([]);
    // Windows close on the frame that crosses 0.5 s, so the 5 s mark lands one window later.
    expect(feed(g, 20, 1.5, 1)).toEqual(['fail']);
  });

  it('tolerates iOS Low Power Mode at 30 Hz on tier 1', () => {
    expect(feed(createPerfGuard(), 29, 20, 1)).toEqual([]);
  });

  it('a pause restarts the window, so resuming is never read as slow', () => {
    const g = createPerfGuard();
    feed(g, 60, 1, 3);
    g.sample(30, false, 3); // 30 s with nothing rendered
    expect(feed(g, 60, 5, 3)).toEqual([]);
  });
});
