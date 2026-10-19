import { CanvasTexture, SRGBColorSpace } from 'three';
import { type CapSpec, type Icon, type Legend } from '@/three/directions/keycap/cast';
import type { KeycapUserData } from '@/three/directions/keycap/keycap-geometry';
import { HEX } from '@/three/directions/keycap/palette';

/**
 * Keycap legends, printed onto a canvas texture (doubleshot look): a plain colour
 * margin for the sides and the printed face on top. Each cap has one atlas with
 * one tile per unique legend; a chapter change swaps the tile (a texture offset),
 * never the mesh. The 3D carries no project titles or prices: those stay in the DOM
 * (docs/CONTRACT.md section 4). Faces show the service names, key symbols, a
 * generic browser wireframe for a project and a developer's initial.
 */
export interface Fonts {
  /** CSS font-family strings (from next/font CSS variables). */
  display: string;
  mono: string;
}

export const FALLBACK_FONTS: Fonts = {
  display: "system-ui, 'Helvetica Neue', Arial, sans-serif",
  mono: "ui-monospace, 'SF Mono', Menlo, monospace",
};

type Ctx = CanvasRenderingContext2D;

function setFont(c: Ctx, weight: number, px: number, family: string, stretch?: string) {
  c.font = `${weight} ${px}px ${family}`;
  try {
    (c as unknown as { fontStretch: string }).fontStretch = stretch ?? 'normal';
  } catch {
    /* older canvas */
  }
}

function fitText(c: Ctx, text: string, maxW: number, weight: number, px: number, family: string, stretch?: string) {
  let s = px;
  setFont(c, weight, s, family, stretch);
  while (s > 8 && c.measureText(text).width > maxW) {
    s -= 1;
    setFont(c, weight, s, family, stretch);
  }
  return s;
}

function roundRect(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}

function drawIcon(c: Ctx, kind: Icon, x: number, y: number, s: number, ink: string) {
  c.save();
  c.strokeStyle = ink;
  c.fillStyle = ink;
  c.lineWidth = Math.max(2, s * 0.11);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  if (kind === 'shift') {
    c.moveTo(x + s * 0.5, y);
    c.lineTo(x + s, y + s * 0.5);
    c.lineTo(x + s * 0.72, y + s * 0.5);
    c.lineTo(x + s * 0.72, y + s);
    c.lineTo(x + s * 0.28, y + s);
    c.lineTo(x + s * 0.28, y + s * 0.5);
    c.lineTo(x, y + s * 0.5);
    c.closePath();
    c.stroke();
  } else if (kind === 'enter') {
    c.moveTo(x + s * 0.95, y + s * 0.05);
    c.lineTo(x + s * 0.95, y + s * 0.62);
    c.lineTo(x + s * 0.1, y + s * 0.62);
    c.moveTo(x + s * 0.38, y + s * 0.34);
    c.lineTo(x + s * 0.1, y + s * 0.62);
    c.lineTo(x + s * 0.38, y + s * 0.9);
    c.stroke();
  } else if (kind === 'tab') {
    c.moveTo(x, y + s * 0.5);
    c.lineTo(x + s * 0.82, y + s * 0.5);
    c.moveTo(x + s * 0.52, y + s * 0.2);
    c.lineTo(x + s * 0.82, y + s * 0.5);
    c.lineTo(x + s * 0.52, y + s * 0.8);
    c.moveTo(x + s, y + s * 0.15);
    c.lineTo(x + s, y + s * 0.85);
    c.stroke();
  } else if (kind === 'opt') {
    c.moveTo(x, y + s * 0.2);
    c.lineTo(x + s * 0.32, y + s * 0.2);
    c.lineTo(x + s * 0.68, y + s * 0.8);
    c.lineTo(x + s, y + s * 0.8);
    c.moveTo(x + s * 0.6, y + s * 0.2);
    c.lineTo(x + s, y + s * 0.2);
    c.stroke();
  } else {
    const r = s * 0.16;
    const a = x + s * 0.32;
    const b = x + s * 0.68;
    const t = y + s * 0.32;
    const u = y + s * 0.68;
    c.strokeRect(a, t, b - a, u - t);
    for (const [cx, cy] of [
      [a - r, t - r],
      [b + r, t - r],
      [a - r, u + r],
      [b + r, u + r],
    ] as const) {
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.stroke();
    }
  }
  c.restore();
}

