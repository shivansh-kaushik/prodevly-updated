import { BufferGeometry, Float32BufferAttribute } from 'three';

/**
 * Sculpted keycap: a tapered rounded-rect loft with a rounded top bevel, a
 * cylindrical (Cherry/OEM style) dish curved front to back only, and a small
 * bottom bevel. The dish is a smooth function of z, so wide caps have no diagonal
 * folds; its normals are written analytically. UV0 is a planar top-down projection
 * of the footprint, so the sides land in the plain-colour margin of the legend tile
 * and the top face carries the print. UV1 feeds the PBT grain, UV2 the height AO.
 *
 * Ported from docs/design-previews/previews/keys.js (the visual spec).
 */
export interface KeycapOptions {
  /** Width in key units (1u = 1 world unit). */
  u: number;
  /** Depth in key units. */
  d?: number;
  /** Height. */
  h?: number;
  taperX?: number;
  taperF?: number;
  taperB?: number;
  rBot?: number;
  rTop?: number;
  bevel?: number;
  dish?: number;
  /** Tilt of the top face front to back (a sculpted row profile). */
  tilt?: number;
  /** Multiplier on ring and corner segment counts (quality tier). */
  segments?: number;
}

export interface KeycapUserData {
  hw0: number;
  hd0: number;
  h: number;
  /** Printable rect on the tile, 0..1 fractions (x from the left, y from the top). */
  print: { x0: number; x1: number; y0: number; y1: number };
}

interface Ring {
  hw: number;
  hd: number;
  r: number;
  y: number;
  cz: number;
  top: number;
  dw: number;
}

