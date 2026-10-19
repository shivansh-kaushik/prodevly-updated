import { CAST, ART, CMD, ENTER, ESC, FN, OPT, SHIFT, SPACE, TAB } from '@/three/directions/keycap/cast';
import { P, parked, type PlateSlot, type Raw } from '@/three/directions/keycap/layout-core';
import { PLATE_TOP, ROW_GAP, ROW_PITCH, platePlan } from '@/three/directions/keycap/plates';

/* ------------------------------------------------------------------ data-driven layouts */
/** Common lean of a record sleeve in its bin. */
const SLEEVE = 72;
/** Which caps become sleeves, most wanted first, and the left-to-right order they stand in. */
const SLEEVE_PRIORITY = [SHIFT, ENTER, TAB, CMD, OPT, ESC];
const SLEEVE_ORDER = [TAB, SHIFT, ENTER, CMD, OPT, ESC];
const SLEEVE_GAP = 0.18;
const SLEEVE_PITCH = 1.35;

/** The cap that is project `p`'s sleeve (project order = left to right, or front to back on a phone). */
export function sleeveCaps(projects: number): number[] {
  const chosen = SLEEVE_PRIORITY.slice(0, Math.max(0, Math.min(SLEEVE_PRIORITY.length, projects)));
  return SLEEVE_ORDER.filter((c) => chosen.includes(c));
}

export function shelf(tall: boolean, projects: number): Raw[] {
  const out: Raw[] = CAST.map((_, i) => parked(i, tall));
  const caps = sleeveCaps(projects);
  const n = caps.length;
  if (n === 0) return out;
  if (tall) {
    // A record crate: sleeves one behind the other, project 0 at the front, the bar as the lip.
    const zc = ((n - 1) / 2) * SLEEVE_PITCH * 0.15;
    caps.forEach((cap, p) => {
      out[cap] = P((p - (n - 1) / 2) * 0.31, 0, zc + ((n - 1) / 2 - p) * SLEEVE_PITCH, SLEEVE);
    });
    out[SPACE] = P(-0.75, 0, zc + ((n - 1) / 2) * SLEEVE_PITCH + 1.25);
    return out;
  }
  // One shelf: sleeves on a single line, all leaning back against the spacebar lip.
  const widths = caps.map((c) => CAST[c]!.u);
  const total = widths.reduce((a, b) => a + b, 0) + SLEEVE_GAP * (n - 1);
  let x = -total / 2;
  caps.forEach((cap, p) => {
    const w = widths[p]!;
    out[cap] = P(x + w / 2, 0, 0, SLEEVE);
    x += w + SLEEVE_GAP;
  });
  out[SPACE] = P(0, 0, 1.2);
  return out;
}

export function plates(tall: boolean, plans: number): { raws: Raw[]; plates: PlateSlot[] } {
  const raws: Raw[] = CAST.map((_, i) => parked(i, tall));
  const plan = platePlan(plans);
  const gap = 0.8;
  const slots: PlateSlot[] = [];
  if (tall) {
    // Stacked down the screen: small at the back, large at the front.
    const total = plan.reduce((a, p) => a + p.d, 0) + gap * (plan.length - 1);
    let z = -total / 2;
    for (const p of plan) {
      slots.push({ w: p.w, d: p.d, x: 0, z: z + p.d / 2 });
      z += p.d + gap;
    }
  } else {
    // Side by side, growing to the right, sharing one front edge.
    const total = plan.reduce((a, p) => a + p.w, 0) + gap * (plan.length - 1);
    let x = -total / 2;
    for (const p of plan) {
      slots.push({ w: p.w, d: p.d, x: x + p.w / 2, z: 1.25 - p.d / 2 });
      x += p.w + gap;
    }
  }
  plan.forEach((p, k) => {
    const slot = slots[k]!;
    p.rows.forEach((row, r) => {
      const rowW = row.reduce((a, c) => a + CAST[c]!.u, 0) + ROW_GAP * (row.length - 1);
      let x = slot.x - rowW / 2;
      const z = slot.z + (r - (p.rows.length - 1) / 2) * ROW_PITCH;
      for (const c of row) {
        const u = CAST[c]!.u;
        raws[c] = P(x + u / 2, PLATE_TOP, z);
        x += u + ROW_GAP;
      }
    });
  });
  return { raws, plates: slots };
}

/** Caps that stand in the team row, in the order people take them. */
const PEOPLE_CAPS = [ESC, CMD, OPT, FN, TAB, SHIFT, ENTER];
export const MAX_ROW_PEOPLE = PEOPLE_CAPS.length;
const ROW_SPACING = 0.24;

/** The cap that carries person `q`'s initial: the q-th non-artisan cap in row order. */
export function personCaps(people: number): number[] {
  return PEOPLE_CAPS.slice(0, Math.max(0, Math.min(MAX_ROW_PEOPLE, people)));
}

export function row(tall: boolean, people: number): { raws: Raw[]; barScaleX: number } {
  const raws: Raw[] = CAST.map((_, i) => parked(i, tall));
  const caps = personCaps(people);
  // The artisan stands in the middle of the row (it carries no initial: it is the crown).
  const seq = [...caps];
  if (seq.length > 0) seq.splice(Math.ceil(seq.length / 2), 0, ART);
  const total = seq.reduce((a, c) => a + CAST[c]!.u, 0) + ROW_SPACING * Math.max(0, seq.length - 1);
  const barScaleX = Math.max(1, (total + 1) / CAST[SPACE]!.u);
  let x = -total / 2;
  for (const c of seq) {
    const u = CAST[c]!.u;
    raws[c] = P(x + u / 2, 0.5, 0.02, 0, 0, 0, 1, 0);
    x += u + ROW_SPACING;
  }
  raws[SPACE] = P(0, 0, 0);
  return { raws, barScaleX };
}
