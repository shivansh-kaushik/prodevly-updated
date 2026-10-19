import { describe, expect, it } from 'vitest';
import { keycapGeometry, type KeycapUserData } from '@/three/directions/keycap/keycap-geometry';

describe('keycapGeometry', () => {
  for (const [u, h] of [
    [1, 0.6],
    [2.25, 0.6],
    [6.25, 0.5],
    [1, 0.8],
  ] as const) {
    it(`builds a closed, finite, upward-facing cap of ${u}u x ${h}`, () => {
      const g = keycapGeometry({ u, h });
      const pos = g.attributes.position!;
      const idx = g.index!.array;
      for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i])).toBe(true);
      for (let i = 0; i < idx.length; i++) expect(idx[i]!).toBeLessThan(pos.count);
      g.computeBoundingBox();
      const box = g.boundingBox!;
      expect(box.min.y).toBeCloseTo(0, 5);
      expect(box.max.y).toBeCloseTo(h, 5);
      expect(box.max.x - box.min.x).toBeCloseTo(u - 0.06, 3);
      // The normal at the top centre points up.
      const n = g.attributes.normal!;
      expect(n.getY(pos.count - 1)).toBeGreaterThan(0.9);
      const ud = g.userData as KeycapUserData;
      expect(ud.print.x0).toBeGreaterThan(0);
      expect(ud.print.x1).toBeLessThan(1);
      expect(ud.print.y0).toBeGreaterThan(0);
      expect(ud.print.y1).toBeLessThan(1);
    });
  }

  it('uses fewer vertices at a lower quality tier', () => {
    expect(keycapGeometry({ u: 2.25, segments: 0.5 }).attributes.position!.count).toBeLessThan(keycapGeometry({ u: 2.25, segments: 1 }).attributes.position!.count);
  });
});
