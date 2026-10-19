import { describe, expect, it } from 'vitest';
import { CAST, LAYOUT_NAMES } from '@/three/directions/keycap/cast';
import { buildLayouts, MAX_ROW_PEOPLE, personCaps, sleeveCaps, type Layout } from '@/three/directions/keycap/layouts';
import { plateSizes } from '@/three/directions/keycap/plates';

const finite = (layout: Layout) =>
  layout.slots.every((s) => [s.x, s.y, s.z, s.rx, s.ry, s.rz, s.s, s.sx, s.bw, s.bd].every(Number.isFinite)) &&
  layout.centre.every(Number.isFinite) &&
  Number.isFinite(layout.radius);

describe('keycap layouts', () => {
  it('places all nine caps in every layout, for every count, in both buckets', () => {
    for (let projects = 0; projects <= 6; projects++)
      for (let plans = 0; plans <= 4; plans++)
        for (let people = 0; people <= 8; people++) {
          const set = buildLayouts({ projects, plans, people: Array.from({ length: people }, () => 'A') });
          for (const bucket of [set.tall, set.wide])
            for (const name of LAYOUT_NAMES) {
              const layout = bucket[name];
              expect(layout.slots).toHaveLength(CAST.length);
              expect(finite(layout)).toBe(true);
              expect(layout.radius).toBeGreaterThan(0);
            }
        }
  });

  it('stands one sleeve per project, up to six, each a different cap', () => {
    for (let n = 0; n <= 8; n++) {
      const caps = sleeveCaps(n);
      expect(caps).toHaveLength(Math.min(n, 6));
      expect(new Set(caps).size).toBe(caps.length);
    }
  });

  it('gives each of up to seven people their own cap, never the bar or the resin cap', () => {
    for (let n = 0; n <= 9; n++) {
      const caps = personCaps(n);
      expect(caps).toHaveLength(Math.min(n, MAX_ROW_PEOPLE));
      expect(new Set(caps).size).toBe(caps.length);
      expect(caps).not.toContain(0);
      expect(caps).not.toContain(8);
    }
  });

  it('grows the plates with plan order, one per plan', () => {
    for (let plans = 1; plans <= 4; plans++) {
      const sizes = plateSizes(plans);
      expect(sizes).toHaveLength(plans);
      for (let i = 1; i < sizes.length; i++) {
        expect(sizes[i]!.w * sizes[i]!.d).toBeGreaterThanOrEqual(sizes[i - 1]!.w * sizes[i - 1]!.d);
      }
    }
    const set = buildLayouts({ projects: 1, plans: 3, people: ['A'] });
    expect(set.wide.plates.plates).toHaveLength(3);
    expect(set.tall.plates.plates).toHaveLength(3);
  });

  it('keeps caps that stand on a plate on that plate, above its top', () => {
    const { wide } = buildLayouts({ projects: 1, plans: 3, people: ['A'] });
    for (const slot of wide.plates.slots) {
      if (slot.park) continue;
      expect(slot.ground).toBeCloseTo(0.34, 5);
      expect(wide.plates.plates.some((p) => Math.abs(slot.x - p.x) <= p.w / 2 && Math.abs(slot.z - p.z) <= p.d / 2)).toBe(true);
    }
  });

  it('rests every sleeve on the floor, not through it', () => {
    const { wide, tall } = buildLayouts({ projects: 4, plans: 3, people: ['A'] });
    for (const layout of [wide.shelf, tall.shelf]) for (const slot of layout.slots) expect(slot.y).toBeGreaterThanOrEqual(-1e-6);
  });

  it('parks only the caps a layout does not use', () => {
    const { wide } = buildLayouts({ projects: 2, plans: 3, people: ['A', 'B'] });
    const shelfParked = wide.shelf.slots.filter((s) => s.park).length;
    expect(shelfParked).toBe(CAST.length - 1 - sleeveCaps(2).length); // the bar stays as the lip
    expect(wide.cairn.slots.some((s) => s.park)).toBe(false);
  });
});