/** A generic browser-window wireframe: a project sleeve says "work" without any text or figure. */
function drawSleeve(c: Ctx, L: Extract<Legend, { k: 'proj' }>, x0: number, y0: number, iw: number, ih: number, ink: string) {
  const fw = iw;
  const fy = y0;
  const fh = ih;
  c.save();
  c.strokeStyle = ink;
  c.fillStyle = ink;
  c.lineWidth = Math.max(2, ih * 0.035);
  roundRect(c, x0, fy, fw, fh, ih * 0.06);
  c.stroke();
  c.beginPath();
  c.moveTo(x0, fy + fh * 0.2);
  c.lineTo(x0 + fw, fy + fh * 0.2);
  c.stroke();
  for (let i = 0; i < 3; i++) {
    c.beginPath();
    c.arc(x0 + fh * 0.1 + i * fh * 0.1, fy + fh * 0.1, fh * 0.032, 0, Math.PI * 2);
    c.fill();
  }
  const inX = x0 + fw * 0.07;
  const inY = fy + fh * 0.32;
  if (L.kind === 'dash') {
    c.fillRect(inX, inY, fw * 0.18, fh * 0.56);
    for (let i = 0; i < 3; i++) c.fillRect(inX + fw * 0.24 + i * fw * 0.22, inY, fw * 0.18, fh * 0.2);
    c.globalAlpha = 0.5;
    c.fillRect(inX + fw * 0.24, inY + fh * 0.28, fw * 0.62, fh * 0.28);
  } else if (L.kind === 'shop') {
    for (let i = 0; i < 4; i++) {
      c.globalAlpha = i % 2 ? 0.55 : 1;
      c.fillRect(inX + i * fw * 0.22, inY, fw * 0.18, fh * 0.36);
    }
    c.globalAlpha = 1;
    c.fillRect(inX, inY + fh * 0.46, fw * 0.4, fh * 0.08);
  } else if (L.kind === 'app') {
    c.fillRect(inX, inY, fw * 0.5, fh * 0.12);
    c.globalAlpha = 0.55;
    c.fillRect(inX, inY + fh * 0.2, fw * 0.36, fh * 0.07);
    c.globalAlpha = 1;
    roundRect(c, inX + fw * 0.58, inY - fh * 0.02, fw * 0.28, fh * 0.6, fh * 0.06);
    c.stroke();
  } else {
    c.fillRect(inX, inY, fw * 0.62, fh * 0.14);
    c.globalAlpha = 0.55;
    c.fillRect(inX, inY + fh * 0.22, fw * 0.44, fh * 0.07);
    c.globalAlpha = 1;
    c.fillRect(inX, inY + fh * 0.4, fw * 0.2, fh * 0.12);
  }
  c.restore();
}

/** Draws one legend into the printable rect (X, Y, W, H in pixels). */
export function drawLegend(c: Ctx, L: Legend, X: number, Y: number, W: number, H: number, inkIn: string, fonts: Fonts) {
  if (!L) return;
  let ink = inkIn;
  const pad = Math.min(W, H) * 0.12;
  const x0 = X + pad;
  const y0 = Y + pad;
  const iw = W - pad * 2;
  const ih = H - pad * 2;
  c.fillStyle = ink;
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  if (L.k === 'key') {
    setFont(c, 560, Math.round(ih * 0.22), fonts.mono);
    c.fillText(L.t, x0, y0 + ih);
    if (L.icon) drawIcon(c, L.icon, x0, y0, Math.round(ih * 0.3), ink);
  } else if (L.k === 'svc') {
    setFont(c, 560, Math.round(ih * 0.15), fonts.mono);
    c.fillText(L.n, x0, y0 + ih * 0.15);
    const maxFs = Math.round(ih * (L.t.length > 1 ? 0.27 : 0.32));
    let fs = maxFs;
    for (const ln of L.t) fs = Math.min(fs, fitText(c, ln, iw, 860, maxFs, fonts.display, 'expanded'));
    setFont(c, 860, fs, fonts.display, 'expanded');
    L.t.forEach((ln, i) => c.fillText(ln, x0, y0 + ih - (L.t.length - 1 - i) * fs));
  } else if (L.k === 'proj') {
    // A yolk sleeve prints a graphite face first so it still reads on the yolk field.
    if (L.panel) {
      c.fillStyle = HEX.graphite;
      roundRect(c, X + pad * 0.45, Y + pad * 0.45, W - pad * 0.9, H - pad * 0.9, Math.min(W, H) * 0.08);
      c.fill();
      ink = L.panel;
    }
    drawSleeve(c, L, x0, y0, iw, ih, ink);
  } else if (L.k === 'num') {
    // A developer's initial: the maker's mark, drawn from the record's name at runtime.
    const fs = Math.round(ih * 0.62);
    setFont(c, 880, fs, fonts.display, 'expanded');
    c.textAlign = 'center';
    c.fillText(L.t, X + W / 2, y0 + ih * 0.5 + fs * 0.36);
    c.textAlign = 'left';
  } else if (L.k === 'brand') {
    const fs = Math.round(ih * 0.3);
    setFont(c, 880, fs, fonts.display, 'expanded');
    if (L.al === 'r') {
      // Hero: the caps stacked on the bar would hide a centred legend.
      c.textAlign = 'right';
      c.fillText('prodevly', x0 + iw - pad * 0.4, y0 + ih * 0.5 + fs * 0.36);
    } else {
      c.textAlign = 'center';
      c.fillText('prodevly', X + W / 2, y0 + ih * 0.5 + fs * 0.36);
    }
    c.textAlign = 'left';
  } else if (L.k === 'label') {
    const fs = Math.round(ih * 0.3);
    setFont(c, 880, fs, fonts.display, 'expanded');
    c.fillText(L.t, x0, y0 + ih * 0.5 + fs * 0.36);
    const tw = c.measureText(L.t).width;
    c.fillRect(x0 + tw + fs * 0.7, y0 + ih * 0.5, Math.max(0, iw - tw - fs * 1.4), Math.max(2, ih * 0.03));
  } else {
    // send: both marks stay on the flat centre of the dish, clear of the front roll-off.
    const sx = x0 + iw * 0.06;
    const sw = iw * 0.88;
    setFont(c, 880, Math.round(ih * 0.3), fonts.display, 'expanded');
    c.fillText('send', sx, y0 + ih * 0.78);
    const is = Math.round(ih * 0.5);
    drawIcon(c, 'enter', sx + sw - is, y0 + ih * 0.08, is, ink);
  }
}

