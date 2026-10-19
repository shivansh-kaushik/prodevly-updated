import { describe, expect, it } from 'vitest';
import { followZones } from './zone-follow';

const out = () => ({ x: 0, y: 0, w: 0, h: 0 });
const zone = (y: number) => ({ x: 0.1, y, w: 0.8, h: 0.4 });
const close = (r: ReturnType<typeof out>, e: ReturnType<typeof out>) => {
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(r[k]).toBeCloseTo(e[k], 9);
};

describe('followZones', () => {
  it('stays in the zone that is on screen, at full size, and moves with it', () => {
    const o = out();
    followZones([zone(0.3), zone(1.6)], 0.4, 0.5, o);
    close(o, zone(0.3));
    followZones([zone(-0.2), zone(1.3)], 0.4, 0.5, o);
    close(o, zone(-0.2));
    followZones([zone(-1.2), zone(0.3)], 0.6, 0.5, o);
    close(o, zone(0.3));
  });

  it('passes between two equally visible zones at the travel size, on the seam', () => {
    const o = out();
    followZones([zone(-0.2), zone(0.8)], 0.5, 0.5, o);
    expect(o.h).toBeCloseTo(0.2, 9);
    expect(o.y + o.h / 2).toBeCloseTo(0.5, 9);
  });

  it('does not depend on the chapter while zones are on screen (no jump when a follower crosses a station)', () => {
    const a = out();
    const b = out();
    followZones([zone(-0.1), zone(0.9), zone(2)], 0.999, 0.5, a);
    followZones([zone(-0.1), zone(0.9), zone(2)], 1.001, 0.5, b);
    close(a, b);
  });

  it('is continuous as the page scrolls through a hand-over', () => {
    let prev: ReturnType<typeof out> | null = null;
    for (let s = 0; s <= 1.2; s += 0.002) {
      const o = out();
      followZones([zone(0.3 - s), zone(1.3 - s)], 0.5, 0.5, o);
      if (prev) expect(Math.abs(o.y - prev.y)).toBeLessThan(0.02);
      prev = o;
    }
  });

  it('takes the nearest station while nothing is on screen, and skips stations without a zone', () => {
    const o = out();
    followZones([zone(-2), null, zone(2)], 0.4, 0.5, o);
    close(o, zone(-2));
    followZones([zone(-2), null, zone(2)], 1.6, 0.5, o);
    close(o, zone(2));
    expect(followZones([null, null], 0, 0.5, out())).toBe(false);
  });
});
