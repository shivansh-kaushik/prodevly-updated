import type { StageData } from '@/lib/stage-data';
import type { Direction } from '@/three/direction';
import { KeycapLightformers } from '@/three/directions/keycap/lightformers';
import { buildLayouts } from '@/three/directions/keycap/layouts';
import { buildPoses } from '@/three/directions/keycap/poses';
import { createSubject } from '@/three/directions/keycap/subject';

/**
 * Keycap Colorway (docs/plan/directions.json, id `keys`): a cairn of oversized
 * sculpted keycaps that unstacks into a key cluster, stands up as record sleeves,
 * settles onto keyboard plates, lines up as a row of makers' keys and ends as one
 * giant Enter. Built per page because work, pricing and team size themselves from
 * the records on the page.
 */
export function createKeycapDirection(data: StageData): Direction {
  const layouts = buildLayouts(data);
  return {
    id: 'keycap',
    poses: buildPoses(layouts),
    Subject: createSubject(data, layouts),
    Lightformers: KeycapLightformers,
    // The caps ground themselves: a contact blob under each, and a soft shadow map from the key light.
    shadow: null,
    shadowMap: true,
    fill: 0.15,
    travel: 0.5,
  };
}
