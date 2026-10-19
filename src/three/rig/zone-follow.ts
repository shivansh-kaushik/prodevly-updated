import type { Rect } from '@/lib/stage-store';

/**
 * Where the subject is framed, so it moves WITH the page.
 *
 * `zones` are the stations' zones where they are now (canvas fractions; they scroll with
 * their sections; null for a station without one). The subject follows whichever zone is
 * on screen: as one section scrolls away the subject goes with it, and it arrives inside
 * the next zone as that one scrolls in. While two zones are partly on screen it is placed
 * between them, weighted by how much of each shows, and drawn smaller (`travel`), so it
 * passes along the seam between the two sections instead of sliding under their copy.
 * While no zone is on screen nothing can be seen, so it takes the station nearest the
 * camera chapter.
 *
 * The choice depends on what is on screen only, never on which chapter the followers
 * have crossed, so the frame moves continuously with the scroll. Visibility is eased,
 * so the blend has no kink as a zone's edge crosses the screen edge.
 *
 * Returns false (leaving `out` alone) when there is no zone to follow. Allocates nothing.
 */
const visible = (r: Rect) => {
  const top = Math.max(0, r.y);
  const bottom = Math.min(1, r.y + r.h);
  const v = r.h > 0 ? Math.max(0, bottom - top) / r.h : 0;
  return v * v * (3 - 2 * v);
};

export function followZones(zones: readonly (Rect | null)[], chapter: number, travel: number, out: Rect): boolean {
  let a = -1;
  let b = -1;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (!z) continue;
    const v = visible(z);
    if (v <= 0) continue;
    if (v > va) {
      b = a;
      vb = va;
      a = i;
      va = v;
    } else if (v > vb) {
      b = i;
      vb = v;
    }
  }
  if (a < 0) {
    // Nothing on screen: the nearest station that has a zone.
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < zones.length; i++) {
      const d = Math.abs(i - chapter);
      if (zones[i] && d < bestD) {
        best = i;
        bestD = d;
      }
    }
    if (best < 0) return false;
    const z = zones[best]!;
    out.x = z.x;
    out.y = z.y;
    out.w = z.w;
    out.h = z.h;
    return true;
  }
  const za = zones[a]!;
  const zb = b >= 0 ? zones[b]! : za;
  const w = b >= 0 ? vb / (va + vb) : 0;
  out.x = za.x + (zb.x - za.x) * w;
  out.y = za.y + (zb.y - za.y) * w;
  out.w = za.w + (zb.w - za.w) * w;
  out.h = za.h + (zb.h - za.h) * w;
  // Smaller while between two zones (w is at most 0.5: a is the more visible one).
  const f = 1 - (1 - travel) * Math.sin(Math.PI * w);
  out.x += (out.w * (1 - f)) / 2;
  out.y += (out.h * (1 - f)) / 2;
  out.w *= f;
  out.h *= f;
  return true;
}
