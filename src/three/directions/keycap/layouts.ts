import { Box3, Euler, Matrix4, Vector3 } from 'three';
import type { StageData } from '@/lib/stage-data';
import { CAP_HALF_DEPTH, CAST, capHalfWidth, LAYOUT_NAMES, SPACE } from '@/three/directions/keycap/cast';
import { cairn, cluster, enter } from '@/three/directions/keycap/layout-fixed';
import { plates, row, shelf } from '@/three/directions/keycap/layout-data';
import { solve, type Layout, type Layouts, type LayoutSet, type PlateSlot, type Slot } from '@/three/directions/keycap/layout-core';
import { PLATE_TOP } from '@/three/directions/keycap/plates';

export { MAX_ROW_PEOPLE, personCaps, sleeveCaps } from '@/three/directions/keycap/layout-data';
export type { Layout, Layouts, LayoutSet, PlateSlot, Slot } from '@/three/directions/keycap/layout-core';

const euler = new Euler(0, 0, 0, 'YXZ');
const m4 = new Matrix4();

/* ------------------------------------------------------------------ measure */
const box = new Box3();
const p3 = new Vector3();

/**
 * Bounding sphere of the caps and plates in view, and the corners the frame must hold.
 * `lipless`: leave the bar out of the frame (the shelf's long lip may run off the edge).
 */
function measure(slots: readonly Slot[], plateSlots: readonly PlateSlot[], lipless = false) {
  box.makeEmpty();
  const pts: Vector3[] = [];
  const held: Array<[number, number, number]> = [];
  const core = new Box3();
  slots.forEach((slot, i) => {
    if (slot.park) return;
    const spec = CAST[i]!;
    euler.set(slot.rx, slot.ry, slot.rz, 'YXZ');
    m4.makeRotationFromEuler(euler);
    for (const cx of [-1, 1])
      for (const cy of [0, 1])
        for (const cz of [-1, 1]) {
          p3.set(cx * capHalfWidth(spec) * slot.sx, cy * spec.h, cz * CAP_HALF_DEPTH).applyMatrix4(m4).multiplyScalar(slot.s);
          p3.x += slot.x;
          p3.y += slot.y;
          p3.z += slot.z;
          pts.push(p3.clone());
          box.expandByPoint(p3);
          if (!lipless || i !== SPACE) {
            core.expandByPoint(p3);
            held.push([p3.x, p3.y, p3.z]);
          }
        }
  });
  for (const pl of plateSlots) {
    for (const cx of [-1, 1])
      for (const cy of [0, 1])
        for (const cz of [-1, 1]) {
          p3.set(pl.x + (cx * pl.w) / 2, cy * PLATE_TOP, pl.z + (cz * pl.d) / 2);
          pts.push(p3.clone());
          box.expandByPoint(p3);
          core.expandByPoint(p3);
          held.push([p3.x, p3.y, p3.z]);
        }
  }
  if (pts.length === 0) return { centre: [0, 0.5, 0] as [number, number, number], radius: 3, points: [[0, 0.5, 0]] as Array<[number, number, number]> };
  // On the shelf the frame is centred on the sleeves; the long lip only widens the sphere.
  const c = (core.isEmpty() ? box : core).getCenter(new Vector3());
  let radius = 0;
  for (const pt of pts) radius = Math.max(radius, pt.distanceTo(c));
  return { centre: [c.x, c.y, c.z] as [number, number, number], radius, points: held };
}

function finish(slots: Slot[], plateSlots: PlateSlot[], lipless = false): Layout {
  return { slots, plates: plateSlots, ...measure(slots, plateSlots, lipless) };
}

function buildSet(tall: boolean, data: StageData): LayoutSet {
  const out = {} as LayoutSet;
  const pl = plates(tall, data.plans);
  const rw = row(tall, data.people.length);
  for (const name of LAYOUT_NAMES) {
    switch (name) {
      case 'cairn':
        out[name] = finish(solve(cairn(tall), tall), []);
        break;
      case 'cluster':
        out[name] = finish(solve(cluster(tall), tall), []);
        break;
      case 'shelf':
        out[name] = finish(solve(shelf(tall, data.projects), tall), [], true);
        break;
      case 'plates':
        out[name] = finish(solve(pl.raws, tall), pl.plates);
        break;
      case 'row':
        out[name] = finish(solve(rw.raws, tall, rw.barScaleX), []);
        break;
      case 'enter':
        out[name] = finish(solve(enter(tall), tall), []);
        break;
    }
  }
  return out;
}

export function buildLayouts(data: StageData): Layouts {
  return { tall: buildSet(true, data), wide: buildSet(false, data) };
}