/* ------------------------------------------------------------------ atlas */
const MAX_TEXTURE = 1024;
export interface Atlas {
  canvas: HTMLCanvasElement;
  texture: CanvasTexture;
  tiles: Legend[];
  /** Tile index for each layout. */
  tileOf: number[];
  /** Currently selected tile (-1 until the first select). */
  current: number;
}

/** One tile per unique legend of this cap; `scale` is the quality tier's texture scale. */
export function createAtlas(spec: CapSpec, ud: KeycapUserData, legends: readonly Legend[], scale: number, anisotropy: number): Atlas {
  const keys: string[] = [];
  const tileOf = legends.map((L) => {
    const k = JSON.stringify(L);
    let i = keys.indexOf(k);
    if (i < 0) {
      keys.push(k);
      i = keys.length - 1;
    }
    return i;
  });
  const tiles = keys.map((k) => JSON.parse(k) as Legend);
  // No atlas side may pass MAX_TEXTURE (docs/plan/engineering.html section 6): big caps print at a lower density.
  const fit = Math.min(1, MAX_TEXTURE / Math.max(ud.hw0 * 2 * spec.ppu * scale, ud.hd0 * 2 * spec.ppu * scale * tiles.length));
  const tw = Math.max(16, Math.round(ud.hw0 * 2 * spec.ppu * scale * fit));
  const th = Math.max(16, Math.round(ud.hd0 * 2 * spec.ppu * scale * fit));
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th * tiles.length;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.repeat.set(1, 1 / tiles.length);
  return { canvas, texture, tiles, tileOf, current: -1 };
}

export function paintAtlas(atlas: Atlas, spec: CapSpec, ud: KeycapUserData, fonts: Fonts) {
  const c = atlas.canvas.getContext('2d');
  if (!c) return;
  const tw = atlas.canvas.width;
  const th = atlas.canvas.height / atlas.tiles.length;
  c.fillStyle = HEX[spec.col];
  c.fillRect(0, 0, atlas.canvas.width, atlas.canvas.height);
  const pr = ud.print;
  atlas.tiles.forEach((L, k) => {
    drawLegend(c, L, pr.x0 * tw, k * th + pr.y0 * th, (pr.x1 - pr.x0) * tw, (pr.y1 - pr.y0) * th, spec.ink, fonts);
  });
  atlas.texture.needsUpdate = true;
}

/** Point the cap's texture at a tile. Cheap: an offset change, no upload. */
export function selectTile(atlas: Atlas, tile: number) {
  if (tile === atlas.current) return;
  atlas.current = tile;
  const n = atlas.tiles.length;
  atlas.texture.offset.set(0, (n - 1 - tile) / n);
}
