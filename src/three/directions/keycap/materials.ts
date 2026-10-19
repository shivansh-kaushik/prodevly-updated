import {
  CanvasTexture,
  Color,
  DoubleSide,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { CapSpec } from '@/three/directions/keycap/cast';
import { HEX } from '@/three/directions/keycap/palette';

/**
 * Shared textures and the cap materials. Everything is generated on a canvas at
 * runtime (no network, no external images) and disposed with the scene.
 */
export interface SharedTextures {
  /** Soft round falloff for contact blobs and underglow. */
  blob: Texture;
  glow: Texture;
  /** Bottom-up gradient on uv2: lights the underside of a cap (underglow) and tints the resin's base. */
  gradient: Texture;
  /** Ambient occlusion by height: caps darken toward the surface they stand on. */
  ao: Texture;
  /** Fine PBT grain, used as a faint bump on uv1. */
  grain: Texture;
  dispose(): void;
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function radial(inner: number, outer: number, a0: number): CanvasTexture {
  const cv = canvas(128, 128);
  const c = cv.getContext('2d');
  if (c) {
    const g = c.createRadialGradient(64, 64, inner, 64, 64, outer);
    g.addColorStop(0, `rgba(255,255,255,${a0})`);
    g.addColorStop(0.5, `rgba(255,255,255,${a0 * 0.45})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  }
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function vertical(stops: Array<[number, string]>, channel: number): CanvasTexture {
  const cv = canvas(4, 64);
  const c = cv.getContext('2d');
  if (c) {
    const g = c.createLinearGradient(0, 64, 0, 0);
    for (const [at, col] of stops) g.addColorStop(at, col);
    c.fillStyle = g;
    c.fillRect(0, 0, 4, 64);
  }
  const t = new CanvasTexture(cv);
  t.channel = channel;
  return t;
}

export function createSharedTextures(): SharedTextures {
  const blob = radial(10, 64, 1);
  const glow = radial(4, 64, 1);
  const gradient = vertical(
    [
      [0, '#ffffff'],
      [0.12, '#6a6a6a'],
      [0.26, '#000000'],
      [1, '#000000'],
    ],
    2,
  );
  const ao = vertical(
    [
      [0, '#5c5c5c'],
      [0.18, '#a8a8a8'],
      [0.45, '#f2f2f2'],
      [1, '#ffffff'],
    ],
    2,
  );
  const gcv = canvas(128, 128);
  const gc = gcv.getContext('2d');
  if (gc) {
    const img = gc.createImageData(128, 128);
    let seed = 7;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 16807) % 2147483647;
      const v = (110 + (seed / 2147483647) * 60) | 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    gc.putImageData(img, 0, 0);
  }
  const grain = new CanvasTexture(gcv);
  grain.colorSpace = NoColorSpace;
  grain.wrapS = grain.wrapT = RepeatWrapping;
  grain.repeat.set(3, 3);
  grain.channel = 1;
  const all = [blob, glow, gradient, ao, grain];
  return { blob, glow, gradient, ao, grain, dispose: () => all.forEach((t) => t.dispose()) };
}

/** PBT keycap plastic with a printed legend atlas and an underglow channel. */
export function capMaterial(spec: CapSpec, map: Texture, tex: SharedTextures): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: '#ffffff',
    map,
    roughness: spec.rough,
    metalness: 0,
    clearcoat: 0.0001,
    clearcoatRoughness: 0.22,
    aoMap: tex.ao,
    aoMapIntensity: 1,
    bumpMap: tex.grain,
    bumpScale: 0.35,
    envMapIntensity: spec.col === 'graphite' ? 0.7 : 0.45,
    emissive: new Color(spec.glow),
    emissiveMap: tex.gradient,
    emissiveIntensity: 0,
  });
}

/**
 * The resin artisan cap. A canvas stays transparent over the page's colour field,
 * so a transmission pass would sample nothing behind it. The convincing fake: a
 * clear, high-clearcoat shell the field shows through, over a smaller mint core
 * that fades out toward the top, with the monogram suspended inside.
 */
export function resinMaterials(spec: CapSpec, tex: SharedTextures) {
  const shell = new MeshPhysicalMaterial({
    color: '#eafff7',
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: 0.3,
    side: DoubleSide,
    depthWrite: false,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    ior: 1.45,
    specularIntensity: 1,
    envMapIntensity: 1.6,
    emissive: new Color(spec.glow),
    emissiveMap: tex.gradient,
    emissiveIntensity: 0,
  });
  const core = new MeshStandardMaterial({
    color: HEX.mint,
    roughness: 0.35,
    transparent: true,
    opacity: 0.95,
    alphaMap: tex.gradient,
    depthWrite: false,
    envMapIntensity: 0.5,
  });
  const mark = new MeshStandardMaterial({
    color: HEX.tomato,
    roughness: 0.38,
    emissive: new Color(HEX.tomato),
    emissiveIntensity: 0.12,
    envMapIntensity: 0.4,
  });
  return { shell, core, mark, dispose: () => [shell, core, mark].forEach((m) => m.dispose()) };
}

export const PLATE_COLOR = { body: HEX.graphite, top: '#2A2D34' };