export function keycapGeometry(o: KeycapOptions): BufferGeometry {
  const seg = o.segments ?? 1;
  const hw0 = o.u / 2 - 0.03;
  const hd0 = (o.d ?? 1) / 2 - 0.03;
  const h = o.h ?? 0.6;
  const tx = o.taperX ?? 0.1;
  const tzF = o.taperF ?? 0.13;
  const tzB = o.taperB ?? 0.06;
  const rB = o.rBot ?? 0.1;
  const rT = o.rTop ?? 0.13;
  const bev = o.bevel ?? 0.065;
  const dish = o.dish ?? 0.045;
  const tilt = o.tilt ?? 0;
  const bb = 0.02;
  const C = Math.max(3, Math.round(7 * seg));
  const S = h - bev;
  const hwS = hw0 - tx;
  const zF = hd0 - tzF;
  const zB = -(hd0 - tzB);
  const hdS = (zF - zB) / 2;
  const czS = (zF + zB) / 2;
  const step = 0.16 / Math.max(0.5, seg);
  const Nx = Math.max(2, Math.ceil((hw0 * 2) / step));
  const Nz = Math.max(2, Math.ceil((hd0 * 2) / step));

  const rings: Ring[] = [];
  rings.push({ hw: hw0 - bb, hd: hd0 - bb, r: rB - bb * 0.5, y: 0, cz: 0, top: 0, dw: 0 });
  for (const t of [0, 0.12, 0.5, 0.88, 1]) {
    rings.push({
      hw: hw0 + (hwS - hw0) * t,
      hd: hd0 + (hdS - hd0) * t,
      r: rB + (rT - rB) * t,
      y: bb + (S - bb) * t,
      cz: czS * t,
      top: 0,
      dw: 0,
    });
  }
  const bevSteps = Math.max(3, Math.round(5 * seg));
  for (let i = 1; i <= bevSteps; i++) {
    const ph = (i / bevSteps) * Math.PI * 0.5;
    const inset = bev * (1 - Math.cos(ph));
    rings.push({
      hw: hwS - inset,
      hd: hdS - inset,
      r: Math.max(0.02, rT - inset * 0.55),
      y: S + bev * Math.sin(ph),
      cz: czS,
      top: 1,
      dw: 1 - Math.cos(ph),
    });
  }
  const hwT = hwS - bev;
  const hdT = hdS - bev;
  const rTT = Math.max(0.02, rT - bev * 0.55);
  const firstDish = rings.length;
  for (const s of [0.93, 0.84, 0.72, 0.58, 0.43, 0.28, 0.14]) {
    rings.push({ hw: hwT * s, hd: hdT * s, r: rTT * s, y: h, cz: czS, top: 1, dw: 1 });
  }
  // Cylindrical dish depth at z: 0 at the front and back rim, `dish` along the centre line.
  const dishAt = (z: number) => {
    const u = Math.max(-1, Math.min(1, (z - czS) / hdT));
    return dish * (1 - u * u);
  };

  const pos: number[] = [];
  const uv: number[] = [];
  const uv1: number[] = [];
  const uv2: number[] = [];
  let topRing = 0;
  const pushV = (x: number, y: number, z: number) => {
    pos.push(x, y, z);
    uv.push((x + hw0) / (2 * hw0), (hd0 - z) / (2 * hd0));
    uv1.push((x + z * 0.7) * 1.6, (y + (topRing ? z : 0)) * 1.6);
    uv2.push(0.5, Math.max(0, y) / h);
  };

  let M = 0;
  for (const R of rings) {
    const r = Math.min(R.r, R.hw - 1e-3, R.hd - 1e-3);
    const ex = R.hw - r;
    const ez = R.hd - r;
    const pts: number[] = [];
    const corner = (cx: number, cz: number, a0: number) => {
      for (let j = 0; j <= C; j++) {
        const a = a0 + (j / C) * Math.PI * 0.5;
        pts.push(cx + r * Math.cos(a), cz + r * Math.sin(a));
      }
    };
    corner(ex, ez, 0);
    for (let j = 1; j < Nx; j++) pts.push(ex - (2 * ex * j) / Nx, R.hd);
    corner(-ex, ez, Math.PI * 0.5);
    for (let j = 1; j < Nz; j++) pts.push(-R.hw, ez - (2 * ez * j) / Nz);
    corner(-ex, -ez, Math.PI);
    for (let j = 1; j < Nx; j++) pts.push(-ex + (2 * ex * j) / Nx, -R.hd);
    corner(ex, -ez, Math.PI * 1.5);
    for (let j = 1; j < Nz; j++) pts.push(R.hw, -ez + (2 * ez * j) / Nz);
    M = pts.length / 2;
    topRing = R.top;
    for (let k = 0; k < M; k++) {
      const x = pts[k * 2]!;
      const z = pts[k * 2 + 1]! + R.cz;
      const ty = R.top ? tilt * ((z - czS) / Math.max(0.1, hdS)) : 0;
      pushV(x, R.y + ty - (R.dw ? dishAt(z) * R.dw : 0), z);
    }
  }
  const nR = rings.length;
  const bottomC = nR * M;
  topRing = 0;
  pushV(0, 0, 0);
  const topC = bottomC + 1;
  topRing = 1;
  pushV(0, h - dish, czS);

  const idx: number[] = [];
  for (let i = 0; i < nR - 1; i++) {
    for (let k = 0; k < M; k++) {
      const a = i * M + k;
      const b = i * M + ((k + 1) % M);
      const c = (i + 1) * M + k;
      const d = (i + 1) * M + ((k + 1) % M);
      idx.push(a, c, b, b, c, d);
    }
  }
  for (let k = 0; k < M; k++) idx.push(bottomC, k, (k + 1) % M);
  const last = (nR - 1) * M;
  for (let k = 0; k < M; k++) idx.push(last + k, topC, last + ((k + 1) % M));

  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('uv1', new Float32BufferAttribute(uv1, 2));
  g.setAttribute('uv2', new Float32BufferAttribute(uv2, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Winding check: the top centre normal must point up.
  const normals = g.attributes.normal!;
  if (normals.getY(topC) < 0) {
    const ix = g.index!.array as Uint32Array | Uint16Array;
    for (let i = 0; i < ix.length; i += 3) {
      const t = ix[i + 1]!;
      ix[i + 1] = ix[i + 2]!;
      ix[i + 2] = t;
    }
    g.index!.needsUpdate = true;
    g.computeVertexNormals();
  }
  // Analytic normals across the dish: y = h - dish(1-u^2) + tilt*z/hdS.
  {
    const pa = g.attributes.position!;
    const na = g.attributes.normal!;
    const tz = tilt / Math.max(0.1, hdS);
    const fix = (vi: number) => {
      const z = pa.getZ(vi);
      const u = (z - czS) / hdT;
      const dydz = (Math.abs(u) < 1 ? (2 * dish * u) / hdT : 0) + tz;
      const l = Math.hypot(1, dydz);
      na.setXYZ(vi, 0, 1 / l, -dydz / l);
    };
    for (let vi = firstDish * M; vi < nR * M; vi++) fix(vi);
    fix(topC);
    na.needsUpdate = true;
  }
  g.computeBoundingSphere();
  const userData: KeycapUserData = {
    hw0,
    hd0,
    h,
    print: {
      x0: (-hwT + hw0) / (2 * hw0),
      x1: (hwT + hw0) / (2 * hw0),
      y0: (czS - hdT + hd0) / (2 * hd0),
      y1: (czS + hdT + hd0) / (2 * hd0),
    },
  };
  g.userData = userData;
  return g;
}
