import { describe, expect, it } from 'vitest';
import { LAYOUT_NAMES, LAYOUT_OF_STATION } from '@/three/directions/keycap/cast';
import { buildLayouts } from '@/three/directions/keycap/layouts';
import { buildPoses } from '@/three/directions/keycap/poses';

const STATIONS = Object.keys(LAYOUT_OF_STATION);

describe('keycap poses', () => {
  for (const [label, data] of [
    ['reference content', { projects: 4, plans: 3, people: ['A', 'B', 'C', 'D'] }],
    ['one of each', { projects: 1, plans: 1, people: ['A'] }],
    ['the most', { projects: 6, plans: 4, people: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] }],
  ] as const) {
    it(`has a finite pose for every station in both buckets (${label})`, () => {
      const set = buildPoses(buildLayouts({ ...data, people: [...data.people] }));
      for (const table of [set.tall, set.wide])
        for (const station of STATIONS) {
          const p = table[station]!;
          expect(p).toBeDefined();
          expect([...p.cam, ...p.aim, p.radius, p.safe.x, p.safe.y, p.safe.w, p.safe.h].every(Number.isFinite)).toBe(true);
          expect(p.radius).toBeGreaterThan(0);
          expect(p.safe.w).toBeGreaterThan(0);
          expect(p.safe.h).toBeGreaterThan(0);
          expect(p.vFov).toBe(30);
        }
    });
  }

  it('gives each station exactly one layout weight of 1, and a pivot on the ground', () => {
    const set = buildPoses(buildLayouts({ projects: 4, plans: 3, people: ['A'] }));
    for (const station of STATIONS) {
      const w = set.wide[station]!.assembly;
      expect(LAYOUT_NAMES.map((n) => w[n]).reduce((a, b) => a! + b!, 0)).toBe(1);
      expect(w[LAYOUT_OF_STATION[station]!]).toBe(1);
      expect(set.wide[station]!.subject.pos[1]).toBe(0);
    }
  });

  it('keeps the totem inside the screen and out of the copy: safe rects stay on screen', () => {
    const set = buildPoses(buildLayouts({ projects: 4, plans: 3, people: ['A'] }));
    for (const table of [set.tall, set.wide])
      for (const station of STATIONS) {
        const { x, y, w, h } = table[station]!.safe;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + w).toBeLessThanOrEqual(1);
        expect(y + h).toBeLessThanOrEqual(1);
      }
  });

  it('frames fewer pieces closer and more pieces farther (the radius follows the content)', () => {
    const few = buildPoses(buildLayouts({ projects: 1, plans: 1, people: ['A'] })).wide;
    const many = buildPoses(buildLayouts({ projects: 6, plans: 4, people: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] })).wide;
    for (const station of ['work', 'pricing', 'team']) expect(few[station]!.radius).toBeLessThan(many[station]!.radius);
  });
});
