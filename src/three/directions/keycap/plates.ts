import { CAST, ART, CMD, ENTER, ESC, FN, OPT, SHIFT, SPACE, TAB } from '@/three/directions/keycap/cast';

/**
 * The keyboard plates of the pricing chapter: one per plan, growing in size. This
 * file has no three import, so the pricing cards can size their columns from the
 * same numbers without pulling three.js into the page's first chunk.
 */
/** Plates, small to large: rows back to front, caps left to right. */
const PLATE_PLAN: Record<number, number[][][]> = {
  1: [[[SHIFT, ENTER, OPT], [SPACE]]],
  2: [[[TAB, CMD], [ART]], [[SHIFT, ENTER, OPT], [SPACE]]],
  3: [[[ESC, FN]], [[TAB, CMD], [ART]], [[SHIFT, ENTER, OPT], [SPACE]]],
  4: [[[ESC]], [[FN, TAB]], [[CMD, OPT], [ART]], [[SHIFT, ENTER], [SPACE]]],
};
export const PLATE_TOP = 0.34;
export const ROW_GAP = 0.12;
export const ROW_PITCH = 1.05;

export function platePlan(plans: number) {
  const n = Math.max(1, Math.min(4, plans));
  return PLATE_PLAN[n]!.map((rows) => {
    const widths = rows.map((row) => row.reduce((a, c) => a + CAST[c]!.u, 0) + ROW_GAP * (row.length - 1));
    return { rows, w: Math.max(...widths) + 0.6, d: rows.length * ROW_PITCH + 0.4 };
  });
}


/** Plate sizes for the geometry, for `plans` plates (small to large). */
export function plateSizes(plans: number): Array<{ w: number; d: number }> {
  return platePlan(plans).map(({ w, d }) => ({ w, d }));
}
